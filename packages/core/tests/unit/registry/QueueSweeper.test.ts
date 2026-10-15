import { describe, expect, it } from "vitest";
import { Queue } from "../../../src/queue/Queue";
import { QueueSweeper } from "../../../src/registry/QueueSweeper";
import { createTestQueue } from "../../fixtures/queue/createTestQueue";

const INTERVAL_MS = 1000;

describe("QueueSweeper", () => {
    function makeSweeper() {
        const { clock } = createTestQueue();
        const swept: string[] = [];
        const fake = { sweep: () => { swept.push("swept"); return 0; } } as unknown as Queue;
        const sweeper = new QueueSweeper(() => [fake], INTERVAL_MS, clock);

        return { sweeper, clock, swept };
    }

    it("sweeps every interval", () => {
        const { sweeper, clock, swept } = makeSweeper();

        sweeper.start();
        clock.advance(INTERVAL_MS * 3);

        expect(swept.length).toBe(3);
    });

    it("does nothing before it is started", () => {
        const { clock, swept } = makeSweeper();

        clock.advance(INTERVAL_MS * 3);

        expect(swept.length).toBe(0);
    });

    it("stops sweeping and leaves no timer when stopped", () => {
        const { sweeper, clock, swept } = makeSweeper();

        sweeper.start();
        sweeper.stop();
        clock.advance(INTERVAL_MS * 3);

        expect(swept.length).toBe(0);
        expect(clock.pendingTimers).toBe(0);
    });

    it("does not start a second timer if started twice", () => {
        const { sweeper, clock } = makeSweeper();

        sweeper.start();
        sweeper.start();

        expect(clock.pendingTimers).toBe(1);
    });
});
