# empire-ts-aqueduct

> **Experimental.** A small in-memory message broker hosted on [Empire](https://www.npmjs.com/package/empire-ts): named queues, a **publish port** for producers and a **pull port** for consumers. It is a cheap Service Bus / SQS-style work queue for zero-infrastructure and development use. It is **not** a production broker: read [What it does not do](#what-it-does-not-do) first.

```
npm install empire-ts-aqueduct
```

Needs Node.js 22.2 or later. Consumers install [`empire-ts-aqueduct-client`](https://www.npmjs.com/package/empire-ts-aqueduct-client) instead; they do not need this package or Empire.

## Run it

**From the command line**, with a JSON config file:

```
npx empire-ts-aqueduct --config queues.json
```

```json
{
    "publishPort": 7001,
    "pullPort": 7002,
    "adminToken": { "env": "QUEUE_ADMIN_TOKEN" },
    "spillRoot": "./queue-data",
    "queues": {
        "telemetry": {
            "publishToken": { "env": "TELEMETRY_PUBLISH_TOKEN" },
            "pullToken": { "env": "TELEMETRY_PULL_TOKEN" },
            "overflow": "spill",
            "maxSpillFiles": 50,
            "messageTtlMs": 7200000,
            "persist": true
        }
    }
}
```

A token is a string or `{ "env": "VARIABLE" }`, which reads it from the environment. Every token must be different. Unknown settings are errors, so a misspelt setting cannot silently do nothing. A relative `spillRoot` is taken from the config file's folder. `SIGINT` and `SIGTERM` stop the broker cleanly, saving queues that persist.

**From code:**

```ts
import { QueueServer } from "empire-ts-aqueduct";

const server = new QueueServer({
    publishPort: 7001,
    pullPort: 7002,
    adminToken: process.env.QUEUE_ADMIN_TOKEN,
    queues: {
        telemetry: { publishToken: "...", pullToken: "...", overflow: "drop-oldest" },
    },
});

await server.start();   // restores saved queues, then opens both ports
// ...
await server.stop();    // refuses new work, releases waiting consumers, saves persisting queues
```

Listening defaults to `127.0.0.1`. Tokens travel in the clear, so put TLS in front before listening more widely; the broker warns if you do not use the loopback address.

## Publishing

`POST /v1/queues/<name>/items` on the publish port, with `Authorization: Bearer <publish token>`. The body is one item or an array of items:

```json
{ "type": "request.completed", "payload": { "ms": 12 }, "createdAt": 1790000000000 }
```

Only `type`, `payload` (plain JSON) and `createdAt` are required. `source`, `correlationId`, `idempotencyKey` and `schemaVersion` are optional. The broker adds `itemId`, `sequence`, `enqueuedAt` and `expiresAt`; anything you send in those fields is ignored.

| Reply | Meaning |
|---|---|
| `201 {itemId, sequence}` | A single item was accepted |
| `200 {results, acceptedCount, rejectedCount}` | A batch was processed. **Not all-or-nothing**: each item has its own result, and accepted items get consecutive sequence numbers |
| `400` | An invalid item or a body that is not JSON |
| `401` | Missing or wrong token (`WWW-Authenticate: Bearer`) |
| `404` | No such queue |
| `413` | A batch with too many items or bytes, or a body over the limit |
| `503` + `Retry-After` | The queue is full and rejecting, the spill disk is full, or the broker is shutting down |

## Consuming

Use [`empire-ts-aqueduct-client`](https://www.npmjs.com/package/empire-ts-aqueduct-client), which does this loop for you. The calls on the pull port, with `Authorization: Bearer <pull token>`:

- `POST /v1/queues/<name>/take` with `{ "maxItems": 20, "waitMs": 20000 }`. Replies `{ batchId, count, drained, items }`. You get what is waiting at once, even if fewer than `maxItems`. On an empty queue it returns nothing at once, or holds the request up to `waitMs` (capped by the queue's `maxWaitMs`) for the first item. Take is a **POST** because it changes state; a proxy repeating a GET would be harmless, and repeating a take would lose items.
- `POST /v1/queues/<name>/ack` with `{ "batchId": "..." }`. One call per batch. `404` means the receipt window already closed and the items are back in the queue.

If a batch is not acknowledged within `receiptTimeoutMs` (10 seconds by default), its items return to the **front** of the queue with `deliveryCount` raised. After the acknowledgement the items belong to the consumer.

## Admin operations

With `adminToken` set, these exist on the **pull port** and need that token. Without it they do not exist.

| Route | Does |
|---|---|
| `GET /v1/queues` | Lists queue names |
| `GET /v1/queues/<name>/stats` | Depth per tier, in flight, spilled files, and the `published`, `taken`, `acknowledged`, `redelivered`, `dropped`, `rejected`, `expired` counters |
| `GET /v1/queues/<name>/peek?max=10` | Shows the front of the main queue without taking anything |
| `POST /v1/queues/<name>/purge` | Removes everything waiting, including spill files. Permanent |

`GET /health` on either port needs no token and answers only `{"status":"up"}` (or 503 `down` while stopping).

## Queue settings

Set these per queue next to the tokens: `maxSize`, `overflow` (`drop-oldest`, `reject`, `spill`), `spillBufferSize`, `spillBatchSize`, `maxSpillFiles`, `maxSpillBytes`, `spillFull`, `messageTtlMs`, `receiptTimeoutMs`, `maxWaitMs`, `maxPayloadBytes`, `maxPublishBatch`, `maxPublishBytes`, `maxTakeSize` and `persist`. Meanings and defaults are in the [`empire-ts-aqueduct-core`](https://www.npmjs.com/package/empire-ts-aqueduct-core) README. Globally: `host`, `publishPort`, `pullPort`, `adminToken`, `spillRoot`, `sweepIntervalMs` and `shutdownTimeoutMs`.

### When nothing is consuming

Queues accept items whether or not anyone is consuming them. With no consumer, the queue fills up and `overflow` decides: `drop-oldest` silently discards the oldest items (watch `dropped`), `reject` answers publishers with 503, and `spill` writes batches to JSON files on disk and loads them back, oldest first, as consumers make room. **Spill files hold your payloads in plain text**, and disk use is capped by `maxSpillFiles` or `maxSpillBytes`. Monitor `depth`, `spilledFiles`, `dropped`, `rejected` and `expired`: a queue with no consumers is a misconfiguration, and those numbers are how you notice.

## Security

- Each queue has its own **publish** and **pull** tokens, so a producer cannot drain a queue and a consumer cannot inject items. Tokens are compared in constant time. Missing or duplicate tokens are refused at startup.
- Queue names are not treated as secrets: an unknown queue gets 404 before the token is checked. Health reveals nothing.
- There is no TLS and no rate limiting. Run it on a private network or behind a reverse proxy.

## What it does not do

- It does not deduplicate, retry, dead-letter or track processing. After a consumer acknowledges receipt, the items are the consumer's.
- Delivery is **at-least-once** (a lost acknowledgement means a redelivery) and processing afterwards is **at-most-once**. Order is guaranteed for one consumer, not across several, and not after a redelivery.
- It does not survive a crash: whatever was in memory and not yet on disk is lost. Only a clean shutdown with `persist` saves everything.
- It does not cluster. It is one process, so it is not available while it is down.
- It is not a replacement for RabbitMQ, SQS or Kafka. It is for the case where "good enough and honest" beats "another service to run".

## Licence

MIT
