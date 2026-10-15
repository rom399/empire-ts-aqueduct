/** Keys allowed at the top of a config file. A typo here would otherwise be silently ignored. */
export const TOP_LEVEL_KEYS = new Set([
    "host",
    "publishPort",
    "pullPort",
    "adminToken",
    "spillRoot",
    "sweepIntervalMs",
    "shutdownTimeoutMs",
    "queues",
]);

/** Keys allowed inside one queue. A misspelt `messageTtl` would otherwise quietly leave items that never expire. */
export const QUEUE_KEYS = new Set([
    "publishToken",
    "pullToken",
    "maxSize",
    "overflow",
    "spillBufferSize",
    "spillBatchSize",
    "maxSpillFiles",
    "maxSpillBytes",
    "spillFull",
    "messageTtlMs",
    "receiptTimeoutMs",
    "maxWaitMs",
    "maxPayloadBytes",
    "maxPublishBatch",
    "maxPublishBytes",
    "maxTakeSize",
    "persist",
]);
