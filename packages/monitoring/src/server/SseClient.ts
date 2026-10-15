import { ServerResponse } from "node:http";

/**
 * One open dashboard tab. Writes are dropped, not queued, while the tab's
 * connection is backed up: a slow browser must never make the server hold
 * memory. The client is told with a `resync` event once it drains, and reloads
 * from the REST endpoints.
 */
export class SseClient {
    private blocked = false;
    private missed = false;

    constructor(private readonly res: ServerResponse, private readonly resyncPayload: () => unknown) {
        res.on("drain", () => {
            this.blocked = false;

            if (this.missed) {
                this.missed = false;
                this.send("resync", this.resyncPayload());
            }
        });
    }

    send(event: string, data: unknown): void {
        if (this.res.writableEnded || this.res.destroyed) {
            return;
        }

        if (this.blocked) {
            this.missed = true;
            return;
        }

        this.blocked = !this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    end(): void {
        if (!this.res.writableEnded) {
            this.res.end();
        }
    }
}
