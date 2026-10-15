import { OverflowPolicy } from "./OverflowPolicy";
import { SpillFullPolicy } from "./SpillFullPolicy";

/** One queue's settings with every default applied. See QueueOptions for what each means. */
export interface QueueSettings {
    name: string;
    maxSize: number;
    overflow: OverflowPolicy;
    spillBufferSize: number;
    spillBatchSize: number;
    maxSpillFiles?: number;
    maxSpillBytes?: number;
    spillFull: SpillFullPolicy;
    messageTtlMs?: number;
    receiptTimeoutMs: number;
    maxWaitMs: number;
    maxPayloadBytes: number;
    maxPublishBatch: number;
    maxPublishBytes: number;
    maxTakeSize: number;
    persist: boolean;

    /** This queue's folder under the spill root. Set when the queue spills or persists. */
    spillDirectory?: string;
}
