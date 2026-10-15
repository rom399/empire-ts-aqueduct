# empire-ts-aqueduct-core

> **Experimental.** A small in-memory message queue for Node.js with named queues, competing consumers and optional spill-to-disk. It has **no dependencies**. It is **not** a production broker: read [What it does not do](#what-it-does-not-do) before you rely on it.

This is the core of the Empire queue. It runs inside your process. To expose queues over HTTP use `empire-ts-aqueduct`, and to consume from a remote broker use `empire-ts-aqueduct-client`.

```
npm install empire-ts-aqueduct-core
```

Needs Node.js 22.2 or later.

## Quick start

```ts
import { QueueRegistry } from "empire-ts-aqueduct-core";

const registry = new QueueRegistry({
    queues: { jobs: { overflow: "reject", maxSize: 1000 } },
});

registry.start();

const jobs = registry.get("jobs");

// Publish. The result says whether the item was accepted.
jobs.publish({ type: "email.send", payload: { to: "a@example.com" }, createdAt: Date.now() });

// Take up to 10. You get what is there, immediately, even if that is fewer than 10.
const batch = await jobs.take(10);

// Acknowledge receipt, then process. From this moment the items are yours.
if (batch.batchId) {
    jobs.acknowledge(batch.batchId);
}

for (const item of batch.items) {
    // item.deliveryCount > 1 means this item was handed out before
}

registry.dispose(); // stops the sweeper and saves queues that have persist: true
```

## How delivery works

1. **Take.** `take(n)` removes up to `n` items from the queue, marks them *in flight* and returns them with a `batchId`. It never waits to fill the batch. On an empty queue it returns nothing at once, or waits for the first item if you pass `{ waitMs }`.
2. **Acknowledge receipt.** Call `acknowledge(batchId)` once you have the items. The queue then forgets them.
3. **No acknowledgement?** After `receiptTimeoutMs` (10 seconds by default) the items return to the **front** of the queue and `deliveryCount` goes up.

That makes transport **at-least-once**: a lost acknowledgement means the same items come back, so you may see duplicates (dedupe on `itemId`, sort on `sequence`). Processing after the acknowledgement is **at-most-once**: if your process dies while working, those items are gone.

## Queue items

A producer sends `type`, `payload` (plain JSON) and `createdAt`, and optionally `source`, `correlationId`, `idempotencyKey` and `schemaVersion`. The queue adds `itemId`, `sequence`, `enqueuedAt` and, with a TTL, `expiresAt`. Anything a producer supplies in those fields is ignored.

Payloads must be plain JSON. Dates, `undefined`, functions, BigInt, `NaN` and class instances are rejected rather than silently changed.

## When the queue fills up

A queue holds `maxSize` items (10,000 by default), counting items in flight. When it is full, `overflow` decides:

| `overflow` | What happens |
|---|---|
| `drop-oldest` (default) | The oldest waiting item is discarded. Nothing tells the producer; watch `stats().dropped`. |
| `reject` | The new item is refused with `queue-full`. |
| `spill` | New items go to an in-memory buffer and then to JSON files on disk. |

### Read this if you use `spill`

**Queues accept items whether or not anyone is consuming them.** With no consumer attached, a spilling queue writes batches of items to files under `spillRoot/<queue name>/<date>/`. When consumers make room, the files are loaded back **oldest first**, so order is preserved.

- **Spill files contain your payloads in plain text.** Protect the folder, and do not queue secrets you would not write to disk.
- **Disk use is capped.** You must set `maxSpillFiles` or `maxSpillBytes`. At the cap, new items are rejected, or with `spillFull: "drop-oldest"` the oldest file is deleted.
- **Each queue spills separately,** so many queues multiply memory and disk use. `registry.start()` logs the worst case.

Three tiers hold the items, always in this order: the **main queue** (the only place consumers take from), the **spill files**, then the **spill buffer** (newest). Reading them in that order is strict first-in first-out.

## Settings

All are optional. Set them per queue.

| Setting | Default | Meaning |
|---|---|---|
| `maxSize` | 10,000 | Items in the main queue |
| `overflow` | `drop-oldest` | `drop-oldest`, `reject` or `spill` |
| `spillBufferSize` | 10,000 | In-memory buffer; `spill` only |
| `spillBatchSize` | 2,000 | Items per spill file (lowered to fit a smaller `maxSize`) |
| `maxSpillFiles`, `maxSpillBytes` | none | Disk cap; `spill` needs at least one |
| `spillFull` | `reject` | `reject` or `drop-oldest` when the cap is reached |
| `messageTtlMs` | none | Items expire this long after being enqueued |
| `receiptTimeoutMs` | 10,000 | Time to acknowledge a batch |
| `maxWaitMs` | 30,000 | Longest a take may wait |
| `maxPayloadBytes` | 65,536 | Largest payload |
| `maxPublishBatch` | 500 | Items per batch publish |
| `maxPublishBytes` | 1,048,576 | Payload bytes per batch publish |
| `maxTakeSize` | 100 | Items per take |
| `persist` | `false` | Save at shutdown, restore at startup |

Registry options: `spillRoot` (needed by `spill` and `persist`), `sweepIntervalMs` (30 seconds), `logger` (console by default) and `clock`.

Queue names are 1 to 64 lowercase letters, digits, hyphens or underscores, and not a Windows reserved name such as `con`.

## Expiry, persistence and operations

- **TTL.** With `messageTtlMs`, items expire in every tier, even if nothing ever consumed them (`stats().expired`). Items in flight are exempt during the receipt window. TTL stops applying once you acknowledge.
- **Persistence.** With `persist: true` and a `spillRoot`, `registry.dispose()` writes everything waiting to disk and `registry.start()` reads it back. Time spent down counts against TTL. Leftover spill files from a crash are also loaded. Killing the process loses whatever was in memory and not yet on disk.
- **`peek(n)`** shows the front of the main queue without taking anything. **`purge()`** removes everything waiting, including spill files. **`stats()`** returns `depth`, `inFlight`, `buffered`, `spilledFiles`, `published`, `taken`, `acknowledged`, `redelivered`, `dropped`, `rejected`, `expired` and more.

## What it does not do

- It does not deduplicate, retry, dead-letter or track processing. After you acknowledge, the items are yours.
- It does not guarantee order across several consumers, or after a redelivery.
- It does not survive a crash. It is not a database.
- It does not cluster. It is one process.
- It is not a replacement for RabbitMQ, SQS, BullMQ or Kafka. It is for zero-infrastructure and development use, where "good enough and honest" beats "another service to run".

## Licence

MIT
