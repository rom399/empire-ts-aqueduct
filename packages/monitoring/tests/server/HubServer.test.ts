import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventWriter } from "../../src/db/EventWriter";
import { QueueSampleStore } from "../../src/db/QueueSampleStore";
import { TelemetryDatabase } from "../../src/db/TelemetryDatabase";
import { HubServer } from "../../src/server/HubServer";
import { item, storeRequest } from "../fixtures/makeDatabase";
import { freePort, makeTempDir } from "../fixtures/helpers";

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

/** Reads server-sent events from a response until `done` says enough, then closes it. */
async function readStream(url: string, done: (events: Array<{ event: string; data: unknown }>) => boolean, timeoutMs = 3000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const events: Array<{ event: string; data: unknown }> = [];
    let buffer = "";

    try {
        while (!done(events)) {
            const { value, done: finished } = await reader.read();

            if (finished) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";

            for (const frame of frames) {
                const event = /^event: (.+)$/m.exec(frame)?.[1];
                const data = /^data: (.+)$/m.exec(frame)?.[1];

                if (event && data) {
                    events.push({ event, data: JSON.parse(data) });
                }
            }
        }
    } finally {
        clearTimeout(timer);
        controller.abort();
    }

    return { events, headers: response.headers };
}

describe("HubServer", () => {
    let temp: ReturnType<typeof makeTempDir>;
    let writerDb: TelemetryDatabase;
    let writer: EventWriter;
    let server: HubServer;
    let base: string;
    const NOW = Date.now();

    const start = async (webRoot?: string): Promise<void> => {
        const port = await freePort();
        server = new HubServer({ dbPath: path.join(temp.dir, "t.db"), port, webRoot, logger: quiet, livePollMs: 20 });
        await server.start();
        base = `http://127.0.0.1:${port}`;
    };

    beforeEach(() => {
        temp = makeTempDir();
        writerDb = new TelemetryDatabase(path.join(temp.dir, "t.db"));
        writer = new EventWriter(writerDb);
    });

    afterEach(async () => {
        await server?.stop();
        writerDb.close();
        temp.remove();
    });

    it("answers the read endpoints with JSON and no caching", async () => {
        writer.storeBatch([item("loadbalancer.backendAdded", { backend: { id: "alpha", url: "http://a", source: "registered" }, expiresAt: NOW + 5000 }, NOW)]);
        storeRequest(writer, { id: "r1", backend: "alpha", route: "/a", status: 200, durationMs: 9, at: NOW });
        new QueueSampleStore(writerDb).save({ at: NOW, queue: "q", depth: 3, inFlight: 0, spilled: 0, waitingConsumers: 1, published: 9, taken: 9, acknowledged: 9, redelivered: 0, dropped: 0, rejected: 0, expired: 0, maxSize: 10, highWaterMark: 3, publishRate: 1, ackRate: 1 });
        await start();

        for (const endpoint of ["topology", "summary", "timeseries", "events", "requests", "queue", "queue/series", "db", "health"]) {
            const response = await fetch(`${base}/api/${endpoint}`);

            expect(response.status, endpoint).toBe(200);
            expect(response.headers.get("cache-control"), endpoint).toBe("no-store");
        }

        const topology = (await (await fetch(`${base}/api/topology`)).json()) as { backends: Array<{ id: string }> };
        const queue = (await (await fetch(`${base}/api/queue`)).json()) as { latest: { depth: number } };
        expect(topology.backends.map((b) => b.id)).toEqual(["alpha"]);
        expect(queue.latest.depth).toBe(3);
    });

    it("rejects a malformed number with a 400 and a JSON message", async () => {
        await start();

        const response = await fetch(`${base}/api/events?limit=abc`);

        expect(response.status).toBe(400);
        expect(((await response.json()) as { error: string }).error).toContain("limit");
        expect((await fetch(`${base}/api/timeseries?from=100&to=50`)).status).toBe(400);
    });

    it("bounds what one request can pull out of the database", async () => {
        for (let i = 0; i < 700; i++) {
            writer.storeBatch([item("custom", { i }, NOW + i)]);
        }

        await start();
        const events = (await (await fetch(`${base}/api/events?limit=100000`)).json()) as { events: unknown[] };
        const series = (await (await fetch(`${base}/api/timeseries?from=${NOW - 7 * 86_400_000}&to=${NOW}&bucketMs=1000`)).json()) as { points: unknown[] };
        const summary = (await (await fetch(`${base}/api/summary?windowMs=999999999999`)).json()) as { to: number; from: number };

        expect(events.events).toHaveLength(500);
        expect(series.points.length).toBeLessThanOrEqual(601);
        expect(summary.to - summary.from).toBe(86_400_000);
    });

    it("streams new events to a connected tab, starting from now", async () => {
        writer.storeBatch([item("custom", { n: 1 }, NOW)]);
        await start();

        const received = readStream(`${base}/api/stream`, (events) => events.some((e) => e.event === "events"));
        await new Promise((resolve) => setTimeout(resolve, 150));
        writer.storeBatch([item("custom", { n: 2 }, NOW + 1)]);
        const { events, headers } = await received;

        expect(headers.get("content-type")).toBe("text/event-stream");
        expect(events[0]).toMatchObject({ event: "hello", data: { lastSeq: 1 } });
        const batch = events.find((e) => e.event === "events")!.data as Array<{ seq: number; payload: { n: number } }>;
        expect(batch.map((e) => e.payload.n)).toEqual([2]);
    });

    it("replays what a reconnecting tab missed, once", async () => {
        for (let n = 1; n <= 3; n++) {
            writer.storeBatch([item("custom", { n }, NOW + n)]);
        }

        await start();
        const { events } = await readStream(`${base}/api/stream?afterSeq=1`, (all) => all.some((e) => e.event === "events"));

        const replay = events.find((e) => e.event === "events")!.data as Array<{ seq: number }>;
        expect(replay.map((e) => e.seq)).toEqual([2, 3]);
    });

    it("serves the built dashboard and falls back to it for unknown paths", async () => {
        const root = path.join(temp.dir, "dist");
        fs.mkdirSync(root);
        fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>dash</title>");
        await start(root);

        const index = await fetch(`${base}/`);
        const nested = await fetch(`${base}/somewhere/else`);

        expect(await index.text()).toContain("<title>dash</title>");
        expect(await nested.text()).toContain("<title>dash</title>");
        expect((await fetch(`${base}/api/health`)).status).toBe(200);
    });

    it("still serves the API when there is no built dashboard", async () => {
        await start(path.join(temp.dir, "missing"));

        expect((await fetch(`${base}/api/health`)).status).toBe(200);
        expect((await fetch(`${base}/`)).status).toBe(404);
    });

    it("stops promptly even with a stream still open", async () => {
        await start();
        const controller = new AbortController();
        await fetch(`${base}/api/stream`, { signal: controller.signal });
        const began = Date.now();

        await server.stop();
        controller.abort();

        expect(Date.now() - began).toBeLessThan(2500);
    });
});
