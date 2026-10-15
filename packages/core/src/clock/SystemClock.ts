import { IClock } from "./IClock";
import { IClockTimer } from "./IClockTimer";

/**
 * The real clock. Its timers are unref'd so a pending receipt timeout never
 * keeps a process alive; the broker's listening sockets do that.
 */
export class SystemClock implements IClock {
    now(): number {
        return Date.now();
    }

    setTimeout(callback: () => void, delayMs: number): IClockTimer {
        const handle = setTimeout(callback, delayMs);

        handle.unref();

        return { cancel: () => clearTimeout(handle) };
    }
}
