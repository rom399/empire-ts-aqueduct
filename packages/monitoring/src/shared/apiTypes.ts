/**
 * The contract between the telemetry hub's web server (src/server) and the
 * dashboard (web/). Plain data, no imports, so both sides can use it.
 *
 * All times are epoch milliseconds. All endpoints are GET and answer JSON,
 * except /api/stream (server-sent events). The dashboard never loads
 * "everything": every list is bounded (see the limits noted per endpoint), and
 * live updates arrive as small deltas over /api/stream.
 */

// ---------------------------------------------------------------- events

/** One telemetry item as stored by the processor. */
export interface StoredEvent {
    /** The hub database's own increasing id. Use it as a cursor ("give me events after seq N"). */
    seq: number;
    /** e.g. "loadbalancer.completed", "backend.request". See EVENT_TYPES. */
    type: string;
    /** Who published it: "lb-balancer" or "lb-backend:<id>". */
    source: string | null;
    /** The request id, when the event belongs to one request. */
    correlationId: string | null;
    /** When it happened (the publisher's clock). */
    at: number;
    payload: Record<string, unknown>;
}

/**
 * Event types and the payload fields the dashboard may rely on.
 *
 * loadbalancer.backendAdded     { backend: { id, url, source }, expiresAt?, at }
 * loadbalancer.backendRemoved   { backendId, reason: "deregistered" | "expired", at }
 * loadbalancer.leaseRenewed     { backendId, expiresAt, at }
 * loadbalancer.dispatched       { requestId, backendId, method, path, at }
 * loadbalancer.completed        { requestId, backendId, status, durationMs, route?, at }
 * loadbalancer.failed           { requestId, backendId?, phase, durationMs?, at }
 * loadbalancer.aborted          { requestId, backendId, at }
 * backend.started               { backendId, port, baseLatencyMs }
 * backend.stopping              { backendId }
 * backend.request               { backendId, method, path, route?, status, durationMs, aborted }
 */
export const EVENT_TYPES = [
    "loadbalancer.backendAdded",
    "loadbalancer.backendRemoved",
    "loadbalancer.leaseRenewed",
    "loadbalancer.dispatched",
    "loadbalancer.completed",
    "loadbalancer.failed",
    "loadbalancer.aborted",
    "backend.started",
    "backend.stopping",
    "backend.request",
] as const;

// ---------------------------------------------------------------- shared shapes

/** Numbers describing the requests that finished in some window. */
export interface WindowStats {
    /** Requests that finished as completed or failed. Aborted ones (the client left) are not counted. */
    count: number;
    /** Failed requests plus completed ones with a status of 500 or more. */
    errors: number;
    /** errors / count, 0 when count is 0. */
    errorRate: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    /** Finished requests per second over the window. */
    perSecond: number;
}

export interface BackendNode {
    id: string;
    url: string | null;
    /** "active" until it deregisters or its lease expires. */
    status: "active" | "removed";
    firstSeenAt: number;
    lastSeenAt: number;
    /** From the last lease renewal; null once removed. */
    leaseExpiresAt: number | null;
    removedAt: number | null;
    removalReason: "deregistered" | "expired" | null;
    /** Requests dispatched to it that have not finished yet (from the last 30 s of events). */
    inFlight: number;
    /** Stats over the last 60 s. */
    recent: WindowStats;
}

export interface RouteStats {
    backendId: string;
    /** The route template ("/users/:id"), or "(unmatched)". */
    route: string;
    method: string;
    stats: WindowStats;
}

/** One reading of the broker queue, taken by the processor from the broker's admin API. */
export interface QueueSample {
    at: number;
    queue: string;
    /** Items waiting in the main queue. */
    depth: number;
    /** Items handed out but not yet acknowledged. */
    inFlight: number;
    /** Items in the spill buffer plus spill files. */
    spilled: number;
    waitingConsumers: number;
    /** Lifetime counters on the broker. */
    published: number;
    taken: number;
    acknowledged: number;
    redelivered: number;
    dropped: number;
    rejected: number;
    expired: number;
    maxSize: number;
    highWaterMark: number;
    /** Items per second published and acknowledged since the previous sample (0 for the first). */
    publishRate: number;
    ackRate: number;
}

// ---------------------------------------------------------------- GET /api/topology

export interface TopologyResponse {
    now: number;
    /** Balancer seen in telemetry, or null if none has reported. */
    balancer: { source: string; lastSeenAt: number } | null;
    /** Active backends first, then recently removed ones (removed within the last 5 minutes). */
    backends: BackendNode[];
    /** Whole-system stats over the last 60 s. */
    recent: WindowStats;
}

// ---------------------------------------------------------------- GET /api/summary?windowMs=60000

/** windowMs is clamped to 5 s .. 24 h. routes has at most 50 rows, busiest first. */
export interface SummaryResponse {
    from: number;
    to: number;
    totals: WindowStats;
    statusClasses: { "2xx": number; "3xx": number; "4xx": number; "5xx": number; failed: number };
    backends: Array<{ backendId: string; stats: WindowStats }>;
    routes: RouteStats[];
}

// ---------------------------------------------------------------- GET /api/timeseries

/**
 * Query: from, to, bucketMs (optional), backendId (optional), route (optional).
 * The server widens bucketMs so there are at most 600 points, and answers with
 * the bucketMs it used. Empty buckets are included with zeroes so a chart has no gaps.
 */
export interface TimeseriesResponse {
    from: number;
    to: number;
    bucketMs: number;
    points: Array<{ t: number; count: number; errors: number; avgMs: number; maxMs: number }>;
}

// ---------------------------------------------------------------- GET /api/events

/**
 * Query: afterSeq (events with a larger seq, oldest first), or beforeSeq
 * (events with a smaller seq, newest first), plus limit (1..500, default 100),
 * type (optional, repeatable) and source (optional).
 * With neither cursor you get the newest `limit` events, newest first.
 * lastSeq is the largest seq in the database right now.
 */
export interface EventsResponse {
    events: StoredEvent[];
    lastSeq: number;
}

// ---------------------------------------------------------------- GET /api/requests

/** Query: limit (1..200, default 50), backendId, since (epoch ms). Newest first. */
export interface RequestRow {
    requestId: string;
    backendId: string | null;
    method: string | null;
    path: string | null;
    route: string | null;
    status: number | null;
    durationMs: number | null;
    dispatchedAt: number | null;
    finishedAt: number | null;
    outcome: "pending" | "completed" | "failed" | "aborted";
}
export interface RequestsResponse {
    requests: RequestRow[];
}

// ---------------------------------------------------------------- GET /api/queue

export interface ProcessorStatus {
    /** True when the processor has stored something or polled the broker in the last 15 s. */
    alive: boolean;
    lastStoredAt: number | null;
    lastPolledAt: number | null;
    /** Items stored since the processor started. */
    storedTotal: number;
    /** Items the database already had (redelivered after a crash), skipped. */
    duplicatesSkipped: number;
    lastError: string | null;
}

export interface QueueResponse {
    now: number;
    /** The newest sample, or null if the processor has not polled yet. */
    latest: QueueSample | null;
    /** Newest 60 samples, oldest first, for a sparkline. */
    recent: QueueSample[];
    processor: ProcessorStatus;
}

// ---------------------------------------------------------------- GET /api/queue/series

/** Query: from, to, bucketMs (optional; at most 600 points). Each point is the last sample in its bucket. */
export interface QueueSeriesResponse {
    from: number;
    to: number;
    bucketMs: number;
    points: QueueSample[];
}

// ---------------------------------------------------------------- GET /api/db

/** What the database holds, so the dashboard can show that the queue and the telemetry are really stored. */
export interface DatabaseResponse {
    path: string;
    sizeBytes: number;
    tables: Array<{ name: string; rows: number; oldestAt: number | null; newestAt: number | null }>;
    /** Rows older than this are deleted by the processor's retention sweep. */
    retentionMs: number;
}

// ---------------------------------------------------------------- GET /api/stream (server-sent events)

/**
 * Event names on the stream:
 *   hello   data: StreamHello         once, right after connecting
 *   events  data: StoredEvent[]       new stored events, oldest first, batched up to every 250 ms
 *   queue   data: QueueSample         each new queue reading (about every 2 s)
 *   resync  data: StreamHello         this connection fell behind and events were skipped: reload with /api/events and /api/topology
 *   ping    data: {}                  every 15 s, to keep the connection open
 * The stream starts at "now": load history with /api/events first, then use
 * the stream for anything newer than hello.lastSeq. EventSource reconnects on
 * its own; send ?afterSeq=<last seq seen> on reconnect to receive what was missed
 * (at most 500 events are replayed).
 */
export interface StreamHello {
    lastSeq: number;
    now: number;
}
