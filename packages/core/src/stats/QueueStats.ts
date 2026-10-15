/** A snapshot of one queue's counters. */
export interface QueueStats {
    name: string;

    /** Items waiting in the main queue, where consumers take from. */
    depth: number;

    /** Items handed to consumers and not yet acknowledged. */
    inFlight: number;

    /** Items waiting in the in-memory spill buffer. */
    buffered: number;

    /** Spill files on disk. */
    spilledFiles: number;

    /** Items in those files. */
    spilledItems: number;

    /** Everything still waiting, across all three tiers. */
    totalWaiting: number;

    /** Consumers currently waiting on a long-poll take. */
    waitingConsumers: number;

    published: number;
    taken: number;
    acknowledged: number;
    redelivered: number;
    dropped: number;
    rejected: number;
    expired: number;
    purged: number;

    /** The most items the queue has held at once, across all tiers and in flight. */
    highWaterMark: number;

    maxSize: number;
    closed: boolean;
}
