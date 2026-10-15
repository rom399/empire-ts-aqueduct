/** Waits `ms`, or less if `signal` aborts. Never rejects. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
        if (signal.aborted) {
            resolve();
            return;
        }

        const finish = (): void => {
            clearTimeout(timer);
            signal.removeEventListener("abort", finish);
            resolve();
        };

        const timer = setTimeout(finish, ms);

        signal.addEventListener("abort", finish, { once: true });
    });
}
