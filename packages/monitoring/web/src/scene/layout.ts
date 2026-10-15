/** Pure geometry and mapping rules for the scene, kept free of three.js so they can be tested. */

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export const HUB_POSITION: Vec3 = { x: 0, y: 1.1, z: 0 };
export const QUEUE_POSITION: Vec3 = { x: -7, y: 0, z: 14 };
export const PROCESSOR_POSITION: Vec3 = { x: 0, y: 1.4, z: 14 };
export const DATABASE_POSITION: Vec3 = { x: 7, y: 0, z: 14 };
export const OVERVIEW_TARGET: Vec3 = { x: 0, y: 0, z: 6.5 };
export const RING_RADIUS = 6.5;
export const QUEUE_HEIGHT = 4;

/** Where backend `index` of `count` sits on the ring around the hub. */
export function ringPosition(index: number, count: number, radius: number = RING_RADIUS): Vec3 {
    const angle = count <= 0 ? 0 : (index / count) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(angle) * radius, y: 0.6, z: Math.sin(angle) * radius };
}

/** 0..1 how full the queue is. A queue with no known capacity reads as empty. */
export function queueFill(depth: number, maxSize: number): number {
    if (!Number.isFinite(depth) || !Number.isFinite(maxSize) || maxSize <= 0) {
        return 0;
    }

    return Math.min(1, Math.max(0, depth / maxSize));
}

/** The fill's visible height: a queue with anything in it never looks empty. */
export function queueFillHeight(depth: number, maxSize: number): number {
    const fill = queueFill(depth, maxSize);
    return fill === 0 ? 0 : Math.max(0.12, fill * QUEUE_HEIGHT);
}

export type Severity = "ok" | "warn" | "bad";

/** Colour band for the queue vessel: calm, filling up, nearly full. */
export function queueSeverity(fill: number): Severity {
    if (fill >= 0.85) {
        return "bad";
    }

    return fill >= 0.6 ? "warn" : "ok";
}

/** Node size from load: a busy backend is bigger, within limits. */
export function nodeScale(requestsPerSecond: number): number {
    const load = Number.isFinite(requestsPerSecond) ? Math.max(0, requestsPerSecond) : 0;
    return 0.85 + Math.min(1.1, load * 0.22);
}

/** 0 (just renewed) .. 1 (about to expire) is not needed; this is the share of the lease left, 0..1. */
export function leaseRemaining(leaseExpiresAt: number | null, now: number, ttlMs: number = 5000): number {
    if (leaseExpiresAt === null) {
        return 0;
    }

    return Math.min(1, Math.max(0, (leaseExpiresAt - now) / ttlMs));
}

/** The status class colour key for a finished request. */
export function outcomeKind(status: number | undefined, failed: boolean): "ok" | "info" | "warn" | "bad" {
    if (failed || (status !== undefined && status >= 500)) {
        return "bad";
    }

    if (status !== undefined && status >= 400) {
        return "warn";
    }

    return status !== undefined && status >= 300 ? "info" : "ok";
}

/** Height of a route's stalk: its p95 latency, scaled and bounded so one slow route does not leave the screen. */
export function stalkHeight(p95Ms: number): number {
    if (!Number.isFinite(p95Ms) || p95Ms <= 0) {
        return 0.15;
    }

    return Math.min(6, Math.max(0.15, p95Ms / 100));
}

/** Position on a curved path from a to b, bulging upward by `arc` at the middle. t in 0..1. */
export function arcPoint(a: Vec3, b: Vec3, arc: number, t: number): Vec3 {
    const u = Math.min(1, Math.max(0, t));
    return {
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u + Math.sin(u * Math.PI) * arc,
        z: a.z + (b.z - a.z) * u,
    };
}

export function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
