import { QueueClient } from "../client/QueueClient";
import { ConsumedQueueItem } from "../types/ConsumedQueueItem";
import {
    DEFAULT_BATCH_SIZE,
    DEFAULT_CONCURRENCY,
    DEFAULT_DEDUPE_WINDOW_SIZE,
    DEFAULT_INITIAL_BACKOFF_MS,
    DEFAULT_MAX_BACKOFF_MS,
    DEFAULT_POLL_INTERVAL_MS,
    DEFAULT_WAIT_MS,
} from "./consumerDefaults";
import { DedupeWindow } from "./DedupeWindow";
import { QueueConsumerOptions } from "./QueueConsumerOptions";
import { QueueConsumerStats } from "./QueueConsumerStats";
import { sleep } from "./sleep";
import { withJitter } from "./withJitter";

/** What became of an acknowledgement. */
type AckOutcome = "acknowledged" | "too-late" | "unknown";

/**
 * Pulls items from one queue on a broker and hands them to a handler.
 *
 * Each round it takes a batch, **acknowledges receipt straight away**, and then
 * processes the items. Acknowledging first means slow processing can never cause
 * a redelivery. The price is that the items are yours from that moment: the broker
 * will not retry them, so a crash or a handler error loses them.
 *
 * If the acknowledgement call fails and its outcome is unknown, the batch is
 * processed anyway, because the broker probably did get it. If the broker says it
 * is too late (it has already put the items back), the batch is skipped, because
 * another delivery is on its way.
 */
export class QueueConsumer {
    private readonly client: QueueClient;
    private readonly batchSize: number;
    private readonly concurrency: number;
    private readonly waitMs: number;
    private readonly pollIntervalMs: number;
    private readonly initialBackoffMs: number;
    private readonly maxBackoffMs: number;
    private readonly sortBySequence: boolean;
    private readonly dedupe?: DedupeWindow;
    private readonly pause: (ms: number, signal: AbortSignal) => Promise<void>;

    private abort?: AbortController;
    private loop?: Promise<void>;

    private counters: QueueConsumerStats = {
        batchesTaken: 0,
        itemsReceived: 0,
        itemsProcessed: 0,
        handlerErrors: 0,
        duplicatesSkipped: 0,
        batchesSkipped: 0,
        takeErrors: 0,
        ackErrors: 0,
    };

    constructor(private readonly options: QueueConsumerOptions) {
        this.batchSize = positiveInteger("batchSize", options.batchSize ?? DEFAULT_BATCH_SIZE);
        this.concurrency = positiveInteger("concurrency", options.concurrency ?? DEFAULT_CONCURRENCY);
        this.waitMs = nonNegativeInteger("waitMs", options.waitMs ?? DEFAULT_WAIT_MS);
        this.pollIntervalMs = positiveInteger("pollIntervalMs", options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
        this.initialBackoffMs = positiveInteger("initialBackoffMs", options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS);
        this.maxBackoffMs = positiveInteger("maxBackoffMs", options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS);
        this.sortBySequence = options.sortBySequence ?? false;
        this.pause = options.sleep ?? sleep;
        this.client = new QueueClient(options);

        if (options.dedupe) {
            const windowSize = options.dedupe === true ? DEFAULT_DEDUPE_WINDOW_SIZE : options.dedupe.windowSize;

            this.dedupe = new DedupeWindow(positiveInteger("dedupe.windowSize", windowSize));
        }
    }

    /** True between `start()` and the end of `stop()`. */
    get isRunning(): boolean {
        return this.loop !== undefined;
    }

    /** Starts pulling. Returns at once; the work happens in the background. */
    start(): void {
        if (this.loop) {
            throw new Error("This consumer is already running.");
        }

        this.abort = new AbortController();
        this.loop = this.run(this.abort.signal);
    }

    /**
     * Stops pulling. A waiting take is cancelled, and the items already in hand are
     * finished before this resolves. If a cancelled take had just been answered, its
     * items come back after the broker's receipt timeout.
     */
    async stop(): Promise<void> {
        if (!this.loop || !this.abort) {
            return;
        }

        this.abort.abort();
        await this.loop;
        this.loop = undefined;
        this.abort = undefined;
    }

    /** A copy of the counters. */
    stats(): QueueConsumerStats {
        return { ...this.counters };
    }

    private async run(signal: AbortSignal): Promise<void> {
        let backoffMs = this.initialBackoffMs;

        while (!signal.aborted) {
            const startedAt = Date.now();
            let batchId: string | null;
            let items: ConsumedQueueItem[];

            try {
                const response = await this.client.take(this.batchSize, { waitMs: this.waitMs, signal });

                batchId = response.batchId;
                items = response.items;
                backoffMs = this.initialBackoffMs;
            } catch (error) {
                if (signal.aborted) {
                    break;
                }

                this.counters.takeErrors++;
                this.report(error);
                await this.pause(withJitter(backoffMs), signal);
                backoffMs = Math.min(backoffMs * 2, this.maxBackoffMs);
                continue;
            }

            if (items.length === 0 || batchId === null) {
                // A long-poll that ran its course needs no pause. One that came straight back would spin.
                const elapsed = Date.now() - startedAt;

                if (elapsed < this.pollIntervalMs) {
                    await this.pause(this.pollIntervalMs - elapsed, signal);
                }

                continue;
            }

            this.counters.batchesTaken++;
            this.counters.itemsReceived += items.length;

            if (await this.acknowledge(batchId) === "too-late") {
                this.counters.batchesSkipped++;
                continue;
            }

            await this.processBatch(items);
        }
    }

    private async acknowledge(batchId: string): Promise<AckOutcome> {
        try {
            return await this.client.acknowledge(batchId) ? "acknowledged" : "too-late";
        } catch (error) {
            this.counters.ackErrors++;
            this.report(error);

            return "unknown";
        }
    }

    private async processBatch(batch: ConsumedQueueItem[]): Promise<void> {
        let items = this.sortBySequence ? [...batch].sort((a, b) => a.sequence - b.sequence) : batch;

        if (this.dedupe) {
            const window = this.dedupe;

            items = items.filter((item) => {
                if (window.has(item.itemId)) {
                    this.counters.duplicatesSkipped++;
                    return false;
                }

                window.add(item.itemId);
                return true;
            });
        }

        // The workers share one cursor, so each item is handled exactly once.
        let next = 0;

        const worker = async (): Promise<void> => {
            while (next < items.length) {
                await this.handle(items[next++]);
            }
        };

        await Promise.all(Array.from({ length: Math.min(this.concurrency, items.length) }, worker));
    }

    private async handle(item: ConsumedQueueItem): Promise<void> {
        try {
            await this.options.handler(item);
            this.counters.itemsProcessed++;
        } catch (error) {
            this.counters.handlerErrors++;
            this.report(error, item);
        }
    }

    private report(error: unknown, item?: ConsumedQueueItem): void {
        try {
            if (this.options.onError) {
                this.options.onError(error, item);
            } else {
                console.error("[queue-consumer]", error);
            }
        } catch {
            // A failing error handler must not stop the loop.
        }
    }
}

function positiveInteger(name: string, value: number): number {
    if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive integer, got ${String(value)}.`);
    }

    return value;
}

function nonNegativeInteger(name: string, value: number): number {
    if (!Number.isInteger(value) || value < 0) {
        throw new RangeError(`${name} must be zero or a positive integer, got ${String(value)}.`);
    }

    return value;
}
