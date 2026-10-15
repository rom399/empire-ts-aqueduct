import { describe, expect, it } from "vitest";
import { withJitter } from "../../../src/consumer/withJitter";

describe("withJitter", () => {
    it("gives half the delay at the low end of the random range", () => {
        expect(withJitter(1000, () => 0)).toBe(500);
    });

    it("gives one and a half times the delay at the high end", () => {
        expect(withJitter(1000, () => 1)).toBe(1500);
    });

    it("gives the delay itself in the middle", () => {
        expect(withJitter(1000, () => 0.5)).toBe(1000);
    });
});
