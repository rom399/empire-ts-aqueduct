import { IClockTimer } from "./IClockTimer";

/**
 * The queue's only view of time. Receipt timeouts, expiry and long-poll waits
 * all go through it, so tests can move time forward without waiting.
 */
export interface IClock {
    /** The current time in epoch milliseconds. */
    now(): number;

    /** Calls `callback` once after `delayMs`. */
    setTimeout(callback: () => void, delayMs: number): IClockTimer;
}
