import { ILogger } from "empire-ts";

/** Everything the processor needs to find the broker and the database. */
export interface TelemetryProcessorOptions {
    /** Where the database file lives. */
    dbPath: string;

    /** The broker's pull URL, for example "http://127.0.0.1:7122". */
    brokerPullUrl: string;

    /** The queue to drain. */
    queue: string;

    /** That queue's pull token. */
    pullToken: string;

    /** The broker's admin token. Without it the queue is still drained but never sampled. */
    adminToken?: string;

    logger?: ILogger;

    /** Items taken per call. Default 200. The broker caps it (100 by default). */
    batchSize?: number;

    /** Long-poll wait when the queue is empty, in milliseconds. Default 5000. */
    waitMs?: number;

    /** How often the queue is sampled, in milliseconds. Default 2000. */
    sampleIntervalMs?: number;

    /** How long events, requests and samples are kept, in milliseconds. Default 24 hours. */
    retentionMs?: number;

    /** First pause after a failed take; it doubles up to 15 seconds. Default 1000. */
    initialBackoffMs?: number;

    /** How often old rows are deleted, in milliseconds. Default 60 seconds. */
    sweepIntervalMs?: number;
}
