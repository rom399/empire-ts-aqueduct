import { StatementSync } from "node:sqlite";
import { TelemetryDatabase } from "./TelemetryDatabase";
import { StoredEventView } from "./StoredEventView";

const UNMATCHED_ROUTE = "(unmatched)";
const BUCKET_MS = 1000;
const SERVER_ERROR = 500;

/**
 * Turns one stored event into updates of the summary tables: requests, buckets,
 * backends and sources. Runs inside the same transaction as the insert of the
 * event, so a summary never counts an event twice.
 *
 * The events are trusted to have the shapes in src/shared/apiTypes.ts, but not
 * blindly: a field of the wrong type is treated as missing rather than crashing.
 */
export class EventProjector {
    private readonly touchSource: StatementSync;
    private readonly dispatched: StatementSync;
    private readonly finished: StatementSync;
    private readonly aborted: StatementSync;
    private readonly bucket: StatementSync;
    private readonly backendAdded: StatementSync;
    private readonly backendRemoved: StatementSync;
    private readonly backendSeen: StatementSync;

    constructor(db: TelemetryDatabase) {
        const sql = db.raw;

        this.touchSource = sql.prepare(
            `INSERT INTO sources (source, first_seen_at, last_seen_at) VALUES (?, ?, ?)
             ON CONFLICT(source) DO UPDATE SET last_seen_at = MAX(last_seen_at, excluded.last_seen_at)`
        );

        // A request id that comes back after its row finished is a new request (the balancer restarted and counts from 1 again).
        this.dispatched = sql.prepare(
            `INSERT INTO requests (request_id, backend_id, method, path, dispatched_at, outcome) VALUES (?, ?, ?, ?, ?, 'pending')
             ON CONFLICT(request_id) DO UPDATE SET
                 backend_id    = CASE WHEN finished_at IS NOT NULL THEN excluded.backend_id    ELSE COALESCE(backend_id, excluded.backend_id) END,
                 method        = CASE WHEN finished_at IS NOT NULL THEN excluded.method        ELSE COALESCE(method, excluded.method) END,
                 path          = CASE WHEN finished_at IS NOT NULL THEN excluded.path          ELSE COALESCE(path, excluded.path) END,
                 dispatched_at = CASE WHEN finished_at IS NOT NULL THEN excluded.dispatched_at ELSE COALESCE(dispatched_at, excluded.dispatched_at) END,
                 route         = CASE WHEN finished_at IS NOT NULL THEN NULL ELSE route END,
                 status        = CASE WHEN finished_at IS NOT NULL THEN NULL ELSE status END,
                 duration_ms   = CASE WHEN finished_at IS NOT NULL THEN NULL ELSE duration_ms END,
                 outcome       = CASE WHEN finished_at IS NOT NULL THEN 'pending' ELSE outcome END,
                 finished_at   = CASE WHEN finished_at IS NOT NULL THEN NULL ELSE finished_at END`
        );

        this.finished = sql.prepare(
            `INSERT INTO requests (request_id, backend_id, route, status, duration_ms, finished_at, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(request_id) DO UPDATE SET
                 backend_id  = COALESCE(excluded.backend_id, backend_id),
                 route       = excluded.route,
                 status      = excluded.status,
                 duration_ms = excluded.duration_ms,
                 finished_at = excluded.finished_at,
                 outcome     = excluded.outcome`
        );

        this.aborted = sql.prepare(
            `INSERT INTO requests (request_id, backend_id, finished_at, outcome) VALUES (?, ?, ?, 'aborted')
             ON CONFLICT(request_id) DO UPDATE SET
                 backend_id  = COALESCE(excluded.backend_id, backend_id),
                 finished_at = excluded.finished_at,
                 outcome     = 'aborted'`
        );

        this.bucket = sql.prepare(
            `INSERT INTO buckets (bucket_start, kind, backend_id, route, count, errors, sum_ms, max_ms) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
             ON CONFLICT(bucket_start, kind, backend_id, route) DO UPDATE SET
                 count  = count + 1,
                 errors = errors + excluded.errors,
                 sum_ms = sum_ms + excluded.sum_ms,
                 max_ms = MAX(max_ms, excluded.max_ms)`
        );

        this.backendAdded = sql.prepare(
            `INSERT INTO backends (id, url, status, first_seen_at, last_seen_at, lease_expires_at) VALUES (?, ?, 'active', ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                 url = COALESCE(excluded.url, url), status = 'active', last_seen_at = excluded.last_seen_at,
                 lease_expires_at = excluded.lease_expires_at, removed_at = NULL, removal_reason = NULL`
        );

        this.backendRemoved = sql.prepare(
            `INSERT INTO backends (id, status, first_seen_at, last_seen_at, removed_at, removal_reason) VALUES (?, 'removed', ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                 status = 'removed', last_seen_at = excluded.last_seen_at, lease_expires_at = NULL,
                 removed_at = excluded.removed_at, removal_reason = excluded.removal_reason`
        );

        // Seen again without a registration event (a lease renewal, or the backend's own start event).
        this.backendSeen = sql.prepare(
            `INSERT INTO backends (id, status, first_seen_at, last_seen_at, lease_expires_at) VALUES (?, 'active', ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                 last_seen_at = MAX(last_seen_at, excluded.last_seen_at),
                 lease_expires_at = COALESCE(excluded.lease_expires_at, lease_expires_at)`
        );
    }

    apply(event: StoredEventView): void {
        if (event.source) {
            this.touchSource.run(event.source, event.at, event.at);
        }

        const p = event.payload;

        switch (event.type) {
            case "loadbalancer.dispatched": {
                const requestId = text(p.requestId);
                if (requestId) {
                    this.dispatched.run(requestId, text(p.backendId) ?? null, text(p.method) ?? null, text(p.path) ?? null, event.at);
                }
                break;
            }
            case "loadbalancer.completed": {
                const requestId = text(p.requestId);
                const backendId = text(p.backendId) ?? null;
                const route = text(p.route) ?? null;
                const status = whole(p.status);
                const duration = whole(p.durationMs);
                if (requestId) {
                    this.finished.run(requestId, backendId, route, status ?? null, duration ?? null, event.at, "completed");
                }
                this.count("lb", event.at, backendId, route, status !== undefined && status >= SERVER_ERROR, duration);
                break;
            }
            case "loadbalancer.failed": {
                const requestId = text(p.requestId);
                const backendId = text(p.backendId) ?? null;
                const duration = whole(p.durationMs);
                if (requestId) {
                    this.finished.run(requestId, backendId, null, null, duration ?? null, event.at, "failed");
                }
                this.count("lb", event.at, backendId, null, true, duration);
                break;
            }
            case "loadbalancer.aborted": {
                const requestId = text(p.requestId);
                if (requestId) {
                    this.aborted.run(requestId, text(p.backendId) ?? null, event.at);
                }
                break;
            }
            case "backend.request": {
                const status = whole(p.status);
                this.count("backend", event.at, text(p.backendId) ?? null, text(p.route) ?? null, status !== undefined && status >= SERVER_ERROR, whole(p.durationMs));
                break;
            }
            case "loadbalancer.backendAdded": {
                const backend = p.backend as { id?: unknown; url?: unknown } | undefined;
                const id = text(backend?.id);
                if (id) {
                    this.backendAdded.run(id, text(backend?.url) ?? null, event.at, event.at, whole(p.expiresAt) ?? null);
                }
                break;
            }
            case "loadbalancer.backendRemoved": {
                const id = text(p.backendId);
                if (id) {
                    this.backendRemoved.run(id, event.at, event.at, event.at, text(p.reason) ?? null);
                }
                break;
            }
            case "loadbalancer.leaseRenewed": {
                const id = text(p.backendId);
                if (id) {
                    this.backendSeen.run(id, event.at, event.at, whole(p.expiresAt) ?? null);
                }
                break;
            }
            case "backend.started": {
                const id = text(p.backendId);
                if (id) {
                    this.backendSeen.run(id, event.at, event.at, null);
                }
                break;
            }
            default:
                break;
        }
    }

    private count(kind: string, at: number, backendId: string | null, route: string | null, isError: boolean, durationMs: number | undefined): void {
        const duration = durationMs ?? 0;
        this.bucket.run(at - (at % BUCKET_MS), kind, backendId ?? "", route ?? UNMATCHED_ROUTE, isError ? 1 : 0, duration, duration);
    }
}

function text(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function whole(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}
