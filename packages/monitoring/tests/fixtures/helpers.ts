import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** A fresh folder removed by the returned function. */
export function makeTempDir(): { dir: string; remove: () => void } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-test-"));
    return { dir, remove: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** A port nothing is listening on right now. */
export function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address() as net.AddressInfo;
            server.close(() => resolve(port));
        });
    });
}

/** Polls until `check` returns something truthy, or fails after `timeoutMs`. */
export async function waitFor<T>(check: () => T | undefined | false, timeoutMs: number = 4000): Promise<T> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
        const value = check();

        if (value) {
            return value;
        }

        if (Date.now() > deadline) {
            throw new Error("Timed out waiting for the condition.");
        }

        await new Promise((resolve) => setTimeout(resolve, 15));
    }
}
