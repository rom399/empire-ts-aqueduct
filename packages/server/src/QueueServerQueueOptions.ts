import { QueueOptions } from "empire-ts-aqueduct-core";

/** One queue on the broker: the queue's settings plus the tokens that guard its two ports. */
export interface QueueServerQueueOptions extends QueueOptions {
    /** Producers present this on the publish port. */
    publishToken: string;

    /** Consumers present this on the pull port. Must differ from the publish token. */
    pullToken: string;
}
