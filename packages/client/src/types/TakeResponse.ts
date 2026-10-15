import { ConsumedQueueItem } from "./ConsumedQueueItem";

/** What the broker answers to a take. */
export interface TakeResponse {
    /** Acknowledge receipt with this. `null` when `items` is empty. */
    batchId: string | null;

    count: number;

    /** True when nothing more is waiting in the queue. */
    drained: boolean;

    items: ConsumedQueueItem[];
}
