import { IClock } from "../clock/IClock";
import { IQueueLogger } from "../logging/IQueueLogger";
import { QueueOptions } from "../options/QueueOptions";

/** How to build a registry of named queues. */
export interface QueueRegistryOptions {
    /** The queues to declare, by name. Nothing else can be published to or taken from. */
    queues: Record<string, QueueOptions>;

    /** Parent folder of the per-queue spill folders. Needed by any queue that spills or persists. */
    spillRoot?: string;

    /** How often expired items are removed. Defaults to 30 seconds. */
    sweepIntervalMs?: number;

    /** Where warnings go. Defaults to the console. */
    logger?: IQueueLogger;

    /** The time source. Defaults to the system clock; tests pass a manual one. */
    clock?: IClock;
}
