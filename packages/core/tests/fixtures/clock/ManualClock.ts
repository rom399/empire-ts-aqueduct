import { IClock } from "../../../src/clock/IClock";
import { IClockTimer } from "../../../src/clock/IClockTimer";

interface PendingTimer {
    dueAt: number;
    callback: () => void;
}

/** An arbitrary start, far from zero so a bug that treats 0 as "unset" shows up. */
const START_TIME = 1_800_000_000_000;

/**
 * A clock that only moves when the test says so. Timers fire in order as time
 * is advanced, so a two-hour TTL or a ten-second receipt timeout takes no
 * real time.
 */
export class ManualClock implements IClock {
    private current = START_TIME;
    private timers: PendingTimer[] = [];

    now(): number {
        return this.current;
    }

    setTimeout(callback: () => void, delayMs: number): IClockTimer {
        const timer: PendingTimer = { dueAt: this.current + delayMs, callback };

        this.timers.push(timer);

        return {
            cancel: () => {
                this.timers = this.timers.filter((pending) => pending !== timer);
            },
        };
    }

    /** Moves time forward, running every timer that falls due on the way. */
    advance(ms: number): void {
        const target = this.current + ms;

        for (;;) {
            const next = this.timers
                .filter((timer) => timer.dueAt <= target)
                .sort((a, b) => a.dueAt - b.dueAt)[0];

            if (!next) {
                break;
            }

            this.timers = this.timers.filter((timer) => timer !== next);
            this.current = Math.max(this.current, next.dueAt);
            next.callback();
        }

        this.current = target;
    }

    /** How many timers are waiting to fire. */
    get pendingTimers(): number {
        return this.timers.length;
    }
}
