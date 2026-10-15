import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TelemetryDatabase } from "../../src/db/TelemetryDatabase";
import { TelemetryProcessor } from "../../src/processor/TelemetryProcessor";
import { FakeBroker } from "../fixtures/FakeBroker";
import { makeTempDir, waitFor } from "../fixtures/helpers";

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
const PULL = "pull-secret";
const ADMIN = "admin-secret";

describe("TelemetryProcessor", () => {
    let broker: FakeBroker;
    let url: string;
    let temp: ReturnType<typeof makeTempDir>;
    let dbPath: string;
    let processor: TelemetryProcessor | undefined;
    let reader: TelemetryDatabase | undefined;

    const count = (table: string): number => (reader!.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const start = (extra: Record<string, unknown> = {}): TelemetryProcessor => {
        processor = new TelemetryProcessor({ dbPath, brokerPullUrl: url, queue: "q", pullToken: PULL, adminToken: ADMIN, waitMs: 50, sampleIntervalMs: 40, initialBackoffMs: 30, logger: quiet, ...extra });
        reader = new TelemetryDatabase(dbPath);
        processor.start();
        return processor;
    };

    beforeEach(async () => {
        broker = new FakeBroker(PULL, ADMIN);
        url = await broker.start();
        temp = makeTempDir();
        dbPath = path.join(temp.dir, "t.db");
    });

    afterEach(async () => {
        await processor?.stop();
        reader?.close();
        processor = undefined;
        reader = undefined;
        await broker.stop();
        temp.remove();
    });

    it("stores what the broker hands out, and acknowledges only after the commit", async () => {
        const rowsAtAck: number[] = [];
        broker.onAck = () => rowsAtAck.push(count("events"));
        broker.queueBatch([
            { itemId: "a", type: "backend.started", createdAt: 1000, payload: { backendId: "alpha" }, source: "lb-backend:alpha" },
            { itemId: "b", type: "backend.started", createdAt: 1001, payload: { backendId: "beta" }, source: "lb-backend:beta" },
        ]);
        start();

        await waitFor(() => broker.acks.length === 1);

        expect(rowsAtAck).toEqual([2]);
        expect(count("events")).toBe(2);
        expect(count("backends")).toBe(2);
    });

    it("skips a batch it already stored when the broker delivers it again, and says so", async () => {
        const items = [{ itemId: "a", type: "custom", createdAt: 1000 }, { itemId: "b", type: "custom", createdAt: 1001 }];
        broker.queueBatch(items);
        broker.queueBatch(items);
        start();

        await waitFor(() => broker.acks.length === 2);

        expect(count("events")).toBe(2);
        const status = reader!.raw.prepare("SELECT stored_total, duplicates_skipped FROM processor_status").get() as { stored_total: number; duplicates_skipped: number };
        expect(status).toEqual({ stored_total: 2, duplicates_skipped: 2 });
    });

    it("keeps going after the broker fails, records the error, and stores once it recovers", async () => {
        broker.failTakes = 2;
        broker.queueBatch([{ itemId: "a", type: "custom", createdAt: 1000 }]);
        start();

        await waitFor(() => broker.acks.length === 1);

        expect(count("events")).toBe(1);
        expect(reader!.raw.prepare("SELECT last_error FROM processor_status").get()).toMatchObject({ last_error: expect.stringContaining("500") });
    });

    it("samples the queue into the database, with rates worked out between readings", async () => {
        start();
        await waitFor(() => count("queue_samples") >= 1);
        broker.stats = { ...broker.stats, published: 110, acknowledged: 104 };
        await waitFor(() => (reader!.raw.prepare("SELECT MAX(publish_rate) AS r FROM queue_samples").get() as { r: number }).r > 0);

        const latest = reader!.raw.prepare("SELECT * FROM queue_samples ORDER BY at DESC LIMIT 1").get() as Record<string, number | string>;
        expect(latest).toMatchObject({ queue: "q", depth: 5, in_flight: 1, max_size: 100, high_water_mark: 7 });
        expect((reader!.raw.prepare("SELECT MAX(ack_rate) AS r FROM queue_samples").get() as { r: number }).r).toBeGreaterThan(0);
    });

    it("drains but does not sample when there is no admin token", async () => {
        broker.queueBatch([{ itemId: "a", type: "custom", createdAt: 1000 }]);
        start({ adminToken: undefined });

        await waitFor(() => broker.acks.length === 1);

        expect(count("queue_samples")).toBe(0);
    });

    it("stops promptly even while waiting on an empty queue", async () => {
        start();
        await waitFor(() => broker.takes.length >= 1);
        const began = Date.now();

        await processor!.stop();
        processor = undefined;

        expect(Date.now() - began).toBeLessThan(1500);
    });

    it("reports itself alive in the database while it runs", async () => {
        start();
        await waitFor(() => (reader!.raw.prepare("SELECT updated_at FROM processor_status").get() as { updated_at: number | null }).updated_at !== null);

        const row = reader!.raw.prepare("SELECT started_at, last_polled_at FROM processor_status").get() as { started_at: number; last_polled_at: number };
        expect(row.started_at).toBeGreaterThan(0);
    });
});
