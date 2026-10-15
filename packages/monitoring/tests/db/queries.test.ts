import { beforeEach, describe, expect, it } from "vitest";
import { EventWriter } from "../../src/db/EventWriter";
import { QueueSampleStore } from "../../src/db/QueueSampleStore";
import { TelemetryDatabase } from "../../src/db/TelemetryDatabase";
import { TelemetryQueries } from "../../src/db/TelemetryQueries";
import { MAX_POINTS } from "../../src/db/TimeseriesQuery";
import { QueueSample } from "../../src/shared/apiTypes";
import { item, makeDatabase, storeRequest, T0 } from "../fixtures/makeDatabase";

const sample = (at: number, over: Partial<QueueSample> = {}): QueueSample => ({
    at, queue: "q", depth: 0, inFlight: 0, spilled: 0, waitingConsumers: 1, published: 0, taken: 0, acknowledged: 0, redelivered: 0,
    dropped: 0, rejected: 0, expired: 0, maxSize: 1000, highWaterMark: 0, publishRate: 0, ackRate: 0, ...over,
});

describe("queries", () => {
    let db: TelemetryDatabase;
    let writer: EventWriter;
    let queries: TelemetryQueries;

    beforeEach(() => {
        db = makeDatabase();
        writer = new EventWriter(db, () => T0);
        queries = new TelemetryQueries(db, 86_400_000);
    });

    describe("summary", () => {
        it("computes exact percentiles, error rate and rate from the window", () => {
            for (let i = 1; i <= 100; i++) {
                storeRequest(writer, { id: `r${i}`, backend: "alpha", route: "/a", status: i <= 5 ? 500 : 200, durationMs: i, at: T0 + i * 100 });
            }

            const { totals } = queries.summary.run(T0, T0 + 20_000);

            expect(totals.count).toBe(100);
            expect(totals.errors).toBe(5);
            expect(totals.errorRate).toBeCloseTo(0.05);
            expect(totals.p50Ms).toBe(50);
            expect(totals.p95Ms).toBe(95);
            expect(totals.maxMs).toBe(100);
            expect(totals.avgMs).toBeCloseTo(50.5);
            expect(totals.perSecond).toBeCloseTo(5);
        });

        it("returns zeros for an empty window, never NaN", () => {
            const { totals, backends, routes } = queries.summary.run(T0, T0 + 1000);

            expect(totals).toEqual({ count: 0, errors: 0, errorRate: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0, perSecond: 0 });
            expect(backends).toEqual([]);
            expect(routes).toEqual([]);
        });

        it("splits by status class, backend and route, and excludes what is outside the window", () => {
            storeRequest(writer, { id: "a", backend: "alpha", route: "/a", status: 200, durationMs: 5, at: T0 + 100 });
            storeRequest(writer, { id: "b", backend: "alpha", route: "/b", status: 404, durationMs: 5, at: T0 + 200 });
            storeRequest(writer, { id: "c", backend: "beta", route: "/a", status: 503, durationMs: 5, at: T0 + 300 });
            storeRequest(writer, { id: "d", backend: "beta", durationMs: 5, at: T0 + 400, failed: true });
            storeRequest(writer, { id: "old", backend: "beta", route: "/a", status: 200, durationMs: 5, at: T0 - 60_000 });

            const summary = queries.summary.run(T0, T0 + 1000);

            expect(summary.statusClasses).toEqual({ "2xx": 1, "3xx": 0, "4xx": 1, "5xx": 1, failed: 1 });
            expect(summary.backends.map((b) => [b.backendId, b.stats.count] as const).sort((x, y) => x[0].localeCompare(y[0]))).toEqual([["alpha", 2], ["beta", 2]]);
            expect(summary.routes.find((r) => r.backendId === "alpha" && r.route === "/a")?.stats.count).toBe(1);
            expect(summary.routes.some((r) => r.route === "(unmatched)" && r.backendId === "beta")).toBe(true);
        });
    });

    describe("timeseries", () => {
        it("fills empty slices with zeroes so a chart has no gaps", () => {
            storeRequest(writer, { id: "a", backend: "alpha", route: "/a", status: 200, durationMs: 10, at: T0 + 1000 });
            storeRequest(writer, { id: "b", backend: "alpha", route: "/a", status: 500, durationMs: 30, at: T0 + 4000 });

            const series = queries.timeseries.run(T0, T0 + 6000, 1000, {});

            expect(series.bucketMs).toBe(1000);
            expect(series.points.map((p) => p.count)).toEqual([0, 1, 0, 0, 1, 0]);
            expect(series.points[4]).toMatchObject({ errors: 1, avgMs: 30, maxMs: 30 });
        });

        it("groups several seconds into one slice when the slices are wider", () => {
            [1000, 1500, 2000, 3500].forEach((offset, i) => storeRequest(writer, { id: `r${i}`, backend: "alpha", route: "/a", durationMs: 10, at: T0 + offset }));

            const series = queries.timeseries.run(T0, T0 + 4000, 2000, {});

            expect(series.bucketMs).toBe(2000);
            expect(series.points.map((p) => p.count)).toEqual([2, 2]);
        });

        it("filters by backend and route", () => {
            storeRequest(writer, { id: "a", backend: "alpha", route: "/a", durationMs: 1, at: T0 + 1000 });
            storeRequest(writer, { id: "b", backend: "beta", route: "/a", durationMs: 1, at: T0 + 1000 });
            storeRequest(writer, { id: "c", backend: "alpha", route: "/b", durationMs: 1, at: T0 + 1000 });
            const total = (filter: { backendId?: string; route?: string }): number =>
                queries.timeseries.run(T0, T0 + 3000, 1000, filter).points.reduce((sum, p) => sum + p.count, 0);

            expect(total({})).toBe(3);
            expect(total({ backendId: "alpha" })).toBe(2);
            expect(total({ backendId: "alpha", route: "/b" })).toBe(1);
        });

        it("widens the slices so a long range never returns more than the maximum points", () => {
            const day = 24 * 3_600_000;
            const series = queries.timeseries.run(T0 - day, T0, 1000, {});

            expect(series.points.length).toBeLessThanOrEqual(MAX_POINTS + 1);
            expect(series.bucketMs).toBeGreaterThanOrEqual(day / MAX_POINTS);
            expect(series.bucketMs % 1000).toBe(0);
        });
    });

    describe("topology", () => {
        it("lists the ring with per-backend stats and in-flight counts", () => {
            writer.storeBatch([
                item("loadbalancer.backendAdded", { backend: { id: "alpha", url: "http://a", source: "registered" }, expiresAt: T0 + 5000 }, T0),
                item("loadbalancer.dispatched", { requestId: "p1", backendId: "alpha", method: "GET", path: "/" }, T0 + 500),
            ]);
            storeRequest(writer, { id: "done", backend: "alpha", route: "/a", status: 200, durationMs: 20, at: T0 + 800 });

            const topology = queries.topology.run(T0 + 1000);
            const alpha = topology.backends[0];

            expect(topology.balancer?.source).toBe("lb-balancer");
            expect(alpha).toMatchObject({ id: "alpha", status: "active", inFlight: 1, leaseExpiresAt: T0 + 5000 });
            expect(alpha.recent.count).toBe(1);
            expect(topology.recent.count).toBe(1);
        });

        it("shows a removed backend for a few minutes and says why it left", () => {
            writer.storeBatch([
                item("loadbalancer.backendAdded", { backend: { id: "a", url: "http://a", source: "registered" }, expiresAt: T0 + 5000 }, T0),
                item("loadbalancer.backendRemoved", { backendId: "a", reason: "deregistered" }, T0 + 1000),
            ]);

            expect(queries.topology.run(T0 + 60_000).backends[0]).toMatchObject({ id: "a", status: "removed", removalReason: "deregistered", removedAt: T0 + 1000 });
            expect(queries.topology.run(T0 + 10 * 60_000).backends).toEqual([]);
        });

        it("treats a lease that ran out long ago as a crash even if no removal was recorded (the balancer stopped reporting)", () => {
            writer.storeBatch([item("loadbalancer.backendAdded", { backend: { id: "a", url: "http://a", source: "registered" }, expiresAt: T0 + 5000 }, T0)]);

            expect(queries.topology.run(T0 + 5000 + 5000).backends[0].status).toBe("active");
            expect(queries.topology.run(T0 + 5000 + 11_000).backends[0]).toMatchObject({ status: "removed", removalReason: "expired", leaseExpiresAt: null });
        });
    });

    describe("events", () => {
        beforeEach(() => {
            for (let i = 1; i <= 10; i++) {
                writer.storeBatch([item(i % 2 === 0 ? "backend.request" : "loadbalancer.leaseRenewed", { n: i }, T0 + i)]);
            }
        });

        it("returns the newest page first when given no cursor", () => {
            const { events, lastSeq } = queries.events.run({ limit: 3 });

            expect(events.map((e) => e.payload.n)).toEqual([10, 9, 8]);
            expect(lastSeq).toBe(10);
        });

        it("pages forward from a cursor, oldest first, and backward, newest first", () => {
            expect(queries.events.run({ afterSeq: 7 }).events.map((e) => e.seq)).toEqual([8, 9, 10]);
            expect(queries.events.run({ beforeSeq: 4, limit: 2 }).events.map((e) => e.seq)).toEqual([3, 2]);
        });

        it("filters by type and bounds the limit", () => {
            expect(queries.events.run({ types: ["backend.request"] }).events).toHaveLength(5);
            expect(queries.events.run({ limit: 100_000 }).events).toHaveLength(10);
            expect(queries.events.run({ limit: 0 }).events).toHaveLength(1);
        });
    });

    describe("requests", () => {
        it("lists the newest first, and filters", () => {
            storeRequest(writer, { id: "a", backend: "alpha", route: "/a", durationMs: 1, at: T0 + 1000 });
            storeRequest(writer, { id: "b", backend: "beta", route: "/a", durationMs: 1, at: T0 + 2000 });

            expect(queries.requests.run({}).requests.map((r) => r.requestId)).toEqual(["b", "a"]);
            expect(queries.requests.run({ backendId: "alpha" }).requests.map((r) => r.requestId)).toEqual(["a"]);
            expect(queries.requests.run({ since: T0 + 1500 }).requests.map((r) => r.requestId)).toEqual(["b"]);
        });
    });

    describe("queue", () => {
        it("reports the latest reading, recent history and processor liveness", () => {
            const samples = new QueueSampleStore(db);
            [0, 1, 2].forEach((i) => samples.save(sample(T0 + i * 2000, { depth: i * 10 })));

            const current = queries.queue.current(T0 + 5000);

            expect(current.latest?.depth).toBe(20);
            expect(current.recent.map((s) => s.depth)).toEqual([0, 10, 20]);
            expect(current.processor.alive).toBe(false);
        });

        it("has nothing before the first reading", () => {
            expect(queries.queue.current(T0)).toMatchObject({ latest: null, recent: [] });
        });

        it("returns only samples newer than a time, and the last sample in each series slice", () => {
            const samples = new QueueSampleStore(db);
            [0, 1, 2, 3].forEach((i) => samples.save(sample(T0 + i * 1000, { depth: i })));

            expect(queries.queue.since(T0 + 1000).map((s) => s.depth)).toEqual([2, 3]);
            expect(queries.queue.series(T0, T0 + 4000, 2000).points.map((s) => s.depth)).toEqual([1, 3]);
        });
    });

    describe("database overview", () => {
        it("counts rows and the time span of each table", () => {
            storeRequest(writer, { id: "a", backend: "alpha", route: "/a", durationMs: 1, at: T0 + 1000 });

            const info = queries.info.run();
            const events = info.tables.find((t) => t.name === "events");

            expect(events).toMatchObject({ rows: 2, oldestAt: T0 + 999, newestAt: T0 + 1000 });
            expect(info.tables.map((t) => t.name)).toEqual(expect.arrayContaining(["requests", "buckets", "queue_samples", "backends", "sources"]));
            expect(info.retentionMs).toBe(86_400_000);
        });
    });
});
