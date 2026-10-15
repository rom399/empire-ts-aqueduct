import { describe, expect, it } from "vitest";
import { WarningThrottle } from "../../../src/structures/WarningThrottle";
import { ManualClock } from "../../fixtures/clock/ManualClock";

const INTERVAL_MS = 1000;

describe("WarningThrottle", () => {
    it("lets the first warning of a kind through", () => {
        expect(new WarningThrottle(new ManualClock(), INTERVAL_MS).allow("full")).toBe(true);
    });

    it("holds back repeats of the same kind within the interval", () => {
        const clock = new ManualClock();
        const throttle = new WarningThrottle(clock, INTERVAL_MS);

        throttle.allow("full");
        clock.advance(INTERVAL_MS - 1);

        expect(throttle.allow("full")).toBe(false);
    });

    it("lets the kind through again once the interval has passed", () => {
        const clock = new ManualClock();
        const throttle = new WarningThrottle(clock, INTERVAL_MS);

        throttle.allow("full");
        clock.advance(INTERVAL_MS);

        expect(throttle.allow("full")).toBe(true);
    });

    it("tracks each kind separately", () => {
        const throttle = new WarningThrottle(new ManualClock(), INTERVAL_MS);

        throttle.allow("full");

        expect(throttle.allow("near-full")).toBe(true);
    });
});
