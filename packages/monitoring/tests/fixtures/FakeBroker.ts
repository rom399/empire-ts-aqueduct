import http from "node:http";
import { AddressInfo } from "node:net";

interface FakeItem {
    itemId: string;
    sequence: number;
    type: string;
    payload: unknown;
    createdAt: number;
    enqueuedAt: number;
    source?: string;
    deliveryCount: number;
}

/**
 * Just enough of the broker's pull port for the processor: take, ack and stats,
 * with the tokens checked. Batches are queued by the test; `onAck` lets the
 * test look at the world at the moment an acknowledgement arrives.
 */
export class FakeBroker {
    readonly takes: number[] = [];
    readonly acks: string[] = [];
    failTakes = 0;
    stats: Record<string, number> = {
        depth: 5, inFlight: 1, buffered: 0, spilledItems: 0, waitingConsumers: 1, published: 10, taken: 5, acknowledged: 4,
        redelivered: 0, dropped: 0, rejected: 0, expired: 0, maxSize: 100, highWaterMark: 7,
    };
    onAck: (batchId: string) => void = () => undefined;
    private readonly batches: FakeItem[][] = [];
    private batchCounter = 0;
    private readonly server: http.Server;

    constructor(private readonly pullToken: string, private readonly adminToken: string) {
        this.server = http.createServer((req, res) => void this.handle(req, res));
    }

    async start(): Promise<string> {
        await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
        return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    }

    stop(): Promise<void> {
        this.server.closeAllConnections();
        return new Promise((resolve) => this.server.close(() => resolve()));
    }

    /** The next take returns these items. */
    queueBatch(items: Array<Partial<FakeItem> & { itemId: string; type: string; createdAt: number }>): void {
        this.batches.push(items.map((item, i) => ({ sequence: i, payload: {}, enqueuedAt: item.createdAt, deliveryCount: 1, ...item })));
    }

    private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const send = (status: number, body: unknown): void => {
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(body));
        };
        const bearer = req.headers.authorization ?? "";
        const url = req.url ?? "";
        const body = await new Promise<string>((resolve) => {
            let text = "";
            req.on("data", (chunk) => (text += chunk));
            req.on("end", () => resolve(text));
        });

        if (url.endsWith("/stats")) {
            return bearer === `Bearer ${this.adminToken}` ? send(200, { name: "q", closed: false, ...this.stats }) : send(401, { error: "no" });
        }

        if (bearer !== `Bearer ${this.pullToken}`) {
            return send(401, { error: "no" });
        }

        if (url.endsWith("/take")) {
            this.takes.push(Date.now());

            if (this.failTakes > 0) {
                this.failTakes--;
                return send(500, { error: "broker is having a bad day" });
            }

            const batch = this.batches.shift();

            if (batch === undefined) {
                const waitMs = Math.min(100, Number((JSON.parse(body || "{}") as { waitMs?: number }).waitMs ?? 0));
                await new Promise((resolve) => setTimeout(resolve, waitMs));
                return send(200, { batchId: null, count: 0, drained: true, items: [] });
            }

            return send(200, { batchId: `batch-${++this.batchCounter}`, count: batch.length, drained: this.batches.length === 0, items: batch });
        }

        if (url.endsWith("/ack")) {
            const { batchId } = JSON.parse(body) as { batchId: string };
            this.onAck(batchId);
            this.acks.push(batchId);
            return send(200, { acknowledged: true });
        }

        return send(404, { error: "unknown" });
    }
}
