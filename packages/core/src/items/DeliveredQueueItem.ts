import { QueueItem } from "./QueueItem";

/** An item as a consumer receives it from a take. */
export interface DeliveredQueueItem extends QueueItem {
    /** 1 the first time the item is handed out, higher after a receipt timeout returned it. */
    deliveryCount: number;
}
