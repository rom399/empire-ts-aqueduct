import { describe, expect, it } from "vitest";
import { areaPath, linePath, niceMax, scaleLinear, timeTicks } from "../src/data/chartScale";

describe("niceMax", () => {
    it("rounds up to a readable number", () => {
        expect(niceMax(7)).toBe(8);
        expect(niceMax(130)).toBe(150);
        expect(niceMax(0.42)).toBeCloseTo(0.5);
        expect(niceMax(1000)).toBe(1000);
    });

    it("gives 1 for anything unusable so the axis never collapses", () => {
        expect(niceMax(0)).toBe(1);
        expect(niceMax(-5)).toBe(1);
        expect(niceMax(NaN)).toBe(1);
    });
});

describe("scaleLinear", () => {
    it("maps the range, including an inverted target", () => {
        const y = scaleLinear(0, 10, 100, 0);
        expect(y(0)).toBe(100);
        expect(y(5)).toBe(50);
        expect(y(10)).toBe(0);
    });

    it("maps a flat range to the start instead of dividing by zero", () => {
        expect(scaleLinear(5, 5, 20, 80)(5)).toBe(20);
    });
});

describe("linePath and areaPath", () => {
    it("draws a gap where a value is missing", () => {
        const path = linePath([{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: null }, { x: 3, y: 4 }]);
        expect(path).toBe("M0.0,1.0L1.0,2.0M3.0,4.0");
    });

    it("closes an area down to the baseline", () => {
        expect(areaPath([{ x: 0, y: 5 }, { x: 10, y: 3 }], 20)).toBe("M0.0,20.0L0.0,5.0L10.0,3.0L10.0,20.0Z");
        expect(areaPath([{ x: 0, y: null }], 20)).toBe("");
    });
});

describe("timeTicks", () => {
    it("spreads evenly and copes with an empty range", () => {
        expect(timeTicks(0, 300, 4)).toEqual([0, 100, 200, 300]);
        expect(timeTicks(5, 5, 4)).toEqual([5]);
    });
});
