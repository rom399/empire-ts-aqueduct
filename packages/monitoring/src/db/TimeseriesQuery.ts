import { SQLInputValue } from "node:sqlite";
import { TimeseriesResponse } from "../shared/apiTypes";
import { TelemetryDatabase } from "./TelemetryDatabase";

export const MAX_POINTS = 600;
const SECOND_MS = 1000;

export interface TimeseriesFilter {
    backendId?: string;
    route?: string;
}

/**
 * Requests per time slice, read from the per-second `buckets` table rather than
 * from requests: a day at one-minute resolution reads at most 86,400 small rows
 * per backend and route, not every request. The slice width is widened so the
 * answer never has more than MAX_POINTS points.
 */
export class TimeseriesQuery {
    constructor(private readonly db: TelemetryDatabase) {}

    run(from: number, to: number, requestedBucketMs: number | undefined, filter: TimeseriesFilter): TimeseriesResponse {
        const bucketMs = chooseBucketMs(from, to, requestedBucketMs);
        const start = from - (from % bucketMs);
        const end = to;
        const slots = Math.max(1, Math.ceil((end - start) / bucketMs));

        const params: SQLInputValue[] = [start, bucketMs, start, end];
        let where = "kind = 'lb' AND bucket_start >= ? AND bucket_start < ?";
        const filterParams: SQLInputValue[] = [];

        if (filter.backendId !== undefined) {
            where += " AND backend_id = ?";
            filterParams.push(filter.backendId);
        }

        if (filter.route !== undefined) {
            where += " AND route = ?";
            filterParams.push(filter.route);
        }

        const rows = this.db.raw.prepare(
            `SELECT CAST((bucket_start - ?) / ? AS INTEGER) AS slot, SUM(count) AS count, SUM(errors) AS errors, SUM(sum_ms) AS sum_ms, MAX(max_ms) AS max_ms
             FROM buckets WHERE ${where} GROUP BY slot`
        ).all(...params, ...filterParams) as unknown as Array<{ slot: number; count: number; errors: number; sum_ms: number; max_ms: number }>;

        const bySlot = new Map(rows.map((row) => [Number(row.slot), row]));
        const points = [];

        for (let slot = 0; slot < slots; slot++) {
            const row = bySlot.get(slot);
            const count = row ? Number(row.count) : 0;
            points.push({
                t: start + slot * bucketMs,
                count,
                errors: row ? Number(row.errors) : 0,
                avgMs: row && count > 0 ? Math.round((Number(row.sum_ms) / count) * 100) / 100 : 0,
                maxMs: row ? Number(row.max_ms) : 0,
            });
        }

        return { from: start, to: end, bucketMs, points };
    }
}

/** At least the request, at least whole seconds, and wide enough for MAX_POINTS. */
export function chooseBucketMs(from: number, to: number, requested: number | undefined): number {
    const minimum = Math.ceil((to - from) / MAX_POINTS / SECOND_MS) * SECOND_MS;
    const wanted = requested === undefined ? Math.ceil((to - from) / 120 / SECOND_MS) * SECOND_MS : Math.ceil(requested / SECOND_MS) * SECOND_MS;

    return Math.max(SECOND_MS, minimum, wanted);
}
