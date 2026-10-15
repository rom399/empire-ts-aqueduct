import { Queue } from "../../../src/queue/Queue";
import { QueueOptions } from "../../../src/options/QueueOptions";
import { resolveQueueSettings } from "../../../src/options/resolveQueueSettings";
import { SpillStore } from "../../../src/spill/SpillStore";
import { ManualClock } from "../clock/ManualClock";
import { TestQueueLogger } from "../logging/TestQueueLogger";

export interface TestQueue {
    queue: Queue;
    clock: ManualClock;
    logger: TestQueueLogger;
    store?: SpillStore;
}

/**
 * A queue wired to a manual clock and a recording logger. Pass `spillRoot` for a
 * queue that spills or persists; it is given a spill store in that folder.
 */
export function createTestQueue(options: QueueOptions = {}, spillRoot?: string, name: string = "test"): TestQueue {
    const clock = new ManualClock();
    const logger = new TestQueueLogger();
    const settings = resolveQueueSettings(name, options, spillRoot);
    const store = settings.spillDirectory ? new SpillStore(settings.spillDirectory, logger) : undefined;
    const queue = new Queue(settings, { clock, logger, spillStore: store });

    return { queue, clock, logger, store };
}

/** Builds a second queue over the same folder, as a restart would. */
export function restartTestQueue(options: QueueOptions, spillRoot: string, name: string = "test"): TestQueue {
    const restarted = createTestQueue(options, spillRoot, name);

    restarted.queue.restore();

    return restarted;
}
