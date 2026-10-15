import { describe, expect, it } from "vitest";
import { formatAgo, formatBytes, formatClock, formatCount, formatMs, formatPercent, formatRate, formatRetention } from "../src/data/format";

describe("format", () => {
    it("never prints NaN or Infinity", () => {
        for (const bad of [NaN, Infinity, -Infinity, undefined, null]) {
            expect(formatCount(bad)).toBe("–");
            expect(formatMs(bad)).toBe("–");
            expect(formatRate(bad)).toBe("–");
            expect(formatPercent(bad)).toBe("–");
            expect(formatBytes(bad)).toBe("–");
        }
    });

    it("abbreviates large counts", () => {
        expect(formatCount(950)).toBe("950");
        expect(formatCount(12_500)).toBe("12.5k");
        expect(formatCount(2_400_000)).toBe("2.4M");
    });

    it("picks sensible precision for durations", () => {
        expect(formatMs(3.14)).toBe("3.1 ms");
        expect(formatMs(42)).toBe("42 ms");
        expect(formatMs(412.6)).toBe("413 ms");
        expect(formatMs(12_500)).toBe("12.5 s");
    });

    it("formats rates and percentages", () => {
        expect(formatRate(0.5)).toBe("0.50");
        expect(formatRate(12.34)).toBe("12.3");
        expect(formatRate(250)).toBe("250");
        expect(formatPercent(0.0465)).toBe("4.7%");
        expect(formatPercent(0.5)).toBe("50%");
        expect(formatPercent(0)).toBe("0.0%");
    });

    it("formats bytes", () => {
        expect(formatBytes(512)).toBe("512 B");
        expect(formatBytes(4_587_456)).toBe("4.4 MB");
    });

    it("formats relative time against a given now", () => {
        expect(formatAgo(undefined, 1000)).toBe("never");
        expect(formatAgo(10_000, 10_500)).toBe("just now");
        expect(formatAgo(10_000, 40_000)).toBe("30 s ago");
        expect(formatAgo(0, 10 * 60_000)).toBe("10 min ago");
        expect(formatAgo(10_000, 5_000)).toBe("just now");
    });

    it("formats the clock with milliseconds and retention in hours or days", () => {
        expect(formatClock(new Date(2026, 9, 10, 1, 2, 3, 45).getTime())).toBe("01:02:03.045");
        expect(formatRetention(24 * 3_600_000)).toBe("24 h");
        expect(formatRetention(7 * 24 * 3_600_000)).toBe("7 days");
    });
});
