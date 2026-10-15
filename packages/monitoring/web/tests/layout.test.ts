import { describe, expect, it } from "vitest";
import {
    arcPoint, leaseRemaining, nodeScale, outcomeKind, queueFill, queueFillHeight, queueSeverity, QUEUE_HEIGHT, ringPosition, stalkHeight,
} from "../src/scene/layout";

describe("ringPosition", () => {
    it("puts backends evenly on a circle", () => {
        const a = ringPosition(0, 4, 10);
        const b = ringPosition(2, 4, 10);
        expect(Math.hypot(a.x, a.z)).toBeCloseTo(10);
        expect(a.x + b.x).toBeCloseTo(0);
        expect(a.z + b.z).toBeCloseTo(0);
    });

    it("does not blow up for an empty ring", () => {
        expect(Number.isFinite(ringPosition(0, 0).x)).toBe(true);
    });
});

describe("queue vessel", () => {
    it("fills in proportion and clamps", () => {
        expect(queueFill(50, 100)).toBe(0.5);
        expect(queueFill(500, 100)).toBe(1);
        expect(queueFill(-1, 100)).toBe(0);
        expect(queueFill(5, 0)).toBe(0);
        expect(queueFill(NaN, 10)).toBe(0);
    });

    it("never shows a queue with items as empty, and a full one at the top", () => {
        expect(queueFillHeight(0, 1000)).toBe(0);
        expect(queueFillHeight(1, 1_000_000)).toBeCloseTo(0.12);
        expect(queueFillHeight(1000, 1000)).toBe(QUEUE_HEIGHT);
    });

    it("warns as it fills up", () => {
        expect(queueSeverity(0.3)).toBe("ok");
        expect(queueSeverity(0.6)).toBe("warn");
        expect(queueSeverity(0.9)).toBe("bad");
    });
});

describe("nodes and routes", () => {
    it("grows busy nodes within limits", () => {
        expect(nodeScale(0)).toBeCloseTo(0.85);
        expect(nodeScale(1000)).toBeCloseTo(1.95);
        expect(nodeScale(NaN)).toBeCloseTo(0.85);
    });

    it("scales stalks by p95 and bounds them", () => {
        expect(stalkHeight(300)).toBe(3);
        expect(stalkHeight(100_000)).toBe(6);
        expect(stalkHeight(0)).toBe(0.15);
        expect(stalkHeight(NaN)).toBe(0.15);
    });

    it("reports the share of a lease left", () => {
        expect(leaseRemaining(6000, 1000, 5000)).toBe(1);
        expect(leaseRemaining(3500, 1000, 5000)).toBeCloseTo(0.5);
        expect(leaseRemaining(500, 1000, 5000)).toBe(0);
        expect(leaseRemaining(null, 1000)).toBe(0);
    });

    it("classifies how a request ended", () => {
        expect(outcomeKind(200, false)).toBe("ok");
        expect(outcomeKind(302, false)).toBe("info");
        expect(outcomeKind(404, false)).toBe("warn");
        expect(outcomeKind(503, false)).toBe("bad");
        expect(outcomeKind(undefined, true)).toBe("bad");
        expect(outcomeKind(undefined, false)).toBe("ok");
    });
});

describe("arcPoint", () => {
    it("starts and ends on the endpoints and bulges in the middle", () => {
        const a = { x: 0, y: 0, z: 0 };
        const b = { x: 10, y: 0, z: 0 };
        expect(arcPoint(a, b, 2, 0)).toEqual({ x: 0, y: 0, z: 0 });
        expect(arcPoint(a, b, 2, 1).x).toBe(10);
        expect(arcPoint(a, b, 2, 0.5).y).toBeCloseTo(2);
        expect(arcPoint(a, b, 2, 7).x).toBe(10);
    });
});
