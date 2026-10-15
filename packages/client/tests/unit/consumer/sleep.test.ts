import { describe, expect, it } from "vitest";
import { sleep } from "../../../src/consumer/sleep";

describe("sleep", () => {
    it("resolves after the delay", async () => {
        const startedAt = Date.now();

        await sleep(20, new AbortController().signal);

        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);
    });

    it("resolves early when the signal aborts", async () => {
        const controller = new AbortController();
        const startedAt = Date.now();
        const sleeping = sleep(10_000, controller.signal);

        controller.abort();
        await sleeping;

        expect(Date.now() - startedAt).toBeLessThan(1000);
    });

    it("resolves at once when the signal is already aborted", async () => {
        const controller = new AbortController();

        controller.abort();

        await sleep(10_000, controller.signal);
    });
});
