import { describe, expect, it } from "vitest";
import { SystemClock } from "../../../src/clock/SystemClock";

describe("SystemClock", () => {
    it("reports the current time", () => {
        const before = Date.now();
        const now = new SystemClock().now();

        expect(now).toBeGreaterThanOrEqual(before);
        expect(now).toBeLessThanOrEqual(Date.now());
    });

    it("runs a callback after the delay", async () => {
        const clock = new SystemClock();

        await new Promise<void>((resolve) => {
            // The timer is unref'd, so keep the process alive until it fires.
            const keepAlive = setTimeout(() => undefined, 1000);

            clock.setTimeout(() => {
                clearTimeout(keepAlive);
                resolve();
            }, 5);
        });
    });

    it("does not run a cancelled callback", async () => {
        let ran = false;

        new SystemClock().setTimeout(() => { ran = true; }, 5).cancel();
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(ran).toBe(false);
    });
});
