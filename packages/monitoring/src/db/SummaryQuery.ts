import { SummaryResponse } from "../shared/apiTypes";
import { TelemetryDatabase } from "./TelemetryDatabase";
import { WindowStatsQuery } from "./WindowStatsQuery";

const MAX_ROUTES = 50;
const MAX_BACKENDS = 100;
const UNMATCHED = "(unmatched)";

/** Totals, per-backend and per-route statistics for one window. The answer is at most about 150 small rows. */
export class SummaryQuery {
    constructor(private readonly db: TelemetryDatabase, private readonly stats: WindowStatsQuery) {}

    run(from: number, to: number): SummaryResponse {
        const window = [from, to];

        const classes = this.db.raw.prepare(
            `SELECT COALESCE(SUM(CASE WHEN outcome = 'completed' AND status >= 200 AND status < 300 THEN 1 ELSE 0 END), 0) AS c2,
                    COALESCE(SUM(CASE WHEN outcome = 'completed' AND status >= 300 AND status < 400 THEN 1 ELSE 0 END), 0) AS c3,
                    COALESCE(SUM(CASE WHEN outcome = 'completed' AND status >= 400 AND status < 500 THEN 1 ELSE 0 END), 0) AS c4,
                    COALESCE(SUM(CASE WHEN outcome = 'completed' AND status >= 500 THEN 1 ELSE 0 END), 0) AS c5,
                    COALESCE(SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END), 0) AS failed
             FROM requests WHERE outcome IN ('completed', 'failed') AND finished_at >= ? AND finished_at < ?`
        ).get(...window) as Record<string, number>;

        const backendIds = this.db.raw.prepare(
            `SELECT backend_id FROM requests WHERE outcome IN ('completed', 'failed') AND finished_at >= ? AND finished_at < ? AND backend_id IS NOT NULL
             GROUP BY backend_id ORDER BY COUNT(*) DESC LIMIT ${MAX_BACKENDS}`
        ).all(...window) as unknown as Array<{ backend_id: string }>;

        const routeKeys = this.db.raw.prepare(
            `SELECT backend_id, COALESCE(route, '${UNMATCHED}') AS route, COALESCE(method, '') AS method
             FROM requests WHERE outcome IN ('completed', 'failed') AND finished_at >= ? AND finished_at < ? AND backend_id IS NOT NULL
             GROUP BY backend_id, COALESCE(route, '${UNMATCHED}'), COALESCE(method, '') ORDER BY COUNT(*) DESC LIMIT ${MAX_ROUTES}`
        ).all(...window) as unknown as Array<{ backend_id: string; route: string; method: string }>;

        return {
            from,
            to,
            totals: this.stats.stats(from, to),
            statusClasses: { "2xx": Number(classes.c2), "3xx": Number(classes.c3), "4xx": Number(classes.c4), "5xx": Number(classes.c5), failed: Number(classes.failed) },
            backends: backendIds.map((row) => ({
                backendId: row.backend_id,
                stats: this.stats.stats(from, to, { sql: " AND backend_id = ?", params: [row.backend_id] }),
            })),
            routes: routeKeys.map((row) => ({
                backendId: row.backend_id,
                route: row.route,
                method: row.method,
                stats: this.stats.stats(from, to, {
                    sql: ` AND backend_id = ? AND COALESCE(route, '${UNMATCHED}') = ? AND COALESCE(method, '') = ?`,
                    params: [row.backend_id, row.route, row.method],
                }),
            })),
        };
    }
}
