import { BadRequestError, Context, Empire } from "empire-ts";
import { TelemetryQueries } from "../db/TelemetryQueries";
import { LiveStream } from "./LiveStream";
import { clamp, optionalNumber } from "./parseQuery";

const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const DAY = 24 * HOUR;
const DEFAULT_RANGE_MS = 15 * 60 * SECOND;
const MAX_RANGE_MS = 7 * DAY;
const DEFAULT_WINDOW_MS = 60 * SECOND;
const MIN_WINDOW_MS = 5 * SECOND;
const MAX_WINDOW_MS = DAY;
const DB_INFO_CACHE_MS = 5 * SECOND;

/** The JSON API the dashboard reads. Every route answers a bounded amount of data; see src/shared/apiTypes.ts. */
export class ApiRoutes {
    private dbInfo: { at: number; value: unknown } | undefined;

    constructor(
        private readonly queries: TelemetryQueries,
        private readonly live: LiveStream,
        private readonly now: () => number = Date.now
    ) {}

    register(app: Empire): void {
        app.get("/api/health", (ctx) => this.json(ctx, { status: "up", now: this.now(), streams: this.live.connected }));
        app.get("/api/topology", (ctx) => this.json(ctx, this.queries.topology.run(this.now())));

        app.get("/api/summary", (ctx) => {
            const windowMs = clamp(optionalNumber(ctx.query, "windowMs") ?? DEFAULT_WINDOW_MS, MIN_WINDOW_MS, MAX_WINDOW_MS);
            const to = this.now() + 1;
            this.json(ctx, this.queries.summary.run(to - windowMs, to));
        });

        app.get("/api/timeseries", (ctx) => {
            const { from, to } = this.range(ctx);
            this.json(ctx, this.queries.timeseries.run(from, to, optionalNumber(ctx.query, "bucketMs"), {
                backendId: ctx.query.get("backendId") ?? undefined,
                route: ctx.query.get("route") ?? undefined,
            }));
        });

        app.get("/api/events", (ctx) => {
            this.json(ctx, this.queries.events.run({
                afterSeq: optionalNumber(ctx.query, "afterSeq"),
                beforeSeq: optionalNumber(ctx.query, "beforeSeq"),
                limit: optionalNumber(ctx.query, "limit"),
                types: ctx.query.getAll("type"),
                source: ctx.query.get("source") ?? undefined,
            }));
        });

        app.get("/api/requests", (ctx) => {
            this.json(ctx, this.queries.requests.run({
                limit: optionalNumber(ctx.query, "limit"),
                backendId: ctx.query.get("backendId") ?? undefined,
                since: optionalNumber(ctx.query, "since"),
            }));
        });

        app.get("/api/queue", (ctx) => this.json(ctx, this.queries.queue.current(this.now())));

        app.get("/api/queue/series", (ctx) => {
            const { from, to } = this.range(ctx);
            this.json(ctx, this.queries.queue.series(from, to, optionalNumber(ctx.query, "bucketMs")));
        });

        app.get("/api/db", (ctx) => {
            const now = this.now();

            if (this.dbInfo === undefined || now - this.dbInfo.at > DB_INFO_CACHE_MS) {
                this.dbInfo = { at: now, value: this.queries.info.run() };
            }

            this.json(ctx, this.dbInfo.value);
        });

        app.get("/api/stream", (ctx) => this.live.attach(ctx.res, optionalNumber(ctx.query, "afterSeq")));
    }

    private range(ctx: Context): { from: number; to: number } {
        const to = optionalNumber(ctx.query, "to") ?? this.now();
        const from = optionalNumber(ctx.query, "from") ?? to - DEFAULT_RANGE_MS;

        if (from >= to) {
            throw new BadRequestError('"from" must be before "to".');
        }

        return { from: Math.max(from, to - MAX_RANGE_MS), to };
    }

    private json(ctx: Context, body: unknown): void {
        ctx.header("Cache-Control", "no-store");
        ctx.json(body);
    }
}
