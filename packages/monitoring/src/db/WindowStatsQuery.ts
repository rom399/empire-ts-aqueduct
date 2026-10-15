import { SQLInputValue } from "node:sqlite";
import { WindowStats } from "../shared/apiTypes";
import { TelemetryDatabase } from "./TelemetryDatabase";

/** A narrowing of "requests that finished in the window": extra WHERE terms and their values. */
export interface RequestFilter {
    sql: string;
    params: SQLInputValue[];
}

export const NO_FILTER: RequestFilter = { sql: "", params: [] };

const FINISHED = `outcome IN ('completed', 'failed') AND finished_at >= ? AND finished_at < ?`;

/**
 * Counts, error rate, average, median, 95th percentile and maximum for the
 * requests that finished in a time window, read from the `requests` table. It
 * touches only that window (the table is indexed by finish time) and returns a
 * handful of numbers, never rows.
 */
export class WindowStatsQuery {
    constructor(private readonly db: TelemetryDatabase) {}

    stats(from: number, to: number, filter: RequestFilter = NO_FILTER): WindowStats {
        const where = `${FINISHED}${filter.sql}`;
        const params: SQLInputValue[] = [from, to, ...filter.params];

        const summary = this.db.raw.prepare(
            `SELECT COUNT(*) AS count,
                    COALESCE(SUM(CASE WHEN outcome = 'failed' OR status >= 500 THEN 1 ELSE 0 END), 0) AS errors,
                    COUNT(duration_ms) AS timed,
                    COALESCE(AVG(duration_ms), 0) AS avg,
                    COALESCE(MAX(duration_ms), 0) AS max
             FROM requests WHERE ${where}`
        ).get(...params) as { count: number; errors: number; timed: number; avg: number; max: number };

        const count = Number(summary.count);
        const timed = Number(summary.timed);

        return {
            count,
            errors: Number(summary.errors),
            errorRate: count === 0 ? 0 : Number(summary.errors) / count,
            avgMs: round(Number(summary.avg)),
            p50Ms: timed === 0 ? 0 : this.percentile(where, params, timed, 0.5),
            p95Ms: timed === 0 ? 0 : this.percentile(where, params, timed, 0.95),
            maxMs: Number(summary.max),
            perSecond: round((count / Math.max(1, to - from)) * 1000),
        };
    }

    private percentile(where: string, params: SQLInputValue[], timed: number, fraction: number): number {
        const row = this.db.raw.prepare(
            `SELECT duration_ms AS value FROM requests WHERE ${where} AND duration_ms IS NOT NULL ORDER BY duration_ms LIMIT 1 OFFSET ?`
        ).get(...params, Math.floor(fraction * (timed - 1))) as { value: number } | undefined;

        return row === undefined ? 0 : Number(row.value);
    }
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}
