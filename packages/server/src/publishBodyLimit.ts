import { QueueSettings } from "empire-ts-aqueduct-core";

/** Room for each item's own fields (type, ids, timestamps) on top of its payload. */
const ENVELOPE_BYTES_PER_ITEM = 1500;

/**
 * The largest request body the publish port needs to read: the biggest batch
 * any queue allows, payload bytes plus the envelope of every item. The queue
 * itself enforces its own, tighter limits; this only stops an oversized body
 * from being read into memory at all.
 */
export function publishBodyLimit(settings: Iterable<QueueSettings>): number {
    let limit = 0;

    for (const queue of settings) {
        limit = Math.max(limit, queue.maxPublishBytes + queue.maxPublishBatch * ENVELOPE_BYTES_PER_ITEM);
    }

    return limit;
}
