import { IClock } from "../clock/IClock";
import { IQueueLogger } from "../logging/IQueueLogger";
import { SpillStore } from "../spill/SpillStore";

/** What a Queue needs from outside itself. */
export interface QueueDependencies {
    clock: IClock;
    logger: IQueueLogger;

    /** Present when the queue spills or persists. */
    spillStore?: SpillStore;
}
