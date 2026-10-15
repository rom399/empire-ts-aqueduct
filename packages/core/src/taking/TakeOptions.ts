/** How a consumer takes items. */
export interface TakeOptions {
    /**
     * When the queue is empty, wait up to this long for the first item instead
     * of returning at once. Capped by the queue's `maxWaitMs`. 0 or unset means
     * do not wait.
     */
    waitMs?: number;

    /** Cancels a wait early, for example when the consumer's connection closes. */
    signal?: AbortSignal;
}
