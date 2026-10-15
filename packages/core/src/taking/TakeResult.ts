import { DeliveredQueueItem } from "../items/DeliveredQueueItem";

/** The answer to a take. */
export interface TakeResult {
    /** Send this back to acknowledge receipt. `null` when no items were returned. */
    batchId: string | null;

    /** How many items are in `items`. */
    count: number;

    /** True when nothing more is waiting in the queue. */
    drained: boolean;

    items: DeliveredQueueItem[];
}
