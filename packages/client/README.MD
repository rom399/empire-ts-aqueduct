# empire-ts-aqueduct-client

> **Experimental.** The consumer client for the Empire queue broker (`empire-ts-aqueduct`). It has **no dependencies** and uses Node's built-in `fetch`; workers do not need to install the framework.

```
npm install empire-ts-aqueduct-client
```

Needs Node.js 22.2 or later.

## Quick start

```ts
import { QueueConsumer } from "empire-ts-aqueduct-client";

const consumer = new QueueConsumer({
    url: "http://127.0.0.1:7002",        // the broker's pull URL
    queue: "telemetry",
    token: process.env.TELEMETRY_PULL_TOKEN!,
    batchSize: 20,                       // take up to 20 items per call
    concurrency: 4,                      // process up to 4 at a time
    handler: async (item) => {
        // item.payload, item.type, item.sequence, item.deliveryCount ...
    },
    onError: (error, item) => console.error(error, item?.itemId),
});

consumer.start();

process.on("SIGINT", async () => {
    await consumer.stop();               // finishes items already in hand
    process.exit(0);
});
```

## What a consumer does

Each round it **takes** a batch, **acknowledges receipt immediately**, and then **processes** the items:

- It asks for up to `batchSize` items and gets whatever is waiting at once, even if that is fewer. On an empty queue it long-polls for up to `waitMs` (20 seconds by default) instead of hammering the broker.
- It acknowledges the whole batch with one call *before* running your handler, so slow processing never causes the broker to redeliver.
- Your handler then runs for each item, up to `concurrency` at a time, and the consumer waits for the whole batch before taking the next.

### What that means for you

- **After the acknowledgement the items are yours.** The broker does not retry or dead-letter. If your handler throws, `onError` is called with the item and the consumer moves on. If your process dies mid-batch, the rest of that batch is gone. If you need retries, re-publish failed items yourself.
- **Duplicates are possible.** If an acknowledgement is lost, the broker redelivers the batch and `item.deliveryCount` is above 1. Dedupe on `itemId`, or switch on the built-in window below.
- If the acknowledgement call *fails* and its outcome is unknown, the batch is still processed. If the broker says the acknowledgement came **too late** (it has already put the items back), the batch is skipped, because another delivery is on its way.

## Options

| Option | Default | Meaning |
|---|---|---|
| `url`, `queue`, `token` | required | Where to connect. The token is the queue's *pull* token |
| `handler` | required | Called for each item |
| `batchSize` | 10 | Most items per take (the broker has its own cap) |
| `concurrency` | 1 | Items processed at the same time |
| `waitMs` | 20,000 | Long-poll wait on an empty queue; `0` turns long-polling off |
| `pollIntervalMs` | 1,000 | Pause between polls when `waitMs` is `0` |
| `initialBackoffMs`, `maxBackoffMs` | 1,000, 30,000 | Pause after failed takes: it doubles with jitter up to the maximum |
| `dedupe` | off | `true` skips items whose `itemId` was seen in the last 10,000; or `{ windowSize }` |
| `sortBySequence` | off | Sort each batch by `sequence` before processing |
| `onError` | `console.error` | Told about broker errors, acknowledgement errors and handler errors |
| `fetch` | global `fetch` | For tests or a custom agent |

Keep `waitMs` below any proxy or load-balancer timeout in front of the broker. The broker caps a wait at its own `maxWaitMs`.

`consumer.stats()` returns counters: `batchesTaken`, `itemsReceived`, `itemsProcessed`, `handlerErrors`, `duplicatesSkipped`, `batchesSkipped`, `takeErrors` and `ackErrors`.

## Stopping

`await consumer.stop()` cancels a waiting take and finishes the items already in hand. If a cancelled take had just been answered, those items come back to the queue after the broker's receipt timeout (10 seconds by default).

## Lower level

`QueueClient` makes the two calls without a loop:

```ts
import { QueueClient } from "empire-ts-aqueduct-client";

const client = new QueueClient({ url, queue: "jobs", token });

const batch = await client.take(10, { waitMs: 5000 });

if (batch.batchId) {
    const accepted = await client.acknowledge(batch.batchId); // false: too late, already re-queued
}
```

Failures throw `QueueClientError`, with the HTTP `status` (absent if the broker could not be reached) and `retryable`.

## Licence

MIT
