import { SQLInputValue } from "node:sqlite";
import { RequestRow, RequestsResponse } from "../shared/apiTypes";
import { TelemetryDatabase } from "./TelemetryDatabase";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

interface Row {
    request_id: string;
    backend_id: string | null;
    method: string | null;
    path: string | null;
    route: string | null;
    status: number | null;
    duration_ms: number | null;
    dispatched_at: number | null;
    finished_at: number | null;
    outcome: RequestRow["outcome"];
}

/** The most recent requests, newest first. */
export class RequestsQuery {
    constructor(private readonly db: TelemetryDatabase) {}

    run(options: { limit?: number; backendId?: string; since?: number }): RequestsResponse {
        const terms: string[] = [];
        const params: SQLInputValue[] = [];

        if (options.backendId !== undefined) {
            terms.push("backend_id = ?");
            params.push(options.backendId);
        }

        if (options.since !== undefined) {
            terms.push("COALESCE(finished_at, dispatched_at) >= ?");
            params.push(options.since);
        }

        const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT)));
        const rows = this.db.raw.prepare(
            `SELECT * FROM requests ${terms.length > 0 ? `WHERE ${terms.join(" AND ")}` : ""}
             ORDER BY COALESCE(finished_at, dispatched_at) DESC LIMIT ?`
        ).all(...params, limit) as unknown as Row[];

        return {
            requests: rows.map((row) => ({
                requestId: row.request_id,
                backendId: row.backend_id,
                method: row.method,
                path: row.path,
                route: row.route,
                status: row.status === null ? null : Number(row.status),
                durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
                dispatchedAt: row.dispatched_at === null ? null : Number(row.dispatched_at),
                finishedAt: row.finished_at === null ? null : Number(row.finished_at),
                outcome: row.outcome,
            })),
        };
    }
}
