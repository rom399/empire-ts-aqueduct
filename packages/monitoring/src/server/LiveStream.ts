import { ServerResponse } from "node:http";
import { EventsQuery } from "../db/EventsQuery";
import { QueueQuery } from "../db/QueueQuery";
import { StreamHello } from "../shared/apiTypes";
import { SseClient } from "./SseClient";

const HEARTBEAT_MS = 15_000;
const QUEUE_POLL_MS = 1000;
const REPLAY_LIMIT = 500;

/**
 * The path from the database to every open dashboard. One timer, for all tabs
 * together, asks the database for events past the last one it sent and pushes
 * only those. With nobody connected it does nothing at all.
 *
 * This is the whole "aggregator" for the live view: the processor wrote the
 * events once; this fans them out. The browser keeps the recent history it
 * loaded over REST and applies these deltas to it.
 */
export class LiveStream {
    private readonly clients = new Set<SseClient>();
    private eventTimer: NodeJS.Timeout | undefined;
    private queueTimer: NodeJS.Timeout | undefined;
    private heartbeat: NodeJS.Timeout | undefined;
    private cursor = 0;
    private lastQueueAt = 0;

    constructor(
        private readonly events: EventsQuery,
        private readonly queue: QueueQuery,
        private readonly pollMs: number,
        private readonly now: () => number = Date.now
    ) {}

    /** Takes over the response and keeps it open until the tab leaves or the server stops. Resolves when it closes. */
    attach(res: ServerResponse, afterSeq: number | undefined): Promise<void> {
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff",
        });
        res.write("retry: 2000\n\n");

        if (this.clients.size === 0) {
            this.startPolling();
        }

        const client = new SseClient(res, () => this.hello());
        client.send("hello", this.hello());

        // Anything between what the tab saw before it dropped and where the shared cursor is now.
        if (afterSeq !== undefined && afterSeq < this.cursor) {
            const missed = this.events.run({ afterSeq, limit: REPLAY_LIMIT }).events.filter((event) => event.seq <= this.cursor);

            if (missed.length > 0) {
                client.send("events", missed);
            }
        }

        this.clients.add(client);

        return new Promise<void>((resolve) => {
            res.once("close", () => {
                this.clients.delete(client);

                if (this.clients.size === 0) {
                    this.stopPolling();
                }

                resolve();
            });
        });
    }

    get connected(): number {
        return this.clients.size;
    }

    /** Ends every stream so the server can stop. */
    close(): void {
        this.stopPolling();
        this.clients.forEach((client) => client.end());
        this.clients.clear();
    }

    private hello(): StreamHello {
        return { lastSeq: this.cursor, now: this.now() };
    }

    private startPolling(): void {
        this.cursor = this.events.lastSeq();
        this.lastQueueAt = this.now();
        this.eventTimer = setInterval(() => this.pushEvents(), this.pollMs);
        this.queueTimer = setInterval(() => this.pushQueue(), QUEUE_POLL_MS);
        this.heartbeat = setInterval(() => this.broadcast("ping", {}), HEARTBEAT_MS);
        [this.eventTimer, this.queueTimer, this.heartbeat].forEach((timer) => timer.unref());
    }

    private stopPolling(): void {
        [this.eventTimer, this.queueTimer, this.heartbeat].forEach((timer) => timer && clearInterval(timer));
        this.eventTimer = this.queueTimer = this.heartbeat = undefined;
    }

    private pushEvents(): void {
        try {
            const { events } = this.events.run({ afterSeq: this.cursor, limit: REPLAY_LIMIT });

            if (events.length > 0) {
                this.cursor = events[events.length - 1].seq;
                this.broadcast("events", events);
            }
        } catch {
            // The database is busy for a moment; the next tick picks up where this one stopped.
        }
    }

    private pushQueue(): void {
        try {
            for (const sample of this.queue.since(this.lastQueueAt)) {
                this.lastQueueAt = sample.at;
                this.broadcast("queue", sample);
            }
        } catch {
            // Same: try again next tick.
        }
    }

    private broadcast(event: string, data: unknown): void {
        this.clients.forEach((client) => client.send(event, data));
    }
}
