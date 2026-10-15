import { IClock } from "../clock/IClock";
import { IClockTimer } from "../clock/IClockTimer";

interface LongPollWaiter<T> {
    maxItems: number;
    resolve: (result: T | null) => void;
    timer: IClockTimer;
    detach: () => void;
}

/**
 * Consumers waiting for an item on an empty queue, in the order they arrived.
 * When items turn up, the longest-waiting consumer is served first.
 *
 * Every wait ends in one of four ways, and all four remove the waiter: it is
 * served, it times out, its signal aborts, or the queue releases everyone at
 * shutdown. A waiter is never left behind.
 */
export class LongPollQueue<T> {
    private waiters: LongPollWaiter<T>[] = [];

    constructor(private readonly clock: IClock) {}

    get length(): number {
        return this.waiters.length;
    }

    /** Waits for `serve` to produce a result, up to `timeoutMs`. Resolves null on timeout or abort. */
    wait(maxItems: number, timeoutMs: number, signal?: AbortSignal): Promise<T | null> {
        return new Promise<T | null>((resolve) => {
            const finish = (result: T | null): void => {
                this.remove(waiter);
                waiter.timer.cancel();
                waiter.detach();
                resolve(result);
            };

            const onAbort = (): void => finish(null);

            const waiter: LongPollWaiter<T> = {
                maxItems,
                resolve: finish,
                timer: this.clock.setTimeout(() => finish(null), timeoutMs),
                detach: () => signal?.removeEventListener("abort", onAbort),
            };

            if (signal?.aborted) {
                waiter.timer.cancel();
                resolve(null);
                return;
            }

            signal?.addEventListener("abort", onAbort, { once: true });
            this.waiters.push(waiter);
        });
    }

    /**
     * Offers items to the waiters, longest-waiting first. `produce` is called
     * with how many items the waiter asked for and returns a result, or null
     * when nothing is available, which stops the pass.
     */
    serve(produce: (maxItems: number) => T | null): void {
        while (this.waiters.length > 0) {
            const waiter = this.waiters[0];
            const result = produce(waiter.maxItems);

            if (result === null) {
                return;
            }

            waiter.resolve(result);
        }
    }

    /** Ends every wait with null. Used at shutdown. */
    releaseAll(): void {
        // Resolving a waiter removes it from the list, so keep taking the first until none are left.
        while (this.waiters.length > 0) {
            this.waiters[0].resolve(null);
        }
    }

    private remove(waiter: LongPollWaiter<T>): void {
        const index = this.waiters.indexOf(waiter);

        if (index >= 0) {
            this.waiters.splice(index, 1);
        }
    }
}
