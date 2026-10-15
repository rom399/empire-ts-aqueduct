import path from "node:path";
import { describe, expect, it } from "vitest";
import { QueueConfigurationError } from "../../../src/options/QueueConfigurationError";
import { QueueRegistry } from "../../../src/registry/QueueRegistry";
import { UnknownQueueError } from "../../../src/registry/UnknownQueueError";
import { ManualClock } from "../../fixtures/clock/ManualClock";
import { listFiles, makeTempDirectory } from "../../fixtures/files/makeTempDirectory";
import { newItem, payloadNumbers } from "../../fixtures/items/newItem";
import { TestQueueLogger } from "../../fixtures/logging/TestQueueLogger";

function makeRegistry(options: Partial<ConstructorParameters<typeof QueueRegistry>[0]> = {}) {
    const clock = new ManualClock();
    const logger = new TestQueueLogger();
    const registry = new QueueRegistry({ queues: { telemetry: {}, jobs: {} }, clock, logger, ...options });

    return { registry, clock, logger };
}

describe("QueueRegistry", () => {
    describe("declared queues", () => {
        it("lists the queue names in declaration order", () => {
            expect(makeRegistry().registry.names()).toEqual(["telemetry", "jobs"]);
        });

        it("returns a declared queue", () => {
            expect(makeRegistry().registry.get("telemetry").name).toBe("telemetry");
        });

        it("throws for a queue that was not declared", () => {
            expect(() => makeRegistry().registry.get("nope")).toThrow(UnknownQueueError);
        });

        it("finds nothing for a queue that was not declared", () => {
            expect(makeRegistry().registry.find("nope")).toBeUndefined();
        });

        it("refuses an invalid or reserved queue name when it is built", () => {
            expect(() => makeRegistry({ queues: { "Bad Name": {} } })).toThrow(QueueConfigurationError);
            expect(() => makeRegistry({ queues: { nul: {} } })).toThrow(QueueConfigurationError);
        });

        it("refuses a bad setting, naming the queue", () => {
            expect(() => makeRegistry({ queues: { jobs: { maxSize: 0 } } })).toThrow(/Queue "jobs"/);
        });
    });

    describe("isolation", () => {
        it("keeps separate items, sequence counters and settings per queue", async () => {
            const { registry } = makeRegistry({ queues: { small: { maxSize: 2, overflow: "reject" }, big: {} } });
            const small = registry.get("small");
            const big = registry.get("big");

            for (let n = 1; n <= 5; n++) {
                small.publish(newItem(n));
                big.publish(newItem(n * 10));
            }

            expect(payloadNumbers((await small.take(10)).items)).toEqual([1, 2]);
            expect(payloadNumbers((await big.take(10)).items)).toEqual([10, 20, 30, 40, 50]);
            expect(big.stats().rejected).toBe(0);
        });

        it("keeps one queue's spill files out of another's folder", () => {
            const root = makeTempDirectory();
            const spill = { overflow: "spill", maxSize: 2, spillBufferSize: 2, spillBatchSize: 1, maxSpillFiles: 10 } as const;
            const { registry } = makeRegistry({ queues: { alpha: spill, beta: spill }, spillRoot: root });

            for (let n = 1; n <= 6; n++) {
                registry.get("alpha").publish(newItem(n));
            }

            expect(listFiles(path.join(root, "alpha")).length).toBeGreaterThan(0);
            expect(listFiles(path.join(root, "beta"))).toEqual([]);
        });
    });

    describe("starting", () => {
        it("logs the worst-case memory across all queues", () => {
            const { registry, logger } = makeRegistry({ queues: { a: { maxSize: 100 }, b: { maxSize: 50 } } });

            registry.start();

            expect(logger.infos.some((message) => message.includes("2 queue(s)") && message.includes("150 items"))).toBe(true);
        });

        it("counts the spill buffer and batch in the worst case for a spilling queue", () => {
            const { registry, logger } = makeRegistry({
                queues: { a: { maxSize: 100, overflow: "spill", spillBufferSize: 50, spillBatchSize: 10, maxSpillFiles: 4 } },
                spillRoot: makeTempDirectory(),
            });

            registry.start();

            expect(logger.infos.some((message) => message.includes("160 items") && message.includes("4 spill files"))).toBe(true);
        });

        it("restores persisted items before it is used", async () => {
            const root = makeTempDirectory();
            const options = { queues: { jobs: { persist: true } }, spillRoot: root };
            const first = makeRegistry(options);

            first.registry.start();
            first.registry.get("jobs").publish(newItem(1));
            first.registry.dispose();

            const second = makeRegistry(options);

            second.registry.start();

            expect(payloadNumbers((await second.registry.get("jobs").take(5)).items)).toEqual([1]);
        });
    });

    describe("sweeping", () => {
        it("removes expired items from every queue on one shared timer", () => {
            const { registry, clock } = makeRegistry({
                queues: { a: { messageTtlMs: 1000 }, b: { messageTtlMs: 1000 } },
                sweepIntervalMs: 500,
            });

            registry.start();
            registry.get("a").publish(newItem(1));
            registry.get("b").publish(newItem(1));
            clock.advance(1500);

            expect(registry.get("a").stats().expired).toBe(1);
            expect(registry.get("b").stats().expired).toBe(1);
            expect(clock.pendingTimers).toBe(1);
        });
    });

    describe("disposing", () => {
        it("shuts every queue down and stops the sweeper", () => {
            const { registry, clock } = makeRegistry();

            registry.start();
            registry.dispose();

            expect(registry.get("telemetry").isClosed).toBe(true);
            expect(registry.get("jobs").isClosed).toBe(true);
            expect(clock.pendingTimers).toBe(0);
        });
    });
});
