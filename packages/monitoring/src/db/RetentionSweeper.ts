import { TelemetryDatabase } from "./TelemetryDatabase";

/** Removed backends are kept this long after they leave, so the dashboard can show them fading. */
const REMOVED_BACKEND_KEEP_MS = 24 * 60 * 60 * 1000;

/** Deletes in slices so one sweep never holds the write lock for long. */
const DELETE_SLICE = 20_000;

/**
 * Keeps the database from growing without bound: rows older than the retention
 * period are deleted. Run it on a timer from the processor, the only writer.
 */
export class RetentionSweeper {
    constructor(private readonly db: TelemetryDatabase, private readonly retentionMs: number) {}

    /** Returns how many rows were deleted. */
    sweep(now: number): number {
        const cutoff = now - this.retentionMs;
        let deleted = 0;

        deleted += this.deleteSliced("events", `rowid IN (SELECT rowid FROM events WHERE created_at < ? LIMIT ${DELETE_SLICE})`, cutoff);
        deleted += this.deleteSliced("requests", `rowid IN (SELECT rowid FROM requests WHERE COALESCE(finished_at, dispatched_at, 0) < ? LIMIT ${DELETE_SLICE})`, cutoff);
        deleted += this.deleteSliced("buckets", "bucket_start < ?", cutoff);
        deleted += this.deleteSliced("queue_samples", "at < ?", cutoff);
        deleted += this.deleteSliced("backends", "status = 'removed' AND removed_at < ?", now - REMOVED_BACKEND_KEEP_MS);

        return deleted;
    }

    private deleteSliced(table: string, where: string, cutoff: number): number {
        let total = 0;
        const statement = this.db.raw.prepare(`DELETE FROM ${table} WHERE ${where}`);

        for (;;) {
            const changes = Number(statement.run(cutoff).changes);
            total += changes;

            if (changes < DELETE_SLICE) {
                return total;
            }
        }
    }
}
