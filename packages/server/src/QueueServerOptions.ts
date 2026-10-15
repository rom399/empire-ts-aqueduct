import { ILogger } from "empire-ts";
import { QueueServerQueueOptions } from "./QueueServerQueueOptions";

/** Everything a broker needs. */
export interface QueueServerOptions {
    /** Address to listen on. Defaults to `127.0.0.1`. Tokens travel in the clear, so put TLS in front before listening more widely. */
    host?: string;

    /** The port producers publish to. */
    publishPort: number;

    /** The port consumers pull from, and where admin operations live. Must differ from `publishPort`. */
    pullPort: number;

    /** The queues, by name. Nothing else can be published to or taken from. */
    queues: Record<string, QueueServerQueueOptions>;

    /**
     * Enables peek, purge and stats on the pull port, for whoever holds it. Without
     * it those routes do not exist. Must differ from every queue's tokens.
     */
    adminToken?: string;

    /** Parent folder of the per-queue spill folders. Needed by any queue that spills or persists. */
    spillRoot?: string;

    /** How often expired items are removed. Defaults to 30 seconds. */
    sweepIntervalMs?: number;

    /** How long a stopping port waits for requests in flight. Defaults to 5 seconds. */
    shutdownTimeoutMs?: number;

    /** Where the broker and Empire log. Defaults to Empire's console logger. */
    logger?: ILogger;
}
