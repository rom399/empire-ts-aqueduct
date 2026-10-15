/** Items taken per call. */
export const DEFAULT_BATCH_SIZE = 10;

/** Items processed at the same time. */
export const DEFAULT_CONCURRENCY = 1;

/** How long a take waits for the first item when the queue is empty. Under the broker's 30 second cap. */
export const DEFAULT_WAIT_MS = 20_000;

/** Pause between polls when long-polling is off, and after an empty answer that came back too fast. */
export const DEFAULT_POLL_INTERVAL_MS = 1_000;

/** First pause after a failed take. */
export const DEFAULT_INITIAL_BACKOFF_MS = 1_000;

/** The pause after repeated failures never grows past this. */
export const DEFAULT_MAX_BACKOFF_MS = 30_000;

/** Items remembered for deduplication when it is switched on without a size. */
export const DEFAULT_DEDUPE_WINDOW_SIZE = 10_000;
