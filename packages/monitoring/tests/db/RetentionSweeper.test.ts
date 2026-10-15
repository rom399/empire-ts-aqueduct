import { describe, expect, it } from "vitest";
import { EventWriter } from "../../src/db/EventWriter";
import { QueueSampleStore } from "../../src/db/QueueSampleStore";
import { RetentionSweeper } from "../../src/db/RetentionSweeper";
import { item, makeDatabase, storeRequest, T0 } from "../fixtures/makeDatabase";

const HOUR = 3_600_000;

describe("RetentionSweeper", () => {
    it("deletes rows older than the retention period from every table and keeps the rest", () => {
        const db = makeDatabase();
        const writer = new EventWriter(db, () => T0);
        storeRequest(writer, { id: "old", backend: "alpha", route: "/a", durationMs: 1, at: T0 - 30 * HOUR });
        storeRequest(writer, { id: "new", backend: "alpha", route: "/a", durationMs: 1, at: T0 - HOUR });
        const samples = new QueueSampleStore(db);
        const base = { queue: "q", depth: 0, inFlight: 0, spilled: 0, waitingConsumers: 0, published: 0, taken: 0, acknowledged: 0, redelivered: 0, dropped: 0, rejected: 0, expired: 0, maxSize: 1, highWaterMark: 0, publishRate: 0, ackRate: 0 };
        samples.save({ ...base, at: T0 - 30 * HOUR });
        samples.save({ ...base, at: T0 - HOUR });

        const deleted = new RetentionSweeper(db, 24 * HOUR).sweep(T0);
        const count = (table: string): number => (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

        expect(deleted).toBeGreaterThan(0);
        expect(count("events")).toBe(2);
        expect(count("requests")).toBe(1);
        expect(count("buckets")).toBe(1);
        expect(count("queue_samples")).toBe(1);
    });

    it("removes backends that left more than a day ago, but not active ones", () => {
        const db = makeDatabase();
        const writer = new EventWriter(db, () => T0);
        writer.storeBatch([
            item("loadbalancer.backendAdded", { backend: { id: "gone", url: "http://a" }, expiresAt: T0 }, T0 - 50 * HOUR),
            item("loadbalancer.backendRemoved", { backendId: "gone", reason: "expired" }, T0 - 49 * HOUR),
            item("loadbalancer.backendAdded", { backend: { id: "here", url: "http://b" }, expiresAt: T0 }, T0 - 50 * HOUR),
        ]);

        new RetentionSweeper(db, 1000 * HOUR).sweep(T0);

        expect((db.raw.prepare("SELECT id FROM backends").all() as Array<{ id: string }>).map((r) => r.id)).toEqual(["here"]);
    });
});
