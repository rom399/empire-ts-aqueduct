import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QueueOptions } from "../../../src/options/QueueOptions";
import { PublishRejectionReason } from "../../../src/publishing/PublishRejectionReason";
import { listFiles, makeTempDirectory } from "../../fixtures/files/makeTempDirectory";
import { newItem, payloadNumbers } from "../../fixtures/items/newItem";
import { createTestQueue, TestQueue } from "../../fixtures/queue/createTestQueue";

/** Small tiers so a handful of items crosses every boundary: main 5, buffer 4, files of 2. */
const SPILL: QueueOptions = {
    maxSize: 5,
    overflow: "spill",
    spillBufferSize: 4,
    spillBatchSize: 2,
    maxSpillFiles: 100,
};

function spillQueue(overrides: QueueOptions = {}): TestQueue & { root: string } {
    const root = makeTempDirectory();

    return { ...createTestQueue({ ...SPILL, ...overrides }, root), root };
}

function publishAll(queue: TestQueue["queue"], from: number, to: number): void {
    for (let n = from; n <= to; n++) {
        queue.publish(newItem(n));
    }
}

/** Takes and acknowledges everything, returning the item numbers in the order they came out. */
async function drain(queue: TestQueue["queue"], batchSize: number): Promise<number[]> {
    const order: number[] = [];

    for (;;) {
        const result = await queue.take(batchSize);

        if (result.count === 0) {
            return order;
        }

        order.push(...payloadNumbers(result.items));
        queue.acknowledge(result.batchId!);
    }
}

describe("Queue with overflow: spill", () => {
    describe("the three tiers", () => {
        it("fills the main queue first, then the buffer", () => {
            const { queue } = spillQueue();

            publishAll(queue, 1, 8);

            expect(queue.stats()).toMatchObject({ depth: 5, buffered: 3, spilledFiles: 0 });
        });

        it("writes only the oldest spillBatchSize buffered items when the buffer is full", () => {
            const { queue } = spillQueue();

            publishAll(queue, 1, 10);

            expect(queue.stats()).toMatchObject({ depth: 5, buffered: 3, spilledFiles: 1, spilledItems: 2 });
        });

        it("keeps strict first-in first-out across main, files and buffer", async () => {
            const { queue } = spillQueue();

            publishAll(queue, 1, 40);

            expect(await drain(queue, 3)).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
        });

        it("keeps strict order when publishing and consuming are interleaved", async () => {
            const { queue } = spillQueue();
            const seen: number[] = [];
            let next = 1;

            for (let round = 0; round < 12; round++) {
                publishAll(queue, next, next + 4);
                next += 5;

                const result = await queue.take(2);

                seen.push(...payloadNumbers(result.items));
                queue.acknowledge(result.batchId!);
            }

            seen.push(...await drain(queue, 4));

            expect(seen).toEqual(Array.from({ length: next - 1 }, (_, index) => index + 1));
        });

        it("sends new items to the buffer while files exist, even if main has a free slot", async () => {
            const { queue } = spillQueue();

            publishAll(queue, 1, 10);

            const first = await queue.take(1);

            queue.acknowledge(first.batchId!);

            // One slot is free in main, but the file of two does not fit, so item 11 must queue behind the file.
            expect(queue.stats()).toMatchObject({ depth: 4, spilledFiles: 1 });

            queue.publish(newItem(11));

            expect(queue.stats()).toMatchObject({ depth: 4, buffered: 4 });
        });

        it("loads a file only when main has room for all of it", async () => {
            const { queue } = spillQueue();

            publishAll(queue, 1, 10);

            const one = await queue.take(1);
            queue.acknowledge(one.batchId!);

            expect(queue.stats().spilledFiles).toBe(1);

            const another = await queue.take(1);
            queue.acknowledge(another.batchId!);

            expect(queue.stats()).toMatchObject({ spilledFiles: 0, depth: 5 });
        });

        it("moves buffered items into main without touching the disk when no files exist", async () => {
            const { queue, store } = spillQueue();

            publishAll(queue, 1, 8);

            const result = await queue.take(2);
            queue.acknowledge(result.batchId!);

            expect(store!.fileCount).toBe(0);
            expect(queue.stats()).toMatchObject({ depth: 5, buffered: 1 });
        });

        it("never lets consumers read the buffer or files directly", async () => {
            const { queue } = spillQueue();

            publishAll(queue, 1, 10);

            // Everything in main is in flight, so nothing more can be taken even though items wait below.
            await queue.take(5);

            expect((await queue.take(5)).count).toBe(0);
            expect(queue.stats().totalWaiting).toBe(5);
        });

        it("counts every tier in totalWaiting and the high-water mark", () => {
            const { queue } = spillQueue();

            publishAll(queue, 1, 10);

            expect(queue.stats()).toMatchObject({ totalWaiting: 10, highWaterMark: 10 });
        });

        it("puts a returned in-flight batch back at the front, ahead of the files", async () => {
            const { queue, clock } = spillQueue();

            publishAll(queue, 1, 10);
            await queue.take(3);
            clock.advance(10_000);

            expect(await drain(queue, 4)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        });
    });

    describe("spill files", () => {
        it("writes files named by day, minute and sequence range", () => {
            const { queue, root } = spillQueue();

            publishAll(queue, 1, 10);

            const files = listFiles(path.join(root, "test")).filter((name) => name.endsWith(".ndjson"));

            expect(files.length).toBe(1);
            expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}[\\/]\d{4}-\d{2}-\d{2}T\d{2}-\d{2}_seq000000006-000000007\.ndjson$/);
        });

        it("deletes a file after it is loaded", async () => {
            const { queue, root } = spillQueue();

            publishAll(queue, 1, 10);
            await drain(queue, 5);

            expect(listFiles(path.join(root, "test")).filter((name) => name.endsWith(".ndjson"))).toEqual([]);
        });

        it("does not write the delivery count into the file", async () => {
            const { queue, clock, root } = spillQueue();

            publishAll(queue, 1, 10);
            await queue.take(1);
            clock.advance(10_000);

            const [file] = listFiles(path.join(root, "test")).filter((name) => name.endsWith(".ndjson"));

            expect(fs.readFileSync(path.join(root, "test", file), "utf8")).not.toContain("deliveryCount");
        });

        it("saves the sequence counter when it writes a file", () => {
            const { queue, store } = spillQueue();

            publishAll(queue, 1, 10);

            expect(store!.readState()).toEqual({ nextSequence: 10 });
        });

        it("keeps each queue's files in its own folder", () => {
            const root = makeTempDirectory();
            const a = createTestQueue(SPILL, root, "alpha");
            const b = createTestQueue(SPILL, root, "beta");

            publishAll(a.queue, 1, 10);
            publishAll(b.queue, 1, 10);

            expect(a.store!.fileCount).toBe(1);
            expect(b.store!.fileCount).toBe(1);
            expect(fs.readdirSync(root).sort()).toEqual(["alpha", "beta"]);
        });
    });

    describe("the disk cap", () => {
        it("rejects new items when the cap is reached and spillFull is reject", () => {
            const { queue } = spillQueue({ maxSpillFiles: 1 });

            // Main holds 5, the file holds 2, the buffer holds 4: the twelfth item needs a second file.
            publishAll(queue, 1, 11);

            expect(queue.publish(newItem(12))).toMatchObject({ accepted: false, reason: PublishRejectionReason.SpillFull });
            expect(queue.stats()).toMatchObject({ rejected: 1, totalWaiting: 11 });
        });

        it("deletes the oldest file and counts its items as dropped when spillFull is drop-oldest", async () => {
            const { queue } = spillQueue({ maxSpillFiles: 1, spillFull: "drop-oldest" });

            publishAll(queue, 1, 14);

            // Two files were deleted along the way, 2 items each.
            expect(queue.stats()).toMatchObject({ dropped: 4, spilledFiles: 1 });
            expect(await drain(queue, 4)).toEqual([1, 2, 3, 4, 5, 10, 11, 12, 13, 14]);
        });

        it("honours a byte cap", () => {
            const { queue } = spillQueue({ maxSpillFiles: undefined, maxSpillBytes: 1 });

            publishAll(queue, 1, 10);

            expect(queue.publish(newItem(11)).accepted).toBe(true);
            expect(queue.stats().spilledFiles).toBe(1);
        });
    });

    describe("when the disk fails", () => {
        it("keeps running, drops the oldest buffered items and warns", () => {
            const { queue, logger, root } = spillQueue();

            // A file where the queue's folder should be makes every write fail.
            fs.writeFileSync(path.join(root, "test"), "in the way");

            expect(() => publishAll(queue, 1, 10)).not.toThrow();
            expect(queue.stats()).toMatchObject({ dropped: 2, spilledFiles: 0, buffered: 3 });
            expect(logger.errors.length).toBe(1);
        });
    });

    describe("expiry across the tiers", () => {
        const TTL_MS = 60_000;

        it("removes expired items from the buffer and main when swept", () => {
            const { queue, clock } = spillQueue({ messageTtlMs: TTL_MS, maxSpillFiles: 10 });

            publishAll(queue, 1, 8);
            clock.advance(TTL_MS);

            expect(queue.sweep()).toBe(8);
            expect(queue.stats()).toMatchObject({ totalWaiting: 0, expired: 8 });
        });

        it("deletes a fully expired file without loading it", () => {
            const { queue, clock, root } = spillQueue({ messageTtlMs: TTL_MS });

            publishAll(queue, 1, 10);
            clock.advance(TTL_MS);
            queue.sweep();

            expect(listFiles(path.join(root, "test")).filter((name) => name.endsWith(".ndjson"))).toEqual([]);
            expect(queue.stats().expired).toBe(10);
        });

        it("filters expired items out of a file that is partly live when it loads", async () => {
            const { queue, clock } = spillQueue({ messageTtlMs: TTL_MS });

            publishAll(queue, 1, 6);
            clock.advance(TTL_MS / 2);
            publishAll(queue, 7, 10);
            clock.advance(TTL_MS / 2);

            // Items 1 to 6 have expired; the file holds 6 and 7, and only 7 is live.
            const taken = await drain(queue, 5);

            expect(taken).toEqual([7, 8, 9, 10]);
            expect(queue.stats().expired).toBe(6);
        });
    });

    describe("purge", () => {
        it("empties every tier and deletes the spill files", () => {
            const { queue, root } = spillQueue();

            publishAll(queue, 1, 10);

            expect(queue.purge()).toBe(10);
            expect(queue.stats()).toMatchObject({ depth: 0, buffered: 0, spilledFiles: 0, totalWaiting: 0 });
            expect(listFiles(path.join(root, "test")).filter((name) => name.endsWith(".ndjson"))).toEqual([]);
        });
    });
});
