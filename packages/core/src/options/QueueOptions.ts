import { OverflowPolicy } from "./OverflowPolicy";
import { SpillFullPolicy } from "./SpillFullPolicy";

/**
 * What a caller may set for one queue. Everything is optional; resolveQueueSettings
 * fills in the defaults and rejects values that cannot work.
 */
export interface QueueOptions {
    /** Items the main queue holds, in-flight items included. */
    maxSize?: number;

    /** What happens when the main queue is full. */
    overflow?: OverflowPolicy | `${OverflowPolicy}`;

    /** Items the in-memory spill buffer holds before it writes a file. `spill` only. */
    spillBufferSize?: number;

    /** Items per spill file. Not more than `maxSize` or `spillBufferSize`. */
    spillBatchSize?: number;

    /** Most spill files kept on disk. `spill` needs this or `maxSpillBytes`. */
    maxSpillFiles?: number;

    /** Most spill bytes kept on disk. Checked before each write, so it can be exceeded by one file. */
    maxSpillBytes?: number;

    /** What happens when the disk cap is reached. */
    spillFull?: SpillFullPolicy | `${SpillFullPolicy}`;

    /** How long an item may wait before it expires, in milliseconds. Unset means never. */
    messageTtlMs?: number;

    /** How long a consumer has to acknowledge a batch before it returns to the queue. */
    receiptTimeoutMs?: number;

    /** The longest a take may wait for an item to arrive. */
    maxWaitMs?: number;

    /** The largest serialised payload accepted. */
    maxPayloadBytes?: number;

    /** The most items in one batch publish. */
    maxPublishBatch?: number;

    /** The most payload bytes in one batch publish. */
    maxPublishBytes?: number;

    /** The most items one take may request. */
    maxTakeSize?: number;

    /** Save the queue when it shuts down and restore it at startup. Needs a spill root. */
    persist?: boolean;
}
