import { describe, expect, it } from "vitest";
import { PublishRejectionReason } from "../../../src/publishing/PublishRejectionReason";
import { createTestQueue } from "../../fixtures/queue/createTestQueue";
import { newItem, payloadNumbers } from "../../fixtures/items/newItem";

const RECEIPT_TIMEOUT_MS = 10_000;

function publishAll(queue: ReturnType<typeof createTestQueue>["queue"], count: number): void {
    for (let n = 1; n <= count; n++) {
        queue.publish(newItem(n));
    }
}

describe("Queue", () => {
    describe("publishing", () => {
        it("assigns an itemId and consecutive sequence numbers", () => {
            const { queue } = createTestQueue();

            const first = queue.publish(newItem(1));
            const second = queue.publish(newItem(2));

            expect(first).toMatchObject({ accepted: true, sequence: 1 });
            expect(second).toMatchObject({ accepted: true, sequence: 2 });
            expect(first.accepted && second.accepted && first.itemId !== second.itemId).toBe(true);
        });

        it("stamps enqueuedAt from the broker's clock, not the producer's createdAt", async () => {
            const { queue, clock } = createTestQueue();

            queue.publish(newItem(1, { createdAt: 5 }));

            const taken = await queue.take(1);

            expect(taken.items[0]).toMatchObject({ createdAt: 5, enqueuedAt: clock.now() });
        });

        it("ignores an itemId, sequence, enqueuedAt or expiresAt a producer supplies", async () => {
            const { queue, clock } = createTestQueue();

            queue.publish({ ...newItem(1), itemId: "forged", sequence: 999, enqueuedAt: 1, expiresAt: 2 });

            const { items } = await queue.take(1);

            expect(items[0].itemId).not.toBe("forged");
            expect(items[0].sequence).toBe(1);
            expect(items[0].enqueuedAt).toBe(clock.now());
            expect(items[0].expiresAt).toBeUndefined();
        });

        it("rejects an invalid item with a reason and counts it", () => {
            const { queue } = createTestQueue();

            const result = queue.publish({ type: "t" });

            expect(result).toMatchObject({ accepted: false, reason: PublishRejectionReason.InvalidItem });
            expect(queue.stats().rejected).toBe(1);
        });

        it("rejects a payload over maxPayloadBytes", () => {
            const { queue } = createTestQueue({ maxPayloadBytes: 50 });

            expect(queue.publish(newItem(0, { payload: "x".repeat(60) })).accepted).toBe(false);
        });

        it("does not use up a sequence number on a rejected item", () => {
            const { queue } = createTestQueue();

            queue.publish({ nonsense: true });

            expect(queue.publish(newItem(1))).toMatchObject({ accepted: true, sequence: 1 });
        });
    });

    describe("batch publishing", () => {
        it("gives every item its own result and consecutive sequence numbers in request order", () => {
            const { queue } = createTestQueue();

            const results = queue.publishBatch([newItem(1), newItem(2), newItem(3)]);

            expect(results.map((result) => result.accepted && result.sequence)).toEqual([1, 2, 3]);
        });

        it("is not all-or-nothing: an invalid item fails alone", () => {
            const { queue } = createTestQueue();

            const results = queue.publishBatch([newItem(1), { bad: true }, newItem(3)]);

            expect(results.map((result) => result.accepted)).toEqual([true, false, true]);
            expect(results[2]).toMatchObject({ sequence: 2 });
        });

        it("refuses a batch with more than maxPublishBatch items, whole", () => {
            const { queue } = createTestQueue({ maxPublishBatch: 2 });

            const results = queue.publishBatch([newItem(1), newItem(2), newItem(3)]);

            expect(results.every((result) => !result.accepted && result.reason === PublishRejectionReason.BatchTooLarge)).toBe(true);
            expect(queue.stats().totalWaiting).toBe(0);
        });

        it("refuses a batch with more payload bytes than maxPublishBytes, whole", () => {
            const { queue } = createTestQueue({ maxPublishBytes: 20 });

            const results = queue.publishBatch([newItem(1, { payload: "x".repeat(15) }), newItem(2, { payload: "y".repeat(15) })]);

            expect(results.every((result) => !result.accepted)).toBe(true);
            expect(queue.stats().totalWaiting).toBe(0);
        });

        it("applies the overflow policy item by item", () => {
            const { queue } = createTestQueue({ maxSize: 2, overflow: "reject" });

            const results = queue.publishBatch([newItem(1), newItem(2), newItem(3)]);

            expect(results.map((result) => result.accepted)).toEqual([true, true, false]);
            expect(results[2]).toMatchObject({ reason: PublishRejectionReason.QueueFull });
        });
    });

    describe("taking", () => {
        it("returns items in first-in first-out order", async () => {
            const { queue } = createTestQueue();

            publishAll(queue, 5);

            const first = await queue.take(3);
            const second = await queue.take(3);

            expect(payloadNumbers(first.items)).toEqual([1, 2, 3]);
            expect(payloadNumbers(second.items)).toEqual([4, 5]);
        });

        it("returns what is there at once when fewer than requested are available", async () => {
            const { queue } = createTestQueue();

            publishAll(queue, 3);

            const result = await queue.take(20);

            expect(result.count).toBe(3);
            expect(result.drained).toBe(true);
        });

        it("says the queue is not drained when items remain", async () => {
            const { queue } = createTestQueue();

            publishAll(queue, 3);

            expect((await queue.take(2)).drained).toBe(false);
        });

        it("returns nothing at once from an empty queue when not waiting", async () => {
            const { queue } = createTestQueue();

            expect(await queue.take(5)).toEqual({ batchId: null, count: 0, drained: true, items: [] });
        });

        it("never gives the same item to two consumers", async () => {
            const { queue } = createTestQueue();

            publishAll(queue, 10);

            const [a, b] = await Promise.all([queue.take(6), queue.take(6)]);
            const ids = [...a.items, ...b.items].map((item) => item.itemId);

            expect(ids.length).toBe(10);
            expect(new Set(ids).size).toBe(10);
        });

        it("caps one take at maxTakeSize", async () => {
            const { queue } = createTestQueue({ maxTakeSize: 4 });

            publishAll(queue, 10);

            expect((await queue.take(50)).count).toBe(4);
        });

        it("refuses a request for zero or a fractional number of items", async () => {
            const { queue } = createTestQueue();

            await expect(queue.take(0)).rejects.toThrow(RangeError);
            await expect(queue.take(1.5)).rejects.toThrow(RangeError);
        });

        it("starts the delivery count at 1", async () => {
            const { queue } = createTestQueue();

            publishAll(queue, 2);

            expect((await queue.take(2)).items.map((item) => item.deliveryCount)).toEqual([1, 1]);
        });
    });

    describe("receipt acknowledgement", () => {
        it("forgets the items for good once acknowledged", async () => {
            const { queue, clock } = createTestQueue();

            publishAll(queue, 2);

            const { batchId } = await queue.take(2);

            expect(queue.acknowledge(batchId!)).toBe(true);

            clock.advance(RECEIPT_TIMEOUT_MS * 2);

            expect(queue.stats()).toMatchObject({ depth: 0, inFlight: 0, acknowledged: 2 });
        });

        it("reports an unknown batch as not acknowledged", () => {
            const { queue } = createTestQueue();

            expect(queue.acknowledge("b_nope")).toBe(false);
        });

        it("reports a second acknowledgement of the same batch as not acknowledged", async () => {
            const { queue } = createTestQueue();

            publishAll(queue, 1);

            const { batchId } = await queue.take(1);

            queue.acknowledge(batchId!);

            expect(queue.acknowledge(batchId!)).toBe(false);
        });

        it("returns the items to the front of the queue when no ack arrives in time", async () => {
            const { queue, clock } = createTestQueue();

            publishAll(queue, 4);
            await queue.take(2);

            clock.advance(RECEIPT_TIMEOUT_MS);

            const next = await queue.take(4);

            expect(payloadNumbers(next.items)).toEqual([1, 2, 3, 4]);
        });

        it("raises the delivery count each time a batch returns", async () => {
            const { queue, clock } = createTestQueue();

            publishAll(queue, 1);
            await queue.take(1);
            clock.advance(RECEIPT_TIMEOUT_MS);
            const second = await queue.take(1);
            clock.advance(RECEIPT_TIMEOUT_MS);
            const third = await queue.take(1);

            expect([second.items[0].deliveryCount, third.items[0].deliveryCount]).toEqual([2, 3]);
        });

        it("redelivers the same itemId and sequence", async () => {
            const { queue, clock } = createTestQueue();

            publishAll(queue, 1);

            const first = await queue.take(1);

            clock.advance(RECEIPT_TIMEOUT_MS);

            const second = await queue.take(1);

            expect(second.items[0].itemId).toBe(first.items[0].itemId);
            expect(second.items[0].sequence).toBe(first.items[0].sequence);
            expect(queue.stats().redelivered).toBe(1);
        });

        it("does not store the delivery count on the item", async () => {
            const { queue, clock } = createTestQueue();

            publishAll(queue, 1);
            await queue.take(1);
            clock.advance(RECEIPT_TIMEOUT_MS);

            expect(queue.peek(1)[0]).not.toHaveProperty("deliveryCount");
        });

        it("stops the receipt timer once acknowledged", async () => {
            const { queue, clock } = createTestQueue();

            publishAll(queue, 1);

            const { batchId } = await queue.take(1);

            queue.acknowledge(batchId!);

            expect(clock.pendingTimers).toBe(0);
        });
    });

    describe("long-polling", () => {
        it("returns at once when items exist, without waiting", async () => {
            const { queue, clock } = createTestQueue();

            publishAll(queue, 1);

            expect((await queue.take(5, { waitMs: 5000 })).count).toBe(1);
            expect(clock.pendingTimers).toBe(1); // only the receipt timer
        });

        it("waits on an empty queue and returns as soon as an item arrives", async () => {
            const { queue } = createTestQueue();
            const waiting = queue.take(5, { waitMs: 5000 });

            queue.publish(newItem(1));

            const result = await waiting;

            expect(payloadNumbers(result.items)).toEqual([1]);
        });

        it("does not wait to fill the batch", async () => {
            const { queue } = createTestQueue();
            const waiting = queue.take(10, { waitMs: 5000 });

            queue.publish(newItem(1));

            expect((await waiting).count).toBe(1);
        });

        it("returns an empty result when the wait runs out", async () => {
            const { queue, clock } = createTestQueue();
            const waiting = queue.take(5, { waitMs: 5000 });

            clock.advance(5000);

            expect(await waiting).toMatchObject({ batchId: null, count: 0 });
        });

        it("caps the wait at maxWaitMs", async () => {
            const { queue, clock } = createTestQueue({ maxWaitMs: 1000 });
            let finished = false;
            const waiting = queue.take(5, { waitMs: 60_000 }).then((result) => {
                finished = true;
                return result;
            });

            clock.advance(1000);
            await waiting;

            expect(finished).toBe(true);
        });

        it("serves the longest-waiting consumer first", async () => {
            const { queue } = createTestQueue();
            const first = queue.take(1, { waitMs: 5000 });
            const second = queue.take(1, { waitMs: 5000 });

            queue.publish(newItem(1));
            queue.publish(newItem(2));

            expect(payloadNumbers((await first).items)).toEqual([1]);
            expect(payloadNumbers((await second).items)).toEqual([2]);
        });

        it("counts waiting consumers in the stats and cleans up after they leave", async () => {
            const { queue, clock } = createTestQueue();
            const controller = new AbortController();
            const aborted = queue.take(1, { waitMs: 5000, signal: controller.signal });
            const timedOut = queue.take(1, { waitMs: 100 });

            expect(queue.stats().waitingConsumers).toBe(2);

            controller.abort();
            clock.advance(100);
            await Promise.all([aborted, timedOut]);

            expect(queue.stats().waitingConsumers).toBe(0);
            expect(clock.pendingTimers).toBe(0);
        });

        it("does not let an item go to a consumer who gave up", async () => {
            const { queue } = createTestQueue();
            const controller = new AbortController();
            const gaveUp = queue.take(1, { waitMs: 5000, signal: controller.signal });

            controller.abort();
            await gaveUp;
            queue.publish(newItem(1));

            expect(queue.stats().depth).toBe(1);
        });

        it("serves a waiting consumer when a timed-out batch returns", async () => {
            const { queue, clock } = createTestQueue();

            publishAll(queue, 1);
            await queue.take(1);

            const waiting = queue.take(1, { waitMs: RECEIPT_TIMEOUT_MS * 2 });

            clock.advance(RECEIPT_TIMEOUT_MS);

            expect((await waiting).items[0].deliveryCount).toBe(2);
        });
    });

    describe("overflow", () => {
        it("drop-oldest removes the oldest waiting item and counts it", async () => {
            const { queue } = createTestQueue({ maxSize: 3, overflow: "drop-oldest" });

            publishAll(queue, 5);

            expect(payloadNumbers((await queue.take(10)).items)).toEqual([3, 4, 5]);
            expect(queue.stats().dropped).toBe(2);
        });

        it("reject refuses the new item and keeps the old ones", async () => {
            const { queue } = createTestQueue({ maxSize: 3, overflow: "reject" });

            publishAll(queue, 5);

            expect(payloadNumbers((await queue.take(10)).items)).toEqual([1, 2, 3]);
            expect(queue.stats().rejected).toBe(2);
        });

        it("counts items in flight toward the size", async () => {
            const { queue } = createTestQueue({ maxSize: 3, overflow: "reject" });

            publishAll(queue, 3);
            await queue.take(3);

            expect(queue.publish(newItem(4))).toMatchObject({ accepted: false, reason: PublishRejectionReason.QueueFull });
        });

        it("never evicts an in-flight item to make room", async () => {
            const { queue, clock } = createTestQueue({ maxSize: 3, overflow: "drop-oldest" });

            publishAll(queue, 3);
            await queue.take(3);

            expect(queue.publish(newItem(4)).accepted).toBe(false);

            clock.advance(RECEIPT_TIMEOUT_MS);

            expect(payloadNumbers((await queue.take(10)).items)).toEqual([1, 2, 3]);
        });

        it("frees a slot when a batch is acknowledged", async () => {
            const { queue } = createTestQueue({ maxSize: 2, overflow: "reject" });

            publishAll(queue, 2);

            const { batchId } = await queue.take(2);

            queue.acknowledge(batchId!);

            expect(queue.publish(newItem(3)).accepted).toBe(true);
        });

        it("warns once when the queue is nearly full and again when it overflows, not on every item", () => {
            const { queue, logger } = createTestQueue({ maxSize: 10, overflow: "drop-oldest" });

            publishAll(queue, 30);

            expect(logger.warnings.filter((message) => message.includes("80% full")).length).toBe(1);
            expect(logger.warnings.filter((message) => message.includes("dropped its oldest")).length).toBe(1);
        });

        it("tracks the high-water mark", async () => {
            const { queue } = createTestQueue();

            publishAll(queue, 7);
            await queue.take(7);

            expect(queue.stats().highWaterMark).toBe(7);
        });
    });

    describe("expiry", () => {
        const TTL_MS = 2 * 60 * 60 * 1000;

        it("stamps expiresAt from the broker's enqueue time", async () => {
            const { queue, clock } = createTestQueue({ messageTtlMs: TTL_MS });

            queue.publish(newItem(1));

            expect((await queue.take(1)).items[0].expiresAt).toBe(clock.now() + TTL_MS);
        });

        it("sets no expiresAt when the queue has no TTL", async () => {
            const { queue } = createTestQueue();

            queue.publish(newItem(1));

            expect((await queue.take(1)).items[0].expiresAt).toBeUndefined();
        });

        it("skips and discards an expired item on take", async () => {
            const { queue, clock } = createTestQueue({ messageTtlMs: TTL_MS });

            queue.publish(newItem(1));
            clock.advance(TTL_MS);
            queue.publish(newItem(2));

            expect(payloadNumbers((await queue.take(5)).items)).toEqual([2]);
            expect(queue.stats().expired).toBe(1);
        });

        it("removes expired items from the front when swept, counting them apart from drops", () => {
            const { queue, clock } = createTestQueue({ messageTtlMs: TTL_MS });

            publishAll(queue, 3);
            clock.advance(TTL_MS / 2);
            queue.publish(newItem(4));
            clock.advance(TTL_MS / 2);

            expect(queue.sweep()).toBe(3);
            expect(queue.stats()).toMatchObject({ depth: 1, expired: 3, dropped: 0 });
        });

        it("does not expire an item while it is in flight", async () => {
            const { queue, clock } = createTestQueue({ messageTtlMs: TTL_MS, receiptTimeoutMs: TTL_MS * 2 });

            publishAll(queue, 1);

            const { batchId } = await queue.take(1);

            clock.advance(TTL_MS + 1);
            queue.sweep();

            expect(queue.acknowledge(batchId!)).toBe(true);
            expect(queue.stats().expired).toBe(0);
        });

        it("discards a returned batch that has passed its expiry in the meantime", async () => {
            const { queue, clock } = createTestQueue({ messageTtlMs: 5000, receiptTimeoutMs: 8000 });

            publishAll(queue, 1);
            await queue.take(1);
            clock.advance(8000);

            expect(queue.stats()).toMatchObject({ depth: 0, expired: 1, redelivered: 0 });
        });

        it("no longer applies once the consumer has acknowledged", async () => {
            const { queue, clock } = createTestQueue({ messageTtlMs: 5000 });

            publishAll(queue, 1);

            const { batchId } = await queue.take(1);

            queue.acknowledge(batchId!);
            clock.advance(10_000);

            expect(queue.sweep()).toBe(0);
            expect(queue.stats().expired).toBe(0);
        });
    });

    describe("peek", () => {
        it("shows the front items without removing or leasing them", async () => {
            const { queue } = createTestQueue();

            publishAll(queue, 3);

            expect(payloadNumbers(queue.peek(2))).toEqual([1, 2]);
            expect(queue.stats()).toMatchObject({ depth: 3, inFlight: 0 });
            expect((await queue.take(10)).count).toBe(3);
        });

        it("skips expired items", () => {
            const { queue, clock } = createTestQueue({ messageTtlMs: 1000 });

            queue.publish(newItem(1));
            clock.advance(1000);
            queue.publish(newItem(2));

            expect(payloadNumbers(queue.peek(5))).toEqual([2]);
        });
    });

    describe("purge", () => {
        it("removes everything waiting and says how many", () => {
            const { queue } = createTestQueue();

            publishAll(queue, 4);

            expect(queue.purge()).toBe(4);
            expect(queue.stats()).toMatchObject({ depth: 0, purged: 4 });
        });

        it("does not reset the sequence counter", () => {
            const { queue } = createTestQueue();

            publishAll(queue, 4);
            queue.purge();

            expect(queue.publish(newItem(5))).toMatchObject({ sequence: 5 });
        });

        it("does not affect batches already in flight", async () => {
            const { queue, clock } = createTestQueue();

            publishAll(queue, 3);
            await queue.take(2);
            queue.purge();
            clock.advance(RECEIPT_TIMEOUT_MS);

            expect(payloadNumbers((await queue.take(10)).items)).toEqual([1, 2]);
        });
    });

    describe("stats", () => {
        it("counts what happened", async () => {
            const { queue } = createTestQueue({ maxSize: 5 });

            publishAll(queue, 3);

            const { batchId } = await queue.take(2);

            queue.acknowledge(batchId!);

            expect(queue.stats()).toMatchObject({
                name: "test", published: 3, taken: 2, acknowledged: 2, depth: 1, totalWaiting: 1, maxSize: 5, closed: false,
            });
        });
    });

    describe("shutdown", () => {
        it("refuses publishes and gives takes an empty answer", async () => {
            const { queue } = createTestQueue();

            publishAll(queue, 1);
            queue.shutdown();

            expect(queue.publish(newItem(2))).toMatchObject({ accepted: false, reason: PublishRejectionReason.QueueClosed });
            expect((await queue.take(5)).count).toBe(0);
            expect(queue.isClosed).toBe(true);
        });

        it("refuses a batch publish after shutdown", () => {
            const { queue } = createTestQueue();

            queue.shutdown();

            expect(queue.publishBatch([newItem(1)])[0]).toMatchObject({ accepted: false, reason: PublishRejectionReason.QueueClosed });
        });

        it("releases consumers who are waiting", async () => {
            const { queue, clock } = createTestQueue();
            const waiting = queue.take(5, { waitMs: 30_000 });

            queue.shutdown();

            expect((await waiting).count).toBe(0);
            expect(clock.pendingTimers).toBe(0);
        });

        it("cancels receipt timers of batches in flight", async () => {
            const { queue, clock } = createTestQueue();

            publishAll(queue, 2);
            await queue.take(2);
            queue.shutdown();

            expect(clock.pendingTimers).toBe(0);
        });
    });
});
