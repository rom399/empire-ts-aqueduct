/** A call to the broker failed. */
export class QueueClientError extends Error {
    /**
     * @param message What went wrong.
     * @param status The HTTP status, or undefined if the broker could not be reached.
     * @param cause The error underneath, if there was one.
     */
    constructor(message: string, readonly status?: number, readonly cause?: unknown) {
        super(message);
        this.name = "QueueClientError";
    }

    /** True for failures that may pass by themselves: no connection, a timeout, 429 or a 5xx. */
    get retryable(): boolean {
        return this.status === undefined || this.status === 429 || this.status >= 500;
    }
}
