import { describe, expect, it } from "vitest";
import { evenlySpread, particleBudget } from "../src/data/spawnSampler";

describe("particleBudget", () => {
    it("draws every event when traffic is light", () => {
        expect(particleBudget(5, 10, 100, 40)).toBe(5);
    });

    it("caps one batch", () => {
        expect(particleBudget(500, 0, 1000, 40)).toBe(40);
    });

    it("never lets live particles pass the maximum", () => {
        expect(particleBudget(30, 95, 100, 40)).toBe(5);
        expect(particleBudget(30, 100, 100, 40)).toBe(0);
        expect(particleBudget(30, 150, 100, 40)).toBe(0);
    });

    it("draws nothing for an empty batch", () => {
        expect(particleBudget(0, 0, 100, 40)).toBe(0);
        expect(particleBudget(-3, 0, 100, 40)).toBe(0);
    });
});

describe("evenlySpread", () => {
    it("spreads picks across the whole batch", () => {
        expect(evenlySpread(100, 4)).toEqual([12, 37, 62, 87]);
    });

    it("returns everything when asked for at least as many as exist", () => {
        expect(evenlySpread(3, 5)).toEqual([0, 1, 2]);
    });

    it("returns nothing for nothing", () => {
        expect(evenlySpread(0, 4)).toEqual([]);
        expect(evenlySpread(10, 0)).toEqual([]);
    });
});
