/** Bump when the tables change, and add the migration to MIGRATIONS. */
export const SCHEMA_VERSION = 1;

/**
 * Every statement is idempotent (`IF NOT EXISTS`), so the processor and the web
 * server can both open a fresh file at the same moment.
 *
 * - `events`: every telemetry item, as published. The raw record; everything else can be rebuilt from it.
 * - `requests`: one row per proxied request, built from its dispatched / completed / failed / aborted events.
 * - `buckets`: one row per second, backend and route with counts and latency sums, so charts read hundreds of
 *   rows instead of scanning requests.
 * - `backends` and `sources`: who is (or was) in the ring and who is publishing.
 * - `queue_samples`: periodic readings of the broker queue itself.
 * - `processor_status`: a single row the processor keeps current, so the web server can say whether it is alive.
 */
export const MIGRATIONS: readonly string[][] = [
    [
        `CREATE TABLE IF NOT EXISTS events (
            seq            INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id        TEXT    NOT NULL UNIQUE,
            queue_seq      INTEGER,
            type           TEXT    NOT NULL,
            source         TEXT,
            correlation_id TEXT,
            created_at     INTEGER NOT NULL,
            enqueued_at    INTEGER,
            stored_at      INTEGER NOT NULL,
            payload        TEXT    NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS events_by_time ON events (created_at)`,
        `CREATE INDEX IF NOT EXISTS events_by_type ON events (type, seq)`,
        `CREATE INDEX IF NOT EXISTS events_by_correlation ON events (correlation_id)`,

        `CREATE TABLE IF NOT EXISTS requests (
            request_id    TEXT PRIMARY KEY,
            backend_id    TEXT,
            method        TEXT,
            path          TEXT,
            route         TEXT,
            status        INTEGER,
            duration_ms   INTEGER,
            dispatched_at INTEGER,
            finished_at   INTEGER,
            outcome       TEXT NOT NULL DEFAULT 'pending'
        )`,
        `CREATE INDEX IF NOT EXISTS requests_by_finish ON requests (finished_at)`,
        `CREATE INDEX IF NOT EXISTS requests_by_dispatch ON requests (dispatched_at)`,
        `CREATE INDEX IF NOT EXISTS requests_by_backend ON requests (backend_id, finished_at)`,

        `CREATE TABLE IF NOT EXISTS buckets (
            bucket_start INTEGER NOT NULL,
            kind         TEXT    NOT NULL,
            backend_id   TEXT    NOT NULL,
            route        TEXT    NOT NULL,
            count        INTEGER NOT NULL DEFAULT 0,
            errors       INTEGER NOT NULL DEFAULT 0,
            sum_ms       INTEGER NOT NULL DEFAULT 0,
            max_ms       INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (bucket_start, kind, backend_id, route)
        ) WITHOUT ROWID`,

        `CREATE TABLE IF NOT EXISTS backends (
            id               TEXT PRIMARY KEY,
            url              TEXT,
            status           TEXT NOT NULL DEFAULT 'active',
            first_seen_at    INTEGER NOT NULL,
            last_seen_at     INTEGER NOT NULL,
            lease_expires_at INTEGER,
            removed_at       INTEGER,
            removal_reason   TEXT
        )`,

        `CREATE TABLE IF NOT EXISTS sources (
            source        TEXT PRIMARY KEY,
            first_seen_at INTEGER NOT NULL,
            last_seen_at  INTEGER NOT NULL
        )`,

        `CREATE TABLE IF NOT EXISTS queue_samples (
            at                INTEGER NOT NULL,
            queue             TEXT    NOT NULL,
            depth             INTEGER NOT NULL,
            in_flight         INTEGER NOT NULL,
            spilled           INTEGER NOT NULL,
            waiting_consumers INTEGER NOT NULL,
            published         INTEGER NOT NULL,
            taken             INTEGER NOT NULL,
            acknowledged      INTEGER NOT NULL,
            redelivered       INTEGER NOT NULL,
            dropped           INTEGER NOT NULL,
            rejected          INTEGER NOT NULL,
            expired           INTEGER NOT NULL,
            max_size          INTEGER NOT NULL,
            high_water_mark   INTEGER NOT NULL,
            publish_rate      REAL    NOT NULL,
            ack_rate          REAL    NOT NULL,
            PRIMARY KEY (queue, at)
        ) WITHOUT ROWID`,

        `CREATE TABLE IF NOT EXISTS processor_status (
            id                 INTEGER PRIMARY KEY CHECK (id = 1),
            started_at         INTEGER,
            updated_at         INTEGER,
            stored_total       INTEGER NOT NULL DEFAULT 0,
            duplicates_skipped INTEGER NOT NULL DEFAULT 0,
            last_stored_at     INTEGER,
            last_polled_at     INTEGER,
            last_error         TEXT
        )`,
        `INSERT OR IGNORE INTO processor_status (id) VALUES (1)`,
    ],
];
