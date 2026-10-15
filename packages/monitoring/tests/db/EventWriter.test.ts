import { beforeEach, describe, expect, it } from "vitest";
import { EventWriter } from "../../src/db/EventWriter";
import { TelemetryDatabase } from "../../src/db/TelemetryDatabase";
import { item, makeDatabase, storeRequest, T0 } from "../fixtures/makeDatabase";

describe("EventWriter", () => {
    let db: TelemetryDatabase;
    let writer: EventWriter;
    const one = <T>(sql: string, ...params: Array<string | number>): T => db.raw.prepare(sql).get(...params) as T;
    const all = <T>(sql: string): T[] => db.raw.prepare(sql).all() as T[];

    beforeEach(() => {
        db = makeDatabase();
        writer = new EventWriter(db, () => T0 + 5);
    });

    it("stores the raw event with its payload intact", () => {
        const result = writer.storeBatch([item("backend.started", { backendId: "alpha", port: 8021 }, T0, { source: "lb-backend:alpha" })]);

        expect(result).toEqual({ stored: 1, duplicates: 0, invalid: 0, projectionErrors: 0 });
        const row = one<{ type: string; source: string; created_at: number; stored_at: number; payload: string }>("SELECT * FROM events");
        expect(row.type).toBe("backend.started");
        expect(row.source).toBe("lb-backend:alpha");
        expect(row.created_at).toBe(T0);
        expect(row.stored_at).toBe(T0 + 5);
        expect(JSON.parse(row.payload)).toEqual({ backendId: "alpha", port: 8021 });
    });

    it("skips an item the broker delivers twice, and does not count it twice in the summaries", () => {
        const completed = item("loadbalancer.completed", { requestId: "r1", backendId: "alpha", status: 200, durationMs: 10, route: "/a" }, T0);

        writer.storeBatch([completed]);
        const again = writer.storeBatch([completed]);

        expect(again).toEqual({ stored: 0, duplicates: 1, invalid: 0, projectionErrors: 0 });
        expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM events").n).toBe(1);
        expect(one<{ count: number }>("SELECT count FROM buckets").count).toBe(1);
    });

    it("builds one request row from dispatch and completion, and one bucket", () => {
        storeRequest(writer, { id: "r1", backend: "alpha", route: "/users/:id", status: 200, durationMs: 12, at: T0 + 2000 });

        const request = one<Record<string, unknown>>("SELECT * FROM requests");
        expect(request).toMatchObject({ request_id: "r1", backend_id: "alpha", method: "GET", route: "/users/:id", status: 200, duration_ms: 12, outcome: "completed", finished_at: T0 + 2000 });
        expect(one<Record<string, unknown>>("SELECT * FROM buckets")).toMatchObject({ bucket_start: T0 + 2000, kind: "lb", backend_id: "alpha", route: "/users/:id", count: 1, errors: 0, sum_ms: 12, max_ms: 12 });
    });

    it("adds up requests that land in the same second", () => {
        storeRequest(writer, { id: "a", backend: "alpha", route: "/r", durationMs: 10, at: T0 + 100 });
        storeRequest(writer, { id: "b", backend: "alpha", route: "/r", durationMs: 30, at: T0 + 900 });

        expect(one<Record<string, unknown>>("SELECT * FROM buckets")).toMatchObject({ count: 2, sum_ms: 40, max_ms: 30 });
    });

    it("counts 5xx and failed requests as errors, and aborted ones as neither", () => {
        storeRequest(writer, { id: "s", backend: "alpha", route: "/r", status: 503, durationMs: 5, at: T0 });
        storeRequest(writer, { id: "f", backend: "alpha", durationMs: 5, at: T0, failed: true });
        writer.storeBatch([item("loadbalancer.aborted", { requestId: "x", backendId: "alpha" }, T0)]);

        const totals = one<{ count: number; errors: number }>("SELECT SUM(count) AS count, SUM(errors) AS errors FROM buckets");
        expect(totals).toEqual({ count: 2, errors: 2 });
        expect(one<{ outcome: string }>("SELECT outcome FROM requests WHERE request_id = 'x'").outcome).toBe("aborted");
        expect(one<{ outcome: string }>("SELECT outcome FROM requests WHERE request_id = 'f'").outcome).toBe("failed");
    });

    it("treats a request id that comes back after it finished as a new request (the balancer restarted)", () => {
        storeRequest(writer, { id: "lb-1", backend: "alpha", route: "/old", status: 200, durationMs: 5, at: T0 });
        writer.storeBatch([item("loadbalancer.dispatched", { requestId: "lb-1", backendId: "beta", method: "POST", path: "/new" }, T0 + 60_000)]);

        expect(one<Record<string, unknown>>("SELECT * FROM requests")).toMatchObject({ backend_id: "beta", method: "POST", path: "/new", outcome: "pending", status: null, finished_at: null });
    });

    it("keeps backend side events out of the balancer's buckets", () => {
        writer.storeBatch([item("backend.request", { backendId: "alpha", method: "GET", path: "/a", route: "/a", status: 200, durationMs: 4, aborted: false }, T0, { source: "lb-backend:alpha" })]);

        expect(one<{ kind: string }>("SELECT kind FROM buckets").kind).toBe("backend");
        expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM requests").n).toBe(0);
    });

    it("follows a backend from joining to heartbeats to leaving", () => {
        writer.storeBatch([item("loadbalancer.backendAdded", { backend: { id: "alpha", url: "http://127.0.0.1:8021", source: "registered" }, expiresAt: T0 + 5000 }, T0)]);
        writer.storeBatch([item("loadbalancer.leaseRenewed", { backendId: "alpha", expiresAt: T0 + 6000 }, T0 + 1000)]);

        expect(one<Record<string, unknown>>("SELECT * FROM backends")).toMatchObject({ id: "alpha", url: "http://127.0.0.1:8021", status: "active", first_seen_at: T0, last_seen_at: T0 + 1000, lease_expires_at: T0 + 6000 });

        writer.storeBatch([item("loadbalancer.backendRemoved", { backendId: "alpha", reason: "expired" }, T0 + 9000)]);
        expect(one<Record<string, unknown>>("SELECT * FROM backends")).toMatchObject({ status: "removed", removal_reason: "expired", removed_at: T0 + 9000, lease_expires_at: null });

        writer.storeBatch([item("loadbalancer.backendAdded", { backend: { id: "alpha", url: "http://127.0.0.1:8021", source: "registered" }, expiresAt: T0 + 20_000 }, T0 + 15_000)]);
        expect(one<Record<string, unknown>>("SELECT * FROM backends")).toMatchObject({ status: "active", removed_at: null, removal_reason: null, first_seen_at: T0 });
    });

    it("remembers who has been publishing", () => {
        writer.storeBatch([item("backend.started", { backendId: "a" }, T0, { source: "lb-backend:a" }), item("backend.started", { backendId: "a" }, T0 + 50, { source: "lb-backend:a" })]);

        expect(one<Record<string, unknown>>("SELECT * FROM sources")).toMatchObject({ source: "lb-backend:a", first_seen_at: T0, last_seen_at: T0 + 50 });
    });

    it("stores an event whose fields have the wrong types without failing the batch", () => {
        const result = writer.storeBatch([
            item("loadbalancer.completed", { requestId: 42, backendId: ["x"], status: "oops", durationMs: NaN }, T0),
            item("loadbalancer.dispatched", { requestId: "ok", backendId: "alpha", method: "GET", path: "/" }, T0),
        ]);

        expect(result.stored).toBe(2);
        expect(result.projectionErrors).toBe(0);
        expect(all("SELECT * FROM requests")).toHaveLength(1);
    });

    it("wraps a payload that is not an object", () => {
        writer.storeBatch([item("custom.thing", 5 as unknown as Record<string, unknown>, T0)]);

        expect(JSON.parse(one<{ payload: string }>("SELECT payload FROM events").payload)).toEqual({ value: 5 });
    });

    it("skips an item that is not well formed instead of failing the batch or calling it a duplicate", () => {
        const noTime = item("x", {}, T0);
        (noTime as { createdAt: unknown }).createdAt = null;
        const noType = { ...item("y", {}, T0), type: "" };

        const result = writer.storeBatch([item("ok", {}, T0), noTime, noType]);

        expect(result).toEqual({ stored: 1, duplicates: 0, invalid: 2, projectionErrors: 0 });
        expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM events").n).toBe(1);
    });

    it("rolls back a transaction that throws", () => {
        expect(() => db.transaction(() => {
            db.raw.exec("INSERT INTO sources (source, first_seen_at, last_seen_at) VALUES ('a', 1, 1)");
            throw new Error("boom");
        })).toThrow("boom");
        expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM sources").n).toBe(0);
    });
});
