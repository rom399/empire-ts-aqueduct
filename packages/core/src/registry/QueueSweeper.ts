import { IClock } from "../clock/IClock";
import { IClockTimer } from "../clock/IClockTimer";
import { Queue } from "../queue/Queue";

/**
 * One timer for every queue. Ten queues need one sweeper, not ten, and the
 * sweep itself is cheap because expired items are always at the front.
 */
export class QueueSweeper {
    private timer?: IClockTimer;
    private running = false;

    constructor(
        private readonly queues: () => Iterable<Queue>,
        private readonly intervalMs: number,
        private readonly clock: IClock
    ) {}

    start(): void {
        if (this.running) {
            return;
        }

        this.running = true;
        this.schedule();
    }

    stop(): void {
        this.running = false;
        this.timer?.cancel();
        this.timer = undefined;
    }

    private schedule(): void {
        this.timer = this.clock.setTimeout(() => {
            for (const queue of this.queues()) {
                queue.sweep();
            }

            if (this.running) {
                this.schedule();
            }
        }, this.intervalMs);
    }
}
