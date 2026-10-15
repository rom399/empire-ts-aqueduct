import { ILogger } from "empire-ts";

/** What the publisher needs to reach the broker, and how it batches and buffers. */
export interface QueueTelemetryPublisherOptions {
    /** Base address of the broker's publish port, for example "http://127.0.0.1:7121". */
    brokerUrl: string;

    /** The queue that receives the events. */
    queueName: string;

    /** That queue's publish token. */
    token: string;

    /** Written into every item's `source`, so a consumer can tell the balancer and each backend apart. */
    source: string;

    /** Where warnings go. */
    logger: ILogger;

    /** Most events sent in one request. Keep it at or below the broker's batch limit (500 by default). Default 100. */
    maxBatch?: number;

    /** Events held while the broker is slow or down. When full, the oldest are dropped. Default 5000. */
    maxBuffered?: number;

    /** How often buffered events are sent when the batch is not yet full, in milliseconds. Default 500. */
    flushIntervalMs?: number;

    /** Give up on one request after this long, in milliseconds. Default 2000. */
    requestTimeoutMs?: number;

    /** Least time between two warnings, in milliseconds. Default 10000. */
    warnIntervalMs?: number;
}
