import { StatementSync } from "node:sqlite";
import { QueueSample } from "../shared/apiTypes";
import { TelemetryDatabase } from "./TelemetryDatabase";

/** Writes the readings of the broker queue. Reads are in TelemetryQueries. */
export class QueueSampleStore {
    private readonly insert: StatementSync;

    constructor(db: TelemetryDatabase) {
        this.insert = db.raw.prepare(
            `INSERT OR REPLACE INTO queue_samples
             (at, queue, depth, in_flight, spilled, waiting_consumers, published, taken, acknowledged, redelivered,
              dropped, rejected, expired, max_size, high_water_mark, publish_rate, ack_rate)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
    }

    save(sample: QueueSample): void {
        this.insert.run(
            sample.at, sample.queue, sample.depth, sample.inFlight, sample.spilled, sample.waitingConsumers,
            sample.published, sample.taken, sample.acknowledged, sample.redelivered,
            sample.dropped, sample.rejected, sample.expired, sample.maxSize, sample.highWaterMark,
            sample.publishRate, sample.ackRate
        );
    }
}
