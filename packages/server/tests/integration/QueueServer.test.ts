import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QueueConsumer } from "empire-ts-aqueduct-client";
import { QueueServer } from "../../src/QueueServer";
import { call, item } from "../fixtures/http/call";
import { getFreePort } from "../fixtures/ports/getFreePort";
import { ADMIN_TOKEN, PUBLISH_TOKEN, PULL_TOKEN, startBroker, testQueue } from "../fixtures/broker/startBroker";

const folders: string[] = [];

afterEach(() => {
    for (const folder of folders.splice(0)) {
        fs.rmSync(folder, { recursive: true, force: true });
    }
});

function tempFolder(): string {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "empire-queue-server-test-"));

    folders.push(folder);

    return folder;
}

async function waitFor(condition: () => boolean, timeoutMs: number = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error("Timed out waiting for a condition.");
        }

        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

describe("QueueServer", () => {
    describe("health", () => {
        it("answers up on both ports without a token and says nothing else", async () => {
            const { publishUrl, pullUrl } = await startBroker();

            for (const url of [publishUrl, pullUrl]) {
                const result = await call(url, "/health");

                expect(result.status).toBe(200);
                expect(result.body).toEqual({ status: "up" });
            }
        });
    });

    describe("publishing", () => {
        it("accepts one item and replies with its id and sequence", async () => {
            const { publishUrl } = await startBroker();

            const result = await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: item(1) });

            expect(result.status).toBe(201);
            expect(result.body).toMatchObject({ sequence: 1 });
            expect(typeof result.body.itemId).toBe("string");
        });

        it("accepts a batch and reports each item, not all-or-nothing", async () => {
            const { publishUrl } = await startBroker();

            const result = await call(publishUrl, "/v1/queues/telemetry/items", {
                method: "POST", token: PUBLISH_TOKEN, body: [item(1), { bad: true }, item(3)],
            });

            expect(result.status).toBe(200);
            expect(result.body).toMatchObject({ acceptedCount: 2, rejectedCount: 1 });
            expect(result.body.results.map((r: { accepted: boolean }) => r.accepted)).toEqual([true, false, true]);
            expect(result.body.results[2].sequence).toBe(2);
        });

        it("refuses a single invalid item with 400 and the reason", async () => {
            const { publishUrl } = await startBroker();

            const result = await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: { type: "x" } });

            expect(result.status).toBe(400);
            expect(result.body.reason).toBe("invalid-item");
        });

        it("refuses a body that is not JSON, and an empty batch", async () => {
            const { publishUrl } = await startBroker();

            expect((await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, rawBody: "{nope" })).status).toBe(400);
            expect((await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: [] })).status).toBe(400);
        });

        it("refuses a batch with too many items as a whole, with 413", async () => {
            const { publishUrl, server } = await startBroker({ queues: { telemetry: testQueue({ maxPublishBatch: 2 }) } });

            const result = await call(publishUrl, "/v1/queues/telemetry/items", {
                method: "POST", token: PUBLISH_TOKEN, body: [item(1), item(2), item(3)],
            });

            expect(result.status).toBe(413);
            expect(server.registry.get("telemetry").stats().totalWaiting).toBe(0);
        });

        it("refuses a request body far over the limit with 413 before reading it all", async () => {
            const { publishUrl } = await startBroker({ queues: { telemetry: testQueue({ maxPublishBytes: 1000, maxPublishBatch: 1 }) } });

            const huge = { ...item(1), payload: "x".repeat(200_000) };
            const result = await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: huge });

            expect(result.status).toBe(413);
        });

        it("replies 503 with Retry-After when a rejecting queue is full", async () => {
            const { publishUrl } = await startBroker({ queues: { telemetry: testQueue({ maxSize: 1, overflow: "reject" }) } });
            const publish = () => call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: item(1) });

            await publish();
            const full = await publish();

            expect(full.status).toBe(503);
            expect(full.headers.get("retry-after")).toBe("1");
            expect(full.body.reason).toBe("queue-full");
        });

        it("replies 404 for a queue that was not declared", async () => {
            const { publishUrl } = await startBroker();

            const result = await call(publishUrl, "/v1/queues/nope/items", { method: "POST", token: PUBLISH_TOKEN, body: item(1) });

            expect(result.status).toBe(404);
        });
    });

    describe("tokens", () => {
        it("refuses a missing or wrong token on both ports with 401 and a Bearer challenge", async () => {
            const { publishUrl, pullUrl } = await startBroker();

            const attempts = [
                call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", body: item(1) }),
                call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: "wrong", body: item(1) }),
                call(pullUrl, "/v1/queues/telemetry/take", { method: "POST", body: {} }),
                call(pullUrl, "/v1/queues/telemetry/ack", { method: "POST", token: "wrong", body: { batchId: "x" } }),
            ];

            for (const result of await Promise.all(attempts)) {
                expect(result.status).toBe(401);
                expect(result.headers.get("www-authenticate")).toBe("Bearer");
            }
        });

        it("lets the pull token take but not publish, and the publish token publish but not take", async () => {
            const { publishUrl, pullUrl } = await startBroker();

            expect((await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PULL_TOKEN, body: item(1) })).status).toBe(401);
            expect((await call(pullUrl, "/v1/queues/telemetry/take", { method: "POST", token: PUBLISH_TOKEN, body: {} })).status).toBe(401);
            expect((await call(pullUrl, "/v1/queues/telemetry/take", { method: "POST", token: PULL_TOKEN, body: {} })).status).toBe(200);
        });

        it("keeps each queue's tokens to that queue", async () => {
            const { publishUrl } = await startBroker({
                queues: {
                    alpha: testQueue(),
                    beta: { publishToken: "beta-publish", pullToken: "beta-pull" },
                },
            });

            expect((await call(publishUrl, "/v1/queues/beta/items", { method: "POST", token: PUBLISH_TOKEN, body: item(1) })).status).toBe(401);
            expect((await call(publishUrl, "/v1/queues/beta/items", { method: "POST", token: "beta-publish", body: item(1) })).status).toBe(201);
        });

        it("refuses to be built with a missing token", () => {
            expect(() => new QueueServer({
                publishPort: 1, pullPort: 2, queues: { a: { publishToken: "", pullToken: "x" } },
            })).toThrow(/publish.*token is missing/);
        });

        it("refuses to be built when two tokens are the same", () => {
            expect(() => new QueueServer({
                publishPort: 1, pullPort: 2, queues: { a: { publishToken: "same", pullToken: "same" } },
            })).toThrow(/are the same/);

            expect(() => new QueueServer({
                publishPort: 1, pullPort: 2, adminToken: "same", queues: { a: { publishToken: "same", pullToken: "x" } },
            })).toThrow(/are the same/);
        });

        it("refuses to be built with the same port twice or no queues", () => {
            expect(() => new QueueServer({ publishPort: 5, pullPort: 5, queues: { a: testQueue() } })).toThrow(/different ports/);
            expect(() => new QueueServer({ publishPort: 1, pullPort: 2, queues: {} })).toThrow(/At least one queue/);
        });

        it("refuses to be built with a queue setting that cannot work, naming the queue", () => {
            expect(() => new QueueServer({
                publishPort: 1, pullPort: 2, queues: { jobs: testQueue({ maxSize: 0 }) },
            })).toThrow(/Queue "jobs"/);
        });
    });

    describe("taking", () => {
        it("returns what was published, first in first out", async () => {
            const { publishUrl, pullUrl } = await startBroker();

            await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: [item(1), item(2), item(3)] });

            const result = await call(pullUrl, "/v1/queues/telemetry/take", { method: "POST", token: PULL_TOKEN, body: { maxItems: 2 } });

            expect(result.status).toBe(200);
            expect(result.body.count).toBe(2);
            expect(result.body.drained).toBe(false);
            expect(result.body.items.map((i: { payload: { n: number } }) => i.payload.n)).toEqual([1, 2]);
            expect(result.body.items[0]).toMatchObject({ deliveryCount: 1, sequence: 1 });
            expect(result.body.batchId).toMatch(/^b_/);
        });

        it("returns fewer than asked, at once, when fewer are waiting", async () => {
            const { publishUrl, pullUrl } = await startBroker();

            await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: item(1) });

            const result = await call(pullUrl, "/v1/queues/telemetry/take", { method: "POST", token: PULL_TOKEN, body: { maxItems: 20 } });

            expect(result.body).toMatchObject({ count: 1, drained: true });
        });

        it("returns nothing at once from an empty queue, and treats an empty body as the defaults", async () => {
            const { pullUrl } = await startBroker();

            const result = await call(pullUrl, "/v1/queues/telemetry/take", { method: "POST", token: PULL_TOKEN });

            expect(result.body).toEqual({ batchId: null, count: 0, drained: true, items: [] });
        });

        it("is a POST: a GET is not a way to take", async () => {
            const { pullUrl } = await startBroker();

            const result = await call(pullUrl, "/v1/queues/telemetry/take", { token: PULL_TOKEN });

            expect(result.status).not.toBe(200);
        });

        it("refuses maxItems or waitMs that are not whole numbers in range", async () => {
            const { pullUrl } = await startBroker();
            const take = (body: unknown) => call(pullUrl, "/v1/queues/telemetry/take", { method: "POST", token: PULL_TOKEN, body });

            expect((await take({ maxItems: 0 })).status).toBe(400);
            expect((await take({ maxItems: "5" })).status).toBe(400);
            expect((await take({ waitMs: -1 })).status).toBe(400);
            expect((await take([1])).status).toBe(400);
        });

        it("replies 404 for a queue that was not declared", async () => {
            const { pullUrl } = await startBroker();

            expect((await call(pullUrl, "/v1/queues/nope/take", { method: "POST", token: PULL_TOKEN, body: {} })).status).toBe(404);
        });
    });

    describe("long-polling", () => {
        it("holds the request until an item is published and then returns it", async () => {
            const { publishUrl, pullUrl } = await startBroker();
            const waiting = call(pullUrl, "/v1/queues/telemetry/take", { method: "POST", token: PULL_TOKEN, body: { maxItems: 5, waitMs: 5000 } });

            await new Promise((resolve) => setTimeout(resolve, 50));
            await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: item(7) });

            const result = await waiting;

            expect(result.body.count).toBe(1);
            expect(result.body.items[0].payload).toEqual({ n: 7 });
        });

        it("returns an empty answer when the wait runs out", async () => {
            const { pullUrl } = await startBroker();

            const result = await call(pullUrl, "/v1/queues/telemetry/take", { method: "POST", token: PULL_TOKEN, body: { waitMs: 100 } });

            expect(result.body.count).toBe(0);
        });

        it("caps the wait at the queue's maxWaitMs", async () => {
            const { pullUrl } = await startBroker({ queues: { telemetry: testQueue({ maxWaitMs: 100 }) } });
            const startedAt = Date.now();

            await call(pullUrl, "/v1/queues/telemetry/take", { method: "POST", token: PULL_TOKEN, body: { waitMs: 60_000 } });

            expect(Date.now() - startedAt).toBeLessThan(2000);
        });

        it("drops a consumer from the waiting line when it disconnects", async () => {
            const { pullUrl, publishUrl, server } = await startBroker();
            const controller = new AbortController();
            const hungUp = fetch(`${pullUrl}/v1/queues/telemetry/take`, {
                method: "POST",
                headers: { Authorization: `Bearer ${PULL_TOKEN}`, "Content-Type": "application/json" },
                body: JSON.stringify({ waitMs: 20_000 }),
                signal: controller.signal,
            }).catch(() => undefined);

            await waitFor(() => server.registry.get("telemetry").stats().waitingConsumers === 1);
            controller.abort();
            await hungUp;
            await waitFor(() => server.registry.get("telemetry").stats().waitingConsumers === 0);

            // An item published now must stay in the queue, not go to the consumer who left.
            await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: item(1) });

            expect(server.registry.get("telemetry").stats()).toMatchObject({ depth: 1, inFlight: 0 });
        });
    });

    describe("acknowledging", () => {
        it("forgets the batch once it is acknowledged", async () => {
            const { publishUrl, pullUrl, server } = await startBroker();

            await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: [item(1), item(2)] });

            const taken = await call(pullUrl, "/v1/queues/telemetry/take", { method: "POST", token: PULL_TOKEN, body: { maxItems: 5 } });
            const ack = await call(pullUrl, "/v1/queues/telemetry/ack", { method: "POST", token: PULL_TOKEN, body: { batchId: taken.body.batchId } });

            expect(ack).toMatchObject({ status: 200, body: { acknowledged: true } });
            expect(server.registry.get("telemetry").stats()).toMatchObject({ inFlight: 0, acknowledged: 2 });
        });

        it("replies 404 for a batch it does not know, and 400 for a missing batchId", async () => {
            const { pullUrl } = await startBroker();

            expect((await call(pullUrl, "/v1/queues/telemetry/ack", { method: "POST", token: PULL_TOKEN, body: { batchId: "b_nope" } })).status).toBe(404);
            expect((await call(pullUrl, "/v1/queues/telemetry/ack", { method: "POST", token: PULL_TOKEN, body: {} })).status).toBe(400);
        });

        it("redelivers a batch that was not acknowledged in time, with a higher deliveryCount, and refuses the late ack", async () => {
            const { publishUrl, pullUrl } = await startBroker({ queues: { telemetry: testQueue({ receiptTimeoutMs: 60 }) } });

            await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: item(1) });

            const first = await call(pullUrl, "/v1/queues/telemetry/take", { method: "POST", token: PULL_TOKEN, body: {} });

            await new Promise((resolve) => setTimeout(resolve, 150));

            const second = await call(pullUrl, "/v1/queues/telemetry/take", { method: "POST", token: PULL_TOKEN, body: {} });
            const late = await call(pullUrl, "/v1/queues/telemetry/ack", { method: "POST", token: PULL_TOKEN, body: { batchId: first.body.batchId } });

            expect(second.body.items[0]).toMatchObject({ itemId: first.body.items[0].itemId, deliveryCount: 2 });
            expect(late.status).toBe(404);
        });
    });

    describe("admin operations", () => {
        it("lists queues and shows stats with the admin token", async () => {
            const { pullUrl, publishUrl } = await startBroker({ queues: { telemetry: testQueue(), jobs: { publishToken: "jp", pullToken: "jq" } } });

            await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: item(1) });

            const list = await call(pullUrl, "/v1/queues", { token: ADMIN_TOKEN });
            const stats = await call(pullUrl, "/v1/queues/telemetry/stats", { token: ADMIN_TOKEN });

            expect(list.body).toEqual({ queues: ["telemetry", "jobs"] });
            expect(stats.body).toMatchObject({ name: "telemetry", depth: 1, published: 1 });
        });

        it("peeks without taking", async () => {
            const { pullUrl, publishUrl, server } = await startBroker();

            await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: [item(1), item(2), item(3)] });

            const peek = await call(pullUrl, "/v1/queues/telemetry/peek?max=2", { token: ADMIN_TOKEN });

            expect(peek.body.items.map((i: { payload: { n: number } }) => i.payload.n)).toEqual([1, 2]);
            expect(server.registry.get("telemetry").stats()).toMatchObject({ depth: 3, inFlight: 0 });
        });

        it("purges and says how many it removed", async () => {
            const { pullUrl, publishUrl, server } = await startBroker();

            await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: [item(1), item(2)] });

            const purge = await call(pullUrl, "/v1/queues/telemetry/purge", { method: "POST", token: ADMIN_TOKEN });

            expect(purge.body).toEqual({ purged: 2 });
            expect(server.registry.get("telemetry").stats().totalWaiting).toBe(0);
        });

        it("refuses the queue tokens and no token on every admin route", async () => {
            const { pullUrl } = await startBroker();
            const routes: Array<[string, string]> = [
                ["GET", "/v1/queues"],
                ["GET", "/v1/queues/telemetry/stats"],
                ["GET", "/v1/queues/telemetry/peek"],
                ["POST", "/v1/queues/telemetry/purge"],
            ];

            for (const [method, route] of routes) {
                for (const token of [undefined, PULL_TOKEN, PUBLISH_TOKEN]) {
                    expect((await call(pullUrl, route, { method, token })).status).toBe(401);
                }
            }
        });

        it("has no admin routes at all when no admin token is configured", async () => {
            const { pullUrl } = await startBroker({ adminToken: undefined });

            expect((await call(pullUrl, "/v1/queues/telemetry/stats", { token: ADMIN_TOKEN })).status).toBe(404);
            expect((await call(pullUrl, "/v1/queues/telemetry/purge", { method: "POST", token: ADMIN_TOKEN })).status).toBe(404);
        });

        it("replies 404 for an unknown queue only once the admin token checks out", async () => {
            const { pullUrl } = await startBroker();

            expect((await call(pullUrl, "/v1/queues/nope/stats", { token: ADMIN_TOKEN })).status).toBe(404);
            expect((await call(pullUrl, "/v1/queues/nope/stats")).status).toBe(401);
        });

        it("does not let admin operations be done from the publish port", async () => {
            const { publishUrl } = await startBroker();

            expect((await call(publishUrl, "/v1/queues/telemetry/stats", { token: ADMIN_TOKEN })).status).toBe(404);
        });
    });

    describe("with the consumer client", () => {
        it("delivers everything published to a consumer, acknowledging each batch once", async () => {
            const { publishUrl, pullUrl, server } = await startBroker();
            const received: number[] = [];

            const consumer = new QueueConsumer({
                url: pullUrl, queue: "telemetry", token: PULL_TOKEN, batchSize: 4, waitMs: 2000,
                handler: (consumed) => { received.push((consumed.payload as { n: number }).n); },
            });

            consumer.start();

            const batch = Array.from({ length: 10 }, (_, index) => item(index + 1));

            await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: batch });
            await waitFor(() => received.length === 10);
            await consumer.stop();

            expect(received).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
            expect(server.registry.get("telemetry").stats()).toMatchObject({ acknowledged: 10, inFlight: 0, depth: 0 });
        });

        it("shares a queue between competing consumers without giving anyone the same item twice", async () => {
            const { publishUrl, pullUrl } = await startBroker();
            const seen: string[] = [];

            const consumers = [1, 2, 3].map(() => new QueueConsumer({
                url: pullUrl, queue: "telemetry", token: PULL_TOKEN, batchSize: 3, waitMs: 2000,
                handler: (consumed) => { seen.push(consumed.itemId); },
            }));

            consumers.forEach((consumer) => consumer.start());

            const batch = Array.from({ length: 30 }, (_, index) => item(index));

            await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: batch });
            await waitFor(() => seen.length >= 30);
            await Promise.all(consumers.map((consumer) => consumer.stop()));

            expect(seen.length).toBe(30);
            expect(new Set(seen).size).toBe(30);
        });

        it("keeps working across a producer that publishes while the consumer is waiting", async () => {
            const { publishUrl, pullUrl } = await startBroker();
            const received: number[] = [];

            const consumer = new QueueConsumer({
                url: pullUrl, queue: "telemetry", token: PULL_TOKEN, waitMs: 2000,
                handler: (consumed) => { received.push((consumed.payload as { n: number }).n); },
            });

            consumer.start();
            await new Promise((resolve) => setTimeout(resolve, 50));

            for (let n = 1; n <= 3; n++) {
                await call(publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: item(n) });
            }

            await waitFor(() => received.length === 3);
            await consumer.stop();

            expect(received).toEqual([1, 2, 3]);
        });
    });

    describe("starting and stopping", () => {
        it("releases a waiting long-poll at once on stop instead of holding the port for the shutdown timeout", async () => {
            const { server, pullUrl } = await startBroker();
            const waiting = call(pullUrl, "/v1/queues/telemetry/take", { method: "POST", token: PULL_TOKEN, body: { waitMs: 20_000 } });

            await waitFor(() => server.registry.get("telemetry").stats().waitingConsumers === 1);

            const startedAt = Date.now();

            await server.stop();

            expect((await waiting).body.count).toBe(0);
            expect(Date.now() - startedAt).toBeLessThan(1500);
        });

        it("saves persisting queues on stop and restores them when a new broker starts", async () => {
            const spillRoot = tempFolder();
            const queues = { telemetry: testQueue({ persist: true }) };
            const first = await startBroker({ queues, spillRoot });

            await call(first.publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: [item(1), item(2), item(3)] });
            await first.server.stop();

            const second = await startBroker({ queues, spillRoot });
            const result = await call(second.pullUrl, "/v1/queues/telemetry/take", { method: "POST", token: PULL_TOKEN, body: { maxItems: 10 } });

            expect(result.body.items.map((i: { payload: { n: number } }) => i.payload.n)).toEqual([1, 2, 3]);
        });

        it("opens neither port before saved queues are restored", async () => {
            const spillRoot = tempFolder();
            const queues = { telemetry: testQueue({ persist: true }) };
            const first = await startBroker({ queues, spillRoot });

            await call(first.publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: item(1) });
            await first.server.stop();

            const second = await startBroker({ queues, spillRoot });

            // The first thing a producer publishes after a restart continues the old numbering.
            const result = await call(second.publishUrl, "/v1/queues/telemetry/items", { method: "POST", token: PUBLISH_TOKEN, body: item(2) });

            expect(result.body.sequence).toBe(2);
        });

        it("closes everything and throws if a port is already taken", async () => {
            const { options } = await startBroker();
            const clash = new QueueServer({ ...options, publishPort: await getFreePort(), pullPort: options.pullPort });

            await expect(clash.start()).rejects.toThrow(/EADDRINUSE/);
            expect(clash.registry.get("telemetry").isClosed).toBe(true);
        });

        it("refuses to start twice and can be stopped twice", async () => {
            const { server } = await startBroker();

            await expect(server.start()).rejects.toThrow(/already running/);
            await server.stop();
            await server.stop();
        });

        it("warns when listening beyond the loopback address", async () => {
            const { logger } = await startBroker({ host: "0.0.0.0" });

            expect(logger.warnings.some((message) => message.includes("put TLS in front"))).toBe(true);
        });

        it("does not warn on the loopback address", async () => {
            const { logger } = await startBroker();

            expect(logger.warnings.filter((message) => message.includes("TLS"))).toEqual([]);
        });
    });
});
