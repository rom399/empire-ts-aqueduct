import net from "node:net";

const LOOPBACK = "127.0.0.1";

/** Asks the OS for a port nothing is listening on right now. */
export function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();

        probe.once("error", reject);
        probe.listen(0, LOOPBACK, () => {
            const address = probe.address();
            const port = typeof address === "object" && address ? address.port : 0;

            probe.close(() => resolve(port));
        });
    });
}
