import { QueueSample } from "../shared/apiTypes";

/** The broker's stats reply, the fields this reads. */
interface BrokerStats {
    depth: number;
    inFlight: number;
    buffered: number;
    spilledItems: number;
    waitingConsumers: number;
    published: number;
    taken: number;
    acknowledged: number;
    redelivered: number;
    dropped: number;
    rejected: number;
    expired: number;
    maxSize: number;
    highWaterMark: number;
}

const REQUEST_TIMEOUT_MS = 3000;

/**
 * Reads the queue's own numbers from the broker's admin API and turns them
 * into samples, with publish and acknowledge rates worked out from the change
 * since the previous reading. The processor stores each sample, so the queue's
 * depth and throughput over time is in the database like everything else.
 */
export class QueueStatsPoller {
    private previous: QueueSample | undefined;
    private readonly url: string;

    constructor(
        brokerPullUrl: string,
        private readonly queue: string,
        private readonly adminToken: string,
        private readonly now: () => number = Date.now
    ) {
        this.url = `${brokerPullUrl.replace(/\/+$/, "")}/v1/queues/${encodeURIComponent(queue)}/stats`;
    }

    /** Throws if the broker cannot be reached or refuses. */
    async poll(): Promise<QueueSample> {
        const response = await fetch(this.url, {
            headers: { Authorization: `Bearer ${this.adminToken}` },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`The broker answered ${response.status} to the stats request.`);
        }

        const stats = (await response.json()) as BrokerStats;
        const at = this.now();
        const seconds = this.previous === undefined ? 0 : (at - this.previous.at) / 1000;
        const rate = (current: number, before: number | undefined): number =>
            seconds > 0 && before !== undefined && current >= before ? Math.round(((current - before) / seconds) * 100) / 100 : 0;

        const sample: QueueSample = {
            at,
            queue: this.queue,
            depth: stats.depth,
            inFlight: stats.inFlight,
            spilled: stats.buffered + stats.spilledItems,
            waitingConsumers: stats.waitingConsumers,
            published: stats.published,
            taken: stats.taken,
            acknowledged: stats.acknowledged,
            redelivered: stats.redelivered,
            dropped: stats.dropped,
            rejected: stats.rejected,
            expired: stats.expired,
            maxSize: stats.maxSize,
            highWaterMark: stats.highWaterMark,
            publishRate: rate(stats.published, this.previous?.published),
            ackRate: rate(stats.acknowledged, this.previous?.acknowledged),
        };

        this.previous = sample;
        return sample;
    }
}
