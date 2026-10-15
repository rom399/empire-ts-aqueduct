import { SQLInputValue } from "node:sqlite";
import { EventsResponse, StoredEvent } from "../shared/apiTypes";
import { TelemetryDatabase } from "./TelemetryDatabase";

export const MAX_EVENT_LIMIT = 500;
export const DEFAULT_EVENT_LIMIT = 100;

export interface EventsFilter {
    afterSeq?: number;
    beforeSeq?: number;
    limit?: number;
    types?: string[];
    source?: string;
}

interface EventRow {
    seq: number;
    type: string;
    source: string | null;
    correlation_id: string | null;
    created_at: number;
    payload: string;
}

/**
 * Events by cursor. `afterSeq` pages forward (oldest first) and is what the live
 * stream and a reconnecting browser use; `beforeSeq` pages back (newest first);
 * neither gives the newest page. Every call is bounded by `limit`.
 */
export class EventsQuery {
    constructor(private readonly db: TelemetryDatabase) {}

    run(filter: EventsFilter): EventsResponse {
        const limit = Math.min(MAX_EVENT_LIMIT, Math.max(1, Math.floor(filter.limit ?? DEFAULT_EVENT_LIMIT)));
        const terms: string[] = [];
        const params: SQLInputValue[] = [];

        if (filter.afterSeq !== undefined) {
            terms.push("seq > ?");
            params.push(filter.afterSeq);
        }

        if (filter.beforeSeq !== undefined) {
            terms.push("seq < ?");
            params.push(filter.beforeSeq);
        }

        if (filter.types !== undefined && filter.types.length > 0) {
            terms.push(`type IN (${filter.types.map(() => "?").join(", ")})`);
            params.push(...filter.types);
        }

        if (filter.source !== undefined) {
            terms.push("source = ?");
            params.push(filter.source);
        }

        const forward = filter.afterSeq !== undefined;
        const rows = this.db.raw.prepare(
            `SELECT seq, type, source, correlation_id, created_at, payload FROM events
             ${terms.length > 0 ? `WHERE ${terms.join(" AND ")}` : ""}
             ORDER BY seq ${forward ? "ASC" : "DESC"} LIMIT ?`
        ).all(...params, limit) as unknown as EventRow[];

        return { events: rows.map(toEvent), lastSeq: this.lastSeq() };
    }

    lastSeq(): number {
        const row = this.db.raw.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events").get() as { seq: number };
        return Number(row.seq);
    }
}

function toEvent(row: EventRow): StoredEvent {
    return {
        seq: Number(row.seq),
        type: row.type,
        source: row.source,
        correlationId: row.correlation_id,
        at: Number(row.created_at),
        payload: safeParse(row.payload),
    };
}

function safeParse(text: string): Record<string, unknown> {
    try {
        const value: unknown = JSON.parse(text);
        return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
    } catch {
        return {};
    }
}
