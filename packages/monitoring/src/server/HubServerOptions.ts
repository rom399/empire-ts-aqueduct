import { ILogger } from "empire-ts";

export interface HubServerOptions {
    /** The database file the processor writes. */
    dbPath: string;

    /** Default 127.0.0.1. There is no login: do not expose this beyond your own machine without a proxy in front. */
    host?: string;

    /** Default 7130. */
    port: number;

    /** The built dashboard (web/dist). If it is missing the API still works. */
    webRoot?: string;

    /** Shown by /api/db. Must match the processor's retention. Default 24 hours. */
    retentionMs?: number;

    logger?: ILogger;

    /** How often the live stream looks for new events, in milliseconds. Default 250. */
    livePollMs?: number;
}
