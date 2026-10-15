import { ProcessorStatus, QueueResponse, QueueSample, QueueSeriesResponse } from "../shared/apiTypes";
import { chooseBucketMs } from "./TimeseriesQuery";
import { TelemetryDatabase } from "./TelemetryDatabase";

const RECENT_SAMPLES = 60;
const ALIVE_WITHIN_MS = 15_000;

interface Row {
    at: number; queue: string; depth: number; in_flight: number; spilled: number; waiting_consumers: number;
    published: number; taken: number; acknowledged: number; redelivered: number; dropped: number; rejected: number;
    expired: number; max_size: number; high_water_mark: number; publish_rate: number; ack_rate: number;
}

/** The broker queue as the processor sampled it, and the processor's own heartbeat. */
export class QueueQuery {
    constructor(private readonly db: TelemetryDatabase) {}

    current(now: number): QueueResponse {
        const recent = (this.db.raw.prepare(`SELECT * FROM queue_samples ORDER BY at DESC LIMIT ${RECENT_SAMPLES}`).all() as unknown as Row[])
            .map(toSample)
            .reverse();

        return { now, latest: recent.length > 0 ? recent[recent.length - 1] : null, recent, processor: this.processor(now) };
    }

    /** Samples newer than `after`, oldest first. The live stream uses this. */
    since(after: number): QueueSample[] {
        return (this.db.raw.prepare("SELECT * FROM queue_samples WHERE at > ? ORDER BY at LIMIT 100").all(after) as unknown as Row[]).map(toSample);
    }

    series(from: number, to: number, requestedBucketMs: number | undefined): QueueSeriesResponse {
        const bucketMs = chooseBucketMs(from, to, requestedBucketMs);
        const rows = this.db.raw.prepare(
            `SELECT *, MAX(at) AS last_at FROM queue_samples WHERE at >= ? AND at < ? GROUP BY CAST((at - ?) / ? AS INTEGER) ORDER BY at`
        ).all(from, to, from, bucketMs) as unknown as Row[];

        return { from, to, bucketMs, points: rows.map(toSample) };
    }

    processor(now: number): ProcessorStatus {
        const row = this.db.raw.prepare("SELECT * FROM processor_status WHERE id = 1").get() as {
            updated_at: number | null; stored_total: number; duplicates_skipped: number;
            last_stored_at: number | null; last_polled_at: number | null; last_error: string | null;
        };
        const updated = row.updated_at === null ? null : Number(row.updated_at);

        return {
            alive: updated !== null && now - updated < ALIVE_WITHIN_MS,
            lastStoredAt: row.last_stored_at === null ? null : Number(row.last_stored_at),
            lastPolledAt: row.last_polled_at === null ? null : Number(row.last_polled_at),
            storedTotal: Number(row.stored_total),
            duplicatesSkipped: Number(row.duplicates_skipped),
            lastError: row.last_error,
        };
    }
}

function toSample(row: Row): QueueSample {
    return {
        at: Number(row.at), queue: row.queue, depth: Number(row.depth), inFlight: Number(row.in_flight), spilled: Number(row.spilled),
        waitingConsumers: Number(row.waiting_consumers), published: Number(row.published), taken: Number(row.taken),
        acknowledged: Number(row.acknowledged), redelivered: Number(row.redelivered), dropped: Number(row.dropped),
        rejected: Number(row.rejected), expired: Number(row.expired), maxSize: Number(row.max_size),
        highWaterMark: Number(row.high_water_mark), publishRate: Number(row.publish_rate), ackRate: Number(row.ack_rate),
    };
}
