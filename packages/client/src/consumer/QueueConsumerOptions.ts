import { QueueClientOptions } from "../client/QueueClientOptions";
import { ConsumedQueueItem } from "../types/ConsumedQueueItem";

/** What a consumer needs: where to connect, how to take, and what to do with each item. */
export interface QueueConsumerOptions extends QueueClientOptions {
    /**
     * Called for each item, after its batch was acknowledged. The broker will not
     * retry it: if the handler throws, `onError` hears about it and the item is gone.
     */
    handler: (item: ConsumedQueueItem) => void | Promise<void>;

    /** Most items to take per call. The broker has its own cap. Default 10. */
    batchSize?: number;

    /** Items processed at the same time. Default 1. */
    concurrency?: number;

    /** Long-poll wait when the queue is empty, in milliseconds. 0 turns long-polling off. Default 20 seconds. */
    waitMs?: number;

    /** Pause between polls when `waitMs` is 0. Default 1 second. */
    pollIntervalMs?: number;

    /** First pause after a failed take; it doubles up to `maxBackoffMs`, with jitter. Default 1 second. */
    initialBackoffMs?: number;

    /** Longest pause after repeated failures. Default 30 seconds. */
    maxBackoffMs?: number;

    /**
     * Skip items whose `itemId` was already seen. Off by default, because the
     * broker leaves deduplication to the consumer. `true` remembers the last
     * 10,000 ids; pass `{ windowSize }` to change that.
     */
    dedupe?: boolean | { windowSize: number };

    /** Sort each batch by `sequence` before processing. Off by default. */
    sortBySequence?: boolean;

    /** Told about every failure: broker errors, acknowledgement errors and handler errors. Defaults to `console.error`. */
    onError?: (error: unknown, item?: ConsumedQueueItem) => void;

    /** Replaces the pause between polls and retries. Meant for tests. */
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}
