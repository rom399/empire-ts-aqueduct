import { describe, expect, it } from "vitest";
import { QueueClient } from "../../../src/client/QueueClient";
import { QueueClientError } from "../../../src/client/QueueClientError";
import { deliveredItem, FakeBroker, jsonResponse, takeAnswer } from "../../fixtures/broker/FakeBroker";

function makeClient(broker: FakeBroker, overrides: { url?: string; queue?: string } = {}): QueueClient {
    return new QueueClient({
        url: overrides.url ?? "http://broker:7002",
        queue: overrides.queue ?? "telemetry",
        token: "secret",
        fetch: broker.fetch as typeof fetch,
    });
}

describe("QueueClient", () => {
    describe("take", () => {
        it("posts to the queue's take route with the bearer token and the request", async () => {
            const broker = new FakeBroker().willTake(takeAnswer("b_1", [deliveredItem(1)]));

            await makeClient(broker).take(20, { waitMs: 5000 });

            expect(broker.requests[0]).toMatchObject({
                action: "take",
                url: "http://broker:7002/v1/queues/telemetry/take",
                headers: { "Authorization": "Bearer secret", "Content-Type": "application/json" },
                body: { maxItems: 20, waitMs: 5000 },
            });
        });

        it("sends a wait of 0 when none is given", async () => {
            const broker = new FakeBroker().willTake(takeAnswer("b_1", []));

            await makeClient(broker).take(5);

            expect(broker.requests[0].body).toEqual({ maxItems: 5, waitMs: 0 });
        });

        it("ignores trailing slashes on the URL and encodes the queue name", async () => {
            const broker = new FakeBroker().willTake(takeAnswer("b_1", []));

            await makeClient(broker, { url: "http://broker:7002//", queue: "a b" }).take(1);

            expect(broker.requests[0].url).toBe("http://broker:7002/v1/queues/a%20b/take");
        });

        it("returns the batch id and items", async () => {
            const broker = new FakeBroker().willTake(takeAnswer("b_9", [deliveredItem(1), deliveredItem(2)]));

            const result = await makeClient(broker).take(10);

            expect(result.batchId).toBe("b_9");
            expect(result.count).toBe(2);
            expect(result.items.map((item) => item.sequence)).toEqual([1, 2]);
        });

        it("reports no batch id for an empty answer", async () => {
            const broker = new FakeBroker().willTake(jsonResponse({ batchId: null, count: 0, drained: true, items: [] }));

            expect(await makeClient(broker).take(10)).toEqual({ batchId: null, count: 0, drained: true, items: [] });
        });

        it("throws a QueueClientError with the status when the broker refuses", async () => {
            const broker = new FakeBroker().willTake(jsonResponse({ error: "Unauthorized" }, 401));

            const failure = await makeClient(broker).take(1).catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(QueueClientError);
            expect(failure).toMatchObject({ status: 401, retryable: false });
            expect((failure as Error).message).toContain("Unauthorized");
        });

        it("treats a 5xx and 429 as worth retrying", async () => {
            for (const status of [500, 503, 429]) {
                const broker = new FakeBroker().willTake(jsonResponse({ error: "x" }, status));

                expect(await makeClient(broker).take(1).catch((error: unknown) => error)).toMatchObject({ retryable: true });
            }
        });

        it("throws a retryable QueueClientError when the broker cannot be reached", async () => {
            const failing = new QueueClient({
                url: "http://broker", queue: "q", token: "t",
                fetch: (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch,
            });

            const failure = await failing.take(1).catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(QueueClientError);
            expect(failure).toMatchObject({ status: undefined, retryable: true });
        });

        it("throws when the answer is not understood", async () => {
            const broker = new FakeBroker().willTake(jsonResponse({ hello: "world" }));

            await expect(makeClient(broker).take(1)).rejects.toThrow(QueueClientError);
        });

        it("lets an abort through as an AbortError, not a broker failure", async () => {
            const broker = new FakeBroker();
            const controller = new AbortController();
            const taking = makeClient(broker).take(1, { waitMs: 5000, signal: controller.signal });

            controller.abort();

            await expect(taking).rejects.toMatchObject({ name: "AbortError" });
        });
    });

    describe("acknowledge", () => {
        it("posts the batch id and returns true when the broker accepts it", async () => {
            const broker = new FakeBroker();

            expect(await makeClient(broker).acknowledge("b_1")).toBe(true);
            expect(broker.requests[0]).toMatchObject({
                action: "ack",
                url: "http://broker:7002/v1/queues/telemetry/ack",
                body: { batchId: "b_1" },
            });
        });

        it("returns false when the broker no longer knows the batch", async () => {
            const broker = new FakeBroker();

            broker.ack = () => jsonResponse({ error: "Unknown batch" }, 404);

            expect(await makeClient(broker).acknowledge("b_1")).toBe(false);
        });

        it("throws for any other failure, because the outcome is unknown", async () => {
            const broker = new FakeBroker();

            broker.ack = () => jsonResponse({ error: "boom" }, 500);

            await expect(makeClient(broker).acknowledge("b_1")).rejects.toMatchObject({ status: 500 });
        });
    });
});
