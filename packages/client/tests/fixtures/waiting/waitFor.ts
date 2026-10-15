/** Polls until `condition` is true, failing the test if it takes too long. */
export async function waitFor(condition: () => boolean, timeoutMs: number = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error("Timed out waiting for a condition.");
        }

        await new Promise((resolve) => setTimeout(resolve, 1));
    }
}
