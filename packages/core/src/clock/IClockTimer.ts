/** A pending timeout that can be cancelled. */
export interface IClockTimer {
    cancel(): void;
}
