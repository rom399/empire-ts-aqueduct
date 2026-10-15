import path from "node:path";
import { describe, expect, it } from "vitest";
import { OverflowPolicy } from "../../../src/options/OverflowPolicy";
import { QueueConfigurationError } from "../../../src/options/QueueConfigurationError";
import { resolveQueueSettings } from "../../../src/options/resolveQueueSettings";
import { SpillFullPolicy } from "../../../src/options/SpillFullPolicy";

describe("resolveQueueSettings", () => {
    describe("defaults", () => {
        it("fills in every default", () => {
            expect(resolveQueueSettings("telemetry")).toEqual({
                name: "telemetry",
                maxSize: 10_000,
                overflow: OverflowPolicy.DropOldest,
                spillBufferSize: 10_000,
                spillBatchSize: 2_000,
                spillFull: SpillFullPolicy.Reject,
                receiptTimeoutMs: 10_000,
                maxWaitMs: 30_000,
                maxPayloadBytes: 65_536,
                maxPublishBatch: 500,
                maxPublishBytes: 1_048_576,
                maxTakeSize: 100,
                persist: false,
            });
        });

        it("lowers the default spill batch so a small queue still works with its defaults", () => {
            expect(resolveQueueSettings("small", { maxSize: 100 }).spillBatchSize).toBe(100);
        });

        it("puts the spill folder under the spill root, named for the queue", () => {
            const settings = resolveQueueSettings("jobs", { persist: true }, "/data");

            expect(settings.spillDirectory).toBe(path.join("/data", "jobs"));
        });

        it("sets no spill folder for a queue that neither spills nor persists", () => {
            expect(resolveQueueSettings("jobs", {}, "/data").spillDirectory).toBeUndefined();
        });
    });

    describe("validation", () => {
        it("refuses an invalid queue name", () => {
            expect(() => resolveQueueSettings("Bad Name")).toThrow(QueueConfigurationError);
        });

        it("refuses numbers that are not positive integers, naming the queue and the setting", () => {
            for (const maxSize of [0, -5, 1.5, Number.NaN]) {
                expect(() => resolveQueueSettings("jobs", { maxSize })).toThrow(/Queue "jobs": maxSize/);
            }
        });

        it("refuses an unknown overflow policy", () => {
            expect(() => resolveQueueSettings("jobs", { overflow: "explode" as never })).toThrow(/overflow/);
        });

        it("refuses spill without a spill root", () => {
            expect(() => resolveQueueSettings("jobs", { overflow: "spill", maxSpillFiles: 5 })).toThrow(/spillRoot/);
        });

        it("refuses persist without a spill root", () => {
            expect(() => resolveQueueSettings("jobs", { persist: true })).toThrow(/spillRoot/);
        });

        it("refuses spill without a disk cap", () => {
            expect(() => resolveQueueSettings("jobs", { overflow: "spill" }, "/data")).toThrow(/maxSpillFiles or maxSpillBytes/);
        });

        it("accepts spill with either disk cap", () => {
            expect(() => resolveQueueSettings("a", { overflow: "spill", maxSpillFiles: 5 }, "/data")).not.toThrow();
            expect(() => resolveQueueSettings("b", { overflow: "spill", maxSpillBytes: 1000 }, "/data")).not.toThrow();
        });

        it("refuses a spill batch bigger than maxSize", () => {
            expect(() => resolveQueueSettings("jobs", { maxSize: 100, spillBatchSize: 200 })).toThrow(/spillBatchSize.*maxSize/);
        });

        it("refuses a spill batch bigger than the spill buffer", () => {
            expect(() => resolveQueueSettings("jobs", {
                overflow: "spill", maxSpillFiles: 5, spillBufferSize: 100, spillBatchSize: 200,
            }, "/data")).toThrow(/spillBatchSize.*spillBufferSize/);
        });
    });
});
