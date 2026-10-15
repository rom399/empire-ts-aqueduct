import { describe, expect, it } from "vitest";
import { LongPollQueue } from "../../../src/structures/LongPollQueue";
import { ManualClock } from "../../fixtures/clock/ManualClock";

const TIMEOUT_MS = 1000;

describe("LongPollQueue", () => {
    describe("serving", () => {
        it("serves the longest-waiting consumer first", async () => {
            const waiters = new LongPollQueue<string>(new ManualClock());
            const first = waiters.wait(1, TIMEOUT_MS);
            const second = waiters.wait(1, TIMEOUT_MS);
            const results = ["a", "b"];

            waiters.serve(() => results.shift() ?? null);

            expect(await first).toBe("a");
            expect(await second).toBe("b");
        });

        it("passes each waiter's own request size to the producer", () => {
            const waiters = new LongPollQueue<string>(new ManualClock());
            const asked: number[] = [];

            void waiters.wait(3, TIMEOUT_MS);
            void waiters.wait(7, TIMEOUT_MS);
            waiters.serve((maxItems) => {
                asked.push(maxItems);
                return "x";
            });

            expect(asked).toEqual([3, 7]);
        });

        it("stops serving when nothing is available and keeps the rest waiting", () => {
            const waiters = new LongPollQueue<string>(new ManualClock());

            void waiters.wait(1, TIMEOUT_MS);
            waiters.serve(() => null);

            expect(waiters.length).toBe(1);
        });
    });

    describe("ending a wait", () => {
        it("resolves null at the timeout and removes the waiter", async () => {
            const clock = new ManualClock();
            const waiters = new LongPollQueue<string>(clock);
            const waiting = waiters.wait(1, TIMEOUT_MS);

            clock.advance(TIMEOUT_MS);

            expect(await waiting).toBeNull();
            expect(waiters.length).toBe(0);
            expect(clock.pendingTimers).toBe(0);
        });

        it("resolves null when the signal aborts and removes the waiter", async () => {
            const clock = new ManualClock();
            const waiters = new LongPollQueue<string>(clock);
            const controller = new AbortController();
            const waiting = waiters.wait(1, TIMEOUT_MS, controller.signal);

            controller.abort();

            expect(await waiting).toBeNull();
            expect(waiters.length).toBe(0);
            expect(clock.pendingTimers).toBe(0);
        });

        it("resolves null at once when the signal is already aborted", async () => {
            const waiters = new LongPollQueue<string>(new ManualClock());
            const controller = new AbortController();

            controller.abort();

            expect(await waiters.wait(1, TIMEOUT_MS, controller.signal)).toBeNull();
            expect(waiters.length).toBe(0);
        });

        it("cancels the timer of a waiter that was served", async () => {
            const clock = new ManualClock();
            const waiters = new LongPollQueue<string>(clock);
            const waiting = waiters.wait(1, TIMEOUT_MS);

            waiters.serve(() => "item");
            await waiting;

            expect(clock.pendingTimers).toBe(0);
        });

        it("releases every waiter with null", async () => {
            const waiters = new LongPollQueue<string>(new ManualClock());
            const waiting = [waiters.wait(1, TIMEOUT_MS), waiters.wait(1, TIMEOUT_MS)];

            waiters.releaseAll();

            expect(await Promise.all(waiting)).toEqual([null, null]);
            expect(waiters.length).toBe(0);
        });
    });
});
