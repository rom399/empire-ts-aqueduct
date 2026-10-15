import { EventWriter } from "../../src/db/EventWriter";
import { IncomingItem } from "../../src/db/IncomingItem";
import { TelemetryDatabase } from "../../src/db/TelemetryDatabase";

/** A fixed "now" for tests, so no test depends on the clock. */
export const T0 = 1_800_000_000_000;

export function makeDatabase(): TelemetryDatabase {
    return new TelemetryDatabase(":memory:");
}

let counter = 0;

/** A queue item as the broker would hand it over. */
export function item(type: string, payload: Record<string, unknown>, at: number, extra: Partial<IncomingItem> = {}): IncomingItem {
    counter++;
    return { itemId: `item-${counter}`, sequence: counter, type, payload, createdAt: at, source: "lb-balancer", ...extra };
}

/** Stores one finished request: its dispatch and its completion. */
export function storeRequest(
    writer: EventWriter,
    options: { id: string; backend: string; route?: string; status?: number; durationMs: number; at: number; method?: string; failed?: boolean }
): void {
    const method = options.method ?? "GET";
    const items = [
        item("loadbalancer.dispatched", { requestId: options.id, backendId: options.backend, method, path: options.route ?? "/x", at: options.at - options.durationMs }, options.at - options.durationMs, { correlationId: options.id }),
        options.failed
            ? item("loadbalancer.failed", { requestId: options.id, backendId: options.backend, phase: "response", durationMs: options.durationMs, at: options.at }, options.at, { correlationId: options.id })
            : item("loadbalancer.completed", { requestId: options.id, backendId: options.backend, status: options.status ?? 200, durationMs: options.durationMs, route: options.route, at: options.at }, options.at, { correlationId: options.id }),
    ];

    writer.storeBatch(items);
}
