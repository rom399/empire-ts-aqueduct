/** Items in the main queue. */
export const DEFAULT_MAX_SIZE = 10_000;

/** Items in the spill buffer. */
export const DEFAULT_SPILL_BUFFER_SIZE = 10_000;

/** Items per spill file. */
export const DEFAULT_SPILL_BATCH_SIZE = 2_000;

/** Time a consumer has to acknowledge a batch. */
export const DEFAULT_RECEIPT_TIMEOUT_MS = 10_000;

/** Cap on a long-poll wait. Short enough to stay below typical proxy timeouts. */
export const DEFAULT_MAX_WAIT_MS = 30_000;

/** Largest serialised payload. */
export const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;

/** Items in one batch publish. */
export const DEFAULT_MAX_PUBLISH_BATCH = 500;

/** Payload bytes in one batch publish. */
export const DEFAULT_MAX_PUBLISH_BYTES = 1024 * 1024;

/** Items one take may request. */
export const DEFAULT_MAX_TAKE_SIZE = 100;

/** How often the shared sweeper removes expired items. */
export const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

/** Occupancy at which a queue first warns that it is filling up. */
export const NEAR_FULL_RATIO = 0.8;

/** Least time between two warnings of the same kind from one queue. */
export const WARNING_INTERVAL_MS = 60_000;
