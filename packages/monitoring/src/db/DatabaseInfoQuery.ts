import { DatabaseResponse } from "../shared/apiTypes";
import { TelemetryDatabase } from "./TelemetryDatabase";

/** Table name, the column that holds its timestamps, for the "oldest / newest" columns. */
const TABLES: Array<[string, string]> = [
    ["events", "created_at"],
    ["requests", "COALESCE(finished_at, dispatched_at)"],
    ["buckets", "bucket_start"],
    ["queue_samples", "at"],
    ["backends", "last_seen_at"],
    ["sources", "last_seen_at"],
];

/** What the database holds. Row counts scan an index, so callers should cache this for a few seconds. */
export class DatabaseInfoQuery {
    constructor(private readonly db: TelemetryDatabase, private readonly retentionMs: number) {}

    run(): DatabaseResponse {
        return {
            path: this.db.filePath,
            sizeBytes: this.db.sizeBytes(),
            retentionMs: this.retentionMs,
            tables: TABLES.map(([name, column]) => {
                const row = this.db.raw.prepare(`SELECT COUNT(*) AS rows, MIN(${column}) AS oldest, MAX(${column}) AS newest FROM ${name}`).get() as {
                    rows: number; oldest: number | null; newest: number | null;
                };

                return {
                    name,
                    rows: Number(row.rows),
                    oldestAt: row.oldest === null ? null : Number(row.oldest),
                    newestAt: row.newest === null ? null : Number(row.newest),
                };
            }),
        };
    }
}
