/** What a queue does with a new item when it is full. */
export enum OverflowPolicy {
    /** Remove the oldest waiting item to make room. Good for telemetry, where recent data matters most. */
    DropOldest = "drop-oldest",

    /** Refuse the new item and let the producer decide. Good for queues where every item matters. */
    Reject = "reject",

    /** Move overflow into an in-memory buffer and then to files on disk. */
    Spill = "spill",
}
