import { IClock } from "../clock/IClock";

/**
 * Lets a warning through at most once per interval for each kind. A queue that
 * drops or rejects thousands of items a second must not log thousands of lines.
 */
export class WarningThrottle {
    private readonly lastLoggedAt = new Map<string, number>();

    constructor(
        private readonly clock: IClock,
        private readonly intervalMs: number
    ) {}

    /** True if a warning of this kind may be logged now. Calling it counts as logging. */
    allow(kind: string): boolean {
        const now = this.clock.now();
        const last = this.lastLoggedAt.get(kind);

        if (last !== undefined && now - last < this.intervalMs) {
            return false;
        }

        this.lastLoggedAt.set(kind, now);

        return true;
    }
}
