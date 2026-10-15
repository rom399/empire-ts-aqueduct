import { NewQueueItem } from "./NewQueueItem";

/**
 * An item as the queue stores it, delivers it and writes it to disk. Delivery
 * state (batch id, delivery count) is deliberately not part of it, so a stored
 * item never changes.
 */
export interface QueueItem extends NewQueueItem {
    /** Unique id assigned by the queue. Consumers can dedupe on it. */
    itemId: string;

    /** Increases by one for every item a queue accepts. Consumers can sort on it. */
    sequence: number;

    /** When the queue accepted the item, in epoch milliseconds, by the broker's clock. */
    enqueuedAt: number;

    /** `enqueuedAt` plus the queue's TTL. Absent when the queue has no TTL. */
    expiresAt?: number;
}
