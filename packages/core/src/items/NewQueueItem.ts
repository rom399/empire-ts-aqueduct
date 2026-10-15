import { JsonValue } from "./JsonValue";

/**
 * What a producer sends. The queue adds its own fields (see QueueItem), so a
 * producer cannot forge an id, a sequence number or an expiry.
 */
export interface NewQueueItem {
    /** Event or work type, for example `request.completed`. */
    type: string;

    /** Any plain-JSON value, limited in size by the queue's `maxPayloadBytes`. */
    payload: JsonValue;

    /** When the event happened, in epoch milliseconds, by the producer's clock. */
    createdAt: number;

    /** Which app or component sent it. */
    source?: string;

    /** Links related events, for example everything caused by one request. */
    correlationId?: string;

    /** Lets a consumer recognise a retried publish. The broker does not dedupe on it. */
    idempotencyKey?: string;

    /** Lets the payload format evolve. An integer of at least 1. */
    schemaVersion?: number;
}
