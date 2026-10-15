/** A queue item on its way into the database. Structurally the same as the client's ConsumedQueueItem, so the writer needs no queue package. */
export interface IncomingItem {
    itemId: string;
    sequence?: number;
    type: string;
    payload: unknown;
    createdAt: number;
    enqueuedAt?: number;
    source?: string;
    correlationId?: string;
}
