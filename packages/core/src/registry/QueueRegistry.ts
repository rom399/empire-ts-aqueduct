import { IClock } from "../clock/IClock";
import { SystemClock } from "../clock/SystemClock";
import { ConsoleQueueLogger } from "../logging/ConsoleQueueLogger";
import { IQueueLogger } from "../logging/IQueueLogger";
import { DEFAULT_SWEEP_INTERVAL_MS } from "../options/queueDefaults";
import { OverflowPolicy } from "../options/OverflowPolicy";
import { QueueSettings } from "../options/QueueSettings";
import { resolveQueueSettings } from "../options/resolveQueueSettings";
import { Queue } from "../queue/Queue";
import { SpillStore } from "../spill/SpillStore";
import { QueueRegistryOptions } from "./QueueRegistryOptions";
import { QueueSweeper } from "./QueueSweeper";
import { UnknownQueueError } from "./UnknownQueueError";

/**
 * The named queues of one broker. Every queue has its own tiers, spill folder,
 * sequence counter and settings, so a flood on one cannot squeeze out another.
 *
 * It has a `dispose()` method, so Empire's DI container can shut it down with
 * the app.
 */
export class QueueRegistry {
    private readonly queues = new Map<string, Queue>();
    private readonly settings = new Map<string, QueueSettings>();
    private readonly logger: IQueueLogger;
    private readonly sweeper: QueueSweeper;
    private started = false;

    /** Builds every queue. Throws QueueConfigurationError for a setting that cannot work. */
    constructor(options: QueueRegistryOptions) {
        this.logger = options.logger ?? new ConsoleQueueLogger();

        const clock: IClock = options.clock ?? new SystemClock();

        for (const [name, queueOptions] of Object.entries(options.queues)) {
            const settings = resolveQueueSettings(name, queueOptions, options.spillRoot);
            const spillStore = settings.spillDirectory ? new SpillStore(settings.spillDirectory, this.logger) : undefined;

            this.settings.set(name, settings);
            this.queues.set(name, new Queue(settings, { clock, logger: this.logger, spillStore }));
        }

        this.sweeper = new QueueSweeper(() => this.queues.values(), options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS, clock);
    }

    /** The names of the declared queues, in declaration order. */
    names(): string[] {
        return [...this.queues.keys()];
    }

    /** The queue called `name`, or undefined. */
    find(name: string): Queue | undefined {
        return this.queues.get(name);
    }

    /** The queue called `name`. Throws UnknownQueueError if it was not declared. */
    get(name: string): Queue {
        const queue = this.queues.get(name);

        if (!queue) {
            throw new UnknownQueueError(name);
        }

        return queue;
    }

    /**
     * Restores saved items and starts the sweeper. Call it before opening any
     * port, so nothing is published into a queue that is about to be restored.
     */
    start(): void {
        if (this.started) {
            return;
        }

        this.started = true;

        for (const queue of this.queues.values()) {
            queue.restore();
        }

        this.logWorstCase();
        this.sweeper.start();
    }

    /** Stops the sweeper and shuts every queue down, saving those that persist. */
    dispose(): void {
        this.sweeper.stop();

        for (const queue of this.queues.values()) {
            queue.shutdown();
        }
    }

    /** Ten queues at the defaults is ten times the worst-case memory, so say what the total could be. */
    private logWorstCase(): void {
        let memoryItems = 0;
        let spillFiles = 0;

        for (const settings of this.settings.values()) {
            memoryItems += settings.maxSize;

            if (settings.overflow === OverflowPolicy.Spill) {
                memoryItems += settings.spillBufferSize + settings.spillBatchSize;
                spillFiles += settings.maxSpillFiles ?? 0;
            }
        }

        this.logger.info(
            `${this.queues.size} queue(s) declared. Worst case: ${memoryItems} items in memory`
            + (spillFiles > 0 ? `, up to ${spillFiles} spill files on disk (plus any byte caps).` : ".")
        );
    }
}
