/** What a consumer has done since it was created. */
export interface QueueConsumerStats {
    /** Batches the broker handed over. */
    batchesTaken: number;

    /** Items in those batches. */
    itemsReceived: number;

    /** Items the handler finished without throwing. */
    itemsProcessed: number;

    /** Items whose handler threw. They are not retried. */
    handlerErrors: number;

    /** Items skipped because dedupe had seen their `itemId`. */
    duplicatesSkipped: number;

    /** Batches skipped because the broker said the acknowledgement came too late and had already re-queued them. */
    batchesSkipped: number;

    /** Takes that failed. */
    takeErrors: number;

    /** Acknowledgements that failed with an unknown outcome. The batch was processed anyway. */
    ackErrors: number;
}
