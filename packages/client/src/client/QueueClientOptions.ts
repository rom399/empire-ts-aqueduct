/** Where a client connects and how. */
export interface QueueClientOptions {
    /** The broker's pull URL, for example `http://127.0.0.1:7002`. */
    url: string;

    /** The queue to take from. */
    queue: string;

    /** The queue's pull token. */
    token: string;

    /** A fetch implementation. Defaults to the global one; tests pass a fake. */
    fetch?: typeof fetch;

    /** Added to a take's `waitMs` before the request itself is given up on. Defaults to 10 seconds. */
    requestMarginMs?: number;
}
