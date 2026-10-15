import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QueueOptions } from "../../../src/options/QueueOptions";
import { listFiles, makeTempDirectory } from "../../fixtures/files/makeTempDirectory";
import { newItem, payloadNumbers } from "../../fixtures/items/newItem";
import { createTestQueue, restartTestQueue, TestQueue } from "../../fixtures/queue/createTestQueue";

const PERSIST: QueueOptions = { persist: true, maxSize: 20, spillBatchSize: 4, spillBufferSize: 8 };

function publishAll(queue: TestQueue["queue"], from: number, to: number): void {
    for (let n = from; n <= to; n++) {
        queue.publish(newItem(n));
    }
}

async function takeAll(queue: TestQueue["queue"]): Promise<number[]> {
    const order: number[] = [];

    for (;;) {
        const result = await queue.take(5);

        if (result.count === 0) {
            return order;
        }

        order.push(...payloadNumbers(result.items));
        queue.acknowledge(result.batchId!);
    }
}

describe("Queue persistence", () => {
    describe("a clean shutdown and restart", () => {
        it("restores the items in order", async () => {
            const root = makeTempDirectory();
            const first = createTestQueue(PERSIST, root);

            publishAll(first.queue, 1, 10);
            first.queue.shutdown();

            const second = restartTestQueue(PERSIST, root);

            expect(await takeAll(second.queue)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        });

        it("continues the sequence numbers", () => {
            const root = makeTempDirectory();
            const first = createTestQueue(PERSIST, root);

            publishAll(first.queue, 1, 3);
            first.queue.shutdown();

            const second = restartTestQueue(PERSIST, root);

            expect(second.queue.publish(newItem(4))).toMatchObject({ accepted: true, sequence: 4 });
        });

        it("writes files of at most spillBatchSize items", () => {
            const root = makeTempDirectory();
            const first = createTestQueue(PERSIST, root);

            publishAll(first.queue, 1, 10);
            first.queue.shutdown();

            expect(listFiles(path.join(root, "test")).filter((name) => name.endsWith(".ndjson")).length).toBe(3);
        });

        it("saves items that were in flight, as waiting", async () => {
            const root = makeTempDirectory();
            const first = createTestQueue(PERSIST, root);

            publishAll(first.queue, 1, 5);
            await first.queue.take(3);
            first.queue.shutdown();

            const second = restartTestQueue(PERSIST, root);

            expect(await takeAll(second.queue)).toEqual([1, 2, 3, 4, 5]);
        });

        it("starts the delivery count again at 1", async () => {
            const root = makeTempDirectory();
            const first = createTestQueue(PERSIST, root);

            publishAll(first.queue, 1, 1);
            await first.queue.take(1);
            first.clock.advance(10_000);
            first.queue.shutdown();

            const second = restartTestQueue(PERSIST, root);

            expect((await second.queue.take(1)).items[0].deliveryCount).toBe(1);
        });

        it("saves the spill buffer and spill files as well as the main queue, still in order", async () => {
            const root = makeTempDirectory();
            const options: QueueOptions = { ...PERSIST, maxSize: 5, overflow: "spill", maxSpillFiles: 10, spillBufferSize: 4, spillBatchSize: 2 };
            const first = createTestQueue(options, root);

            publishAll(first.queue, 1, 12);
            first.queue.shutdown();

            const second = restartTestQueue(options, root);

            expect(await takeAll(second.queue)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        });

        it("keeps what does not fit on disk and still delivers it in order", async () => {
            const root = makeTempDirectory();
            const big: QueueOptions = { ...PERSIST, maxSize: 20 };
            const first = createTestQueue(big, root);

            publishAll(first.queue, 1, 15);
            first.queue.shutdown();

            const small = restartTestQueue({ ...big, maxSize: 6, spillBatchSize: 4 }, root);

            expect(small.queue.stats().depth).toBeLessThanOrEqual(6);
            expect(await takeAll(small.queue)).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
        });

        it("deletes the files once they are loaded", () => {
            const root = makeTempDirectory();
            const first = createTestQueue(PERSIST, root);

            publishAll(first.queue, 1, 6);
            first.queue.shutdown();
            restartTestQueue(PERSIST, root);

            expect(listFiles(path.join(root, "test")).filter((name) => name.endsWith(".ndjson"))).toEqual([]);
        });

        it("writes nothing when persist is off", () => {
            const root = makeTempDirectory();
            const first = createTestQueue({ ...PERSIST, persist: false, overflow: "spill", maxSpillFiles: 5 }, root);

            publishAll(first.queue, 1, 3);
            first.queue.shutdown();

            expect(listFiles(root)).toEqual([]);
        });

        it("does not save items that have already expired", async () => {
            const root = makeTempDirectory();
            const options = { ...PERSIST, messageTtlMs: 1000 };
            const first = createTestQueue(options, root);

            publishAll(first.queue, 1, 3);
            first.clock.advance(1000);
            publishAll(first.queue, 4, 5);
            first.queue.shutdown();

            const second = restartTestQueue(options, root);

            expect(await takeAll(second.queue)).toEqual([4, 5]);
        });
    });

    describe("expiry across a restart", () => {
        it("counts the time the broker was down against the TTL", async () => {
            const root = makeTempDirectory();
            const options = { ...PERSIST, messageTtlMs: 60_000 };
            const first = createTestQueue(options, root);

            publishAll(first.queue, 1, 5);
            first.queue.shutdown();

            const second = createTestQueue(options, root);

            second.clock.advance(60_000);
            second.queue.restore();

            expect(await takeAll(second.queue)).toEqual([]);
            expect(second.queue.stats().expired).toBe(5);
        });
    });

    describe("a missing, damaged or leftover folder", () => {
        it("starts empty with no complaint when there are no files", () => {
            const root = makeTempDirectory();
            const { queue, logger } = restartTestQueue(PERSIST, root);

            expect(queue.stats().totalWaiting).toBe(0);
            expect(logger.warnings).toEqual([]);
        });

        it("renames a corrupt file aside, warns, and loads the rest", async () => {
            const root = makeTempDirectory();
            const first = createTestQueue(PERSIST, root);

            publishAll(first.queue, 1, 8);
            first.queue.shutdown();

            const files = listFiles(path.join(root, "test")).filter((name) => name.endsWith(".ndjson"));

            fs.writeFileSync(path.join(root, "test", files[0]), "garbage\n");

            const second = restartTestQueue(PERSIST, root);

            expect(await takeAll(second.queue)).toEqual([5, 6, 7, 8]);
            expect(second.logger.warnings.length).toBeGreaterThan(0);
            expect(listFiles(path.join(root, "test")).some((name) => name.endsWith(".corrupt"))).toBe(true);
        });

        it("loads spill files left behind by a crash", async () => {
            const root = makeTempDirectory();
            const options: QueueOptions = { maxSize: 5, overflow: "spill", maxSpillFiles: 10, spillBufferSize: 4, spillBatchSize: 2 };
            const crashed = createTestQueue(options, root);

            publishAll(crashed.queue, 1, 10);
            // No shutdown: the process "crashed" with the main queue and buffer in memory only.

            const restarted = restartTestQueue(options, root);

            expect(await takeAll(restarted.queue)).toEqual([6, 7]);
        });

        it("never reuses a sequence number after a crash", () => {
            const root = makeTempDirectory();
            const options: QueueOptions = { maxSize: 5, overflow: "spill", maxSpillFiles: 10, spillBufferSize: 4, spillBatchSize: 2 };
            const crashed = createTestQueue(options, root);

            publishAll(crashed.queue, 1, 10);

            const restarted = restartTestQueue(options, root);

            expect(restarted.queue.publish(newItem(11))).toMatchObject({ sequence: 10 });
        });
    });
});
