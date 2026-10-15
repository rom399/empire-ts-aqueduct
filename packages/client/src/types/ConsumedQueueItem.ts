import { JsonValue } from "./JsonValue";

/** An item as the broker delivers it. */
export interface ConsumedQueueItem {
    /** Unique id assigned by the broker. Dedupe on it. */
    itemId: string;

    /** Increases by one for every item the queue accepts. Sort on it. */
    sequence: number;

    /** What the producer called it, for example `request.completed`. */
    type: string;

    payload: JsonValue;

    /** When the event happened, by the producer's clock, in epoch milliseconds. */
    createdAt: number;

    /** When the broker accepted it, in epoch milliseconds. */
    enqueuedAt: number;

    /** When it expires, if the queue has a TTL. */
    expiresAt?: number;

    source?: string;
    correlationId?: string;
    idempotencyKey?: string;
    schemaVersion?: number;

    /** 1 the first time the item is handed out, higher if it came back after a missed acknowledgement. */
    deliveryCount: number;
}
