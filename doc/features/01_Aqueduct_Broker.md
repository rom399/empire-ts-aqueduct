# Aqueduct — Broker: Design & Build Doc

**Status:** Implemented (phase one; not yet published to npm)
**Scope:** Native TypeScript architecture. Ships as three packages in this repository, built on the public API of `empire-ts`; `empire-ts` itself does not change.
**Timeline:** Designed by Opus ➡️ Executed by Sonnet

---

## 1. Context & Architectural Goals

### 1.1 The Problem

Empire has no central place for its components (or any app built on it) to send telemetry and other events, and no way to hand work to separate worker processes. This design adds a small, in-memory message broker: a simplified bus.

**Positioning.** It is a cheap Service Bus / SQS style queue: named queues, competing consumers, and a take-and-acknowledge handoff. It is **not** Event Hubs or Kafka: there is no retained log, replay or partitioning. It is also not a production-grade broker and is not an alternative to RabbitMQ or BullMQ. There is no high availability, clustering or processing acknowledgement. Its selling points are that it has no dependencies, is trivial to run, and is honest about its guarantees. The target niche is zero-infrastructure single-node use and dev/test.

The broker knows nothing about telemetry. Payloads are generic JSON, so telemetry is simply the queue named `telemetry`, and other concerns get their own queues with their own consumers.

**Terminology.** The earlier "consumer group" idea is dropped. A queue is a named thing. Producers publish to a named queue, consumers take from the same named queue, and several consumers on one queue compete for items. Each item goes to exactly one consumer.

### 1.2 System Goals

* **Goal 1 - Named queues, declared in config.** Publishing to or taking from an unknown queue is rejected.
* **Goal 2 - Generic JSON payload in a small envelope.** Producers cannot forge queue-assigned fields.
* **Goal 3 - Two ports.** A **publish** port and a **pull** port, with separate per-queue tokens, plus one global admin token for peek, purge and stats.
* **Goal 4 - Batch publish** with per-item results.
* **Goal 5 - Two-step take.** Take, then a receipt ack. After the receipt ack the consumer owns the items completely. Delivered items carry a `deliveryCount`.
* **Goal 6 - Long-poll.** A take can wait for the first item instead of returning empty.
* **Goal 7 - Configurable overflow.** `drop-oldest`, `reject` or `spill`. Spill uses three tiers (main queue, in-memory buffer, disk files) with strict FIFO.
* **Goal 8 - Optional message expiry (TTL)**, enforced in every tier.
* **Goal 9 - Optional persistence at shutdown**, off by default.
* **Goal 10 - Each queue is isolated.** Its own tiers, spill folder, sequence counter and settings.
* **Goal 11 - A consumer client package** makes pulling easy to configure (batch size, concurrency).
* **Goal 12 - Unit tests for the queue and the client**, plus integration tests for the hosted broker.
* **Goal 13 - Publishable as npm packages**, without making `empire-ts` heavier.

### 1.3 Non-Goals (Scope Guardrails)

* **Non-Goal 1 - The full Service Bus lease model:** processing acknowledgements, peek-lock, abandon and max delivery count.
* **Non-Goal 2 - Sessions and transactions.**
* **Non-Goal 3 - Event Hubs style** partitions, offsets, replay, retention and checkpointing.
* **Non-Goal 4 - Capture-style archiving.**
* **Non-Goal 5 - Strict ordering across consumers.**
* **Non-Goal 6 - Wire compatibility** with Service Bus or SQS.
* **Non-Goal 7 - Durability against crashes** beyond what spill gives incidentally. A write-ahead journal is a possible later "reliable mode", not part of this design.
* **Non-Goal 8 - Clustering or high availability.** The broker is one process.
* **Non-Goal 9 - Broker-side dedupe, retry or dead-letter.** All of that is the consumer's job in this phase.
* **Non-Goal 10 - Instrumenting compression, caching and other framework features.** That is separate work that must come after those features exist.
* **Non-Goal 11 - Everything in section 2.7 (Phase 2).**
* **Non-Goal 12 - Changing `empire-ts`.** The broker is hosted on its public API only.

### 1.4 Dependency Stance

**Zero runtime dependencies in the core and the client.** Native Node.js modules only: `node:fs`, `node:crypto`, `node:zlib` (for `crc32`), and the built-in `fetch`. There is **no validation library, not even as a dev dependency**: the envelope is validated by hand-written code. The server package depends on `empire-ts` and the core package only. `typescript`, `vitest`, `oxlint` and `tsx` are dev dependencies, matching `empire-ts`.

Minimum Node version is 22.2 (for `zlib.crc32`), declared in each package's `engines`.

---

## 2. Design & API Contracts (The Opus Blueprint)

### 2.1 Public User API

**Hosting a broker (`empire-ts-aqueduct`)**

```typescript
import { QueueServer } from "empire-ts-aqueduct";

const server = new QueueServer({
    host: "127.0.0.1",
    publishPort: 7001,
    pullPort: 7002,
    adminToken: process.env.QUEUE_ADMIN_TOKEN!,
    spillRoot: "./queue-data",
    queues: {
        telemetry: {
            publishToken: process.env.TELEMETRY_PUBLISH_TOKEN!,
            pullToken: process.env.TELEMETRY_PULL_TOKEN!,
            maxSize: 10_000,
            overflow: "spill",
            maxSpillFiles: 50,
            messageTtlMs: 2 * 60 * 60 * 1000,
            persist: true,
        },
    },
});

await server.start();
// ...
await server.stop(); // persists queues that have persist: true
```

Or from the command line: `empire-ts-aqueduct --config queues.json`.

**Publishing**

```
POST /v1/queues/telemetry/items          (publish port, Authorization: Bearer <publish token>)
{ "type": "request.completed", "payload": { "ms": 12 }, "createdAt": 1790000000000 }

# or an array of items for a batch
```

**Consuming (`empire-ts-aqueduct-client`)**

```typescript
import { QueueConsumer } from "empire-ts-aqueduct-client";

const consumer = new QueueConsumer({
    url: "http://127.0.0.1:7002",
    queue: "telemetry",
    token: process.env.TELEMETRY_PULL_TOKEN!,
    batchSize: 20,
    concurrency: 4,
    waitMs: 20_000,
    handler: async (item) => {
        // item.deliveryCount > 1 means it may be a duplicate
    },
});

consumer.start();
await consumer.stop(); // finishes items already held
```

**In-process, without HTTP (`empire-ts-aqueduct-core`)**

```typescript
import { QueueRegistry } from "empire-ts-aqueduct-core";

const registry = new QueueRegistry({ queues: { jobs: { overflow: "reject" } } });
const queue = registry.get("jobs");
queue.publish({ type: "job", payload: {}, createdAt: Date.now() });
const batch = await queue.take(10);
queue.acknowledge(batch.batchId);
```

### 2.2 Core Interfaces & Data Models

**New item (what a producer sends)**

| Field | Required | Notes |
|---|---|---|
| `type` | yes | Event or work type, 1 to 200 characters, e.g. `request.completed` |
| `payload` | yes | Any plain-JSON value, size-limited |
| `createdAt` | yes | When the event happened (producer clock), epoch ms |
| `source` | no | Which app or component sent it |
| `correlationId` | no | Links events across a request |
| `idempotencyKey` | no | Lets consumers dedupe |
| `schemaVersion` | no | Integer, at least 1; lets the format evolve |

**Queue item (what is stored, delivered and written to disk)** adds fields only the queue may set:

| Field | Notes |
|---|---|
| `itemId` | Unique ID assigned by the queue |
| `sequence` | Per-queue increasing number |
| `enqueuedAt` | When the queue accepted it (broker clock), epoch ms |
| `expiresAt` | `enqueuedAt` plus the queue's `messageTtlMs`; absent if no TTL |

If a producer supplies `itemId`, `sequence`, `enqueuedAt` or `expiresAt`, they are ignored. Unknown fields are dropped. Optional strings are at most 256 characters.

Delivery state (`batchId`, in-flight status, `deliveryCount`) is **not** stored on the item. The queue tracks it internally, so stored items stay immutable. `deliveryCount` is attached to items in the take response only, starting at 1.

**Payload rules.** The payload must be plain JSON: objects, arrays, strings, finite numbers, booleans and null, nested no deeper than 64 levels. Dates, `undefined`, functions, BigInt, `NaN`, `Infinity` and class instances are rejected rather than silently converted. A maximum payload size (`maxPayloadBytes`) is enforced at publish. **Validation is hand-written (`QueueItemValidator`), with no schema library.**

**Core types (each in its own file)**

```typescript
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface NewQueueItem {
    type: string;
    payload: JsonValue;
    createdAt: number;
    source?: string;
    correlationId?: string;
    idempotencyKey?: string;
    schemaVersion?: number;
}

export interface QueueItem extends NewQueueItem {
    itemId: string;
    sequence: number;
    enqueuedAt: number;
    expiresAt?: number;
}

export interface DeliveredQueueItem extends QueueItem {
    deliveryCount: number;
}

export enum OverflowPolicy { DropOldest = "drop-oldest", Reject = "reject", Spill = "spill" }
export enum SpillFullPolicy { Reject = "reject", DropOldest = "drop-oldest" }

export enum PublishRejectionReason { InvalidItem, QueueFull, SpillFull, QueueClosed }

export interface TakeResult {
    batchId: string;
    count: number;
    drained: boolean;
    items: DeliveredQueueItem[];
}

export interface IClock {
    now(): number;
    setTimeout(callback: () => void, delayMs: number): IClockTimer;
}
```

Layering: `Queue` → `QueueRegistry` (named queues, one shared sweeper) → `QueueServer` (two Empire apps) → `QueueConsumer`. The `Queue` class is transport-agnostic and can be used directly in-process. It accepts an injected `IClock` so receipt timeouts, TTL and long-poll waits can be tested without real waiting.

**Wire contract (all under `/v1`)**

| Port | Route | Token | Does |
|---|---|---|---|
| Publish | `POST /v1/queues/:name/items` | publish | One item (`201 {itemId, sequence}`) or an array (`200 {results, acceptedCount, rejectedCount}`). Refusals: `400` invalid item or JSON, `401` token, `404` unknown queue, `413` batch too large, `503` + `Retry-After` when the queue or spill disk is full or the broker is stopping. |
| Publish | `GET /health` | none | Up or down only |
| Pull | `POST /v1/queues/:name/take` | pull | Body `{maxItems?, waitMs?}` (an empty body means the defaults: 10 items, no wait). Replies `{batchId, count, drained, items}`; an empty answer has `batchId: null` |
| Pull | `POST /v1/queues/:name/ack` | pull | Body `{batchId}`. 404 when unknown or expired |
| Pull | `GET /v1/queues/:name/peek?max=` | admin | Non-destructive, main queue only |
| Pull | `POST /v1/queues/:name/purge` | admin | Removes everything waiting |
| Pull | `GET /v1/queues/:name/stats` | admin | Counters per queue |
| Pull | `GET /v1/queues` | admin | List of queue names |
| Pull | `GET /health` | none | Up or down only |

Admin operations live on the pull port, so the design stays at two ports.

### 2.3 Internal Processing Logic Rules

**Delivery contract**

1. **Take.** A consumer asks for up to N items. The queue removes them from the waiting list, marks them in flight, and returns them with a `batchId`. If fewer than N are available it returns what it has immediately and **never waits to fill the batch**.
2. **Empty queue and long-poll.** By default an empty queue returns zero items immediately. A take may pass `waitMs`; if the queue is empty, the request is held until the first item arrives or `waitMs` elapses (capped by `maxWaitMs`). When several consumers are waiting, each published item goes to the longest-waiting consumer.
3. **Receipt ack.** The consumer sends the `batchId` back to confirm it received the items. The queue then forgets them permanently. One call per batch.
4. **Timeout.** If no ack arrives within `receiptTimeoutMs`, the items return to the **front** of the queue and can be taken again, with `deliveryCount` incremented. Items that have passed their `expiresAt` by then are discarded.
5. **After the ack** the consumer owns the items. There is no processing ack, no broker-side retry, no dead-letter, and TTL no longer applies.

Consequences: transport is **at-least-once** (a lost ack causes redelivery); processing after the ack is **at-most-once**. A take is atomic, so two consumers never receive the same item. A single consumer sees FIFO order; across consumers and after a redelivery, order is not guaranteed, and consumers should use `sequence` if it matters.

The broker does not deduplicate, retry, dead-letter, track processing, guarantee ordering across consumers, or provide durability against crashes.

**Batch publish.** One request carries an array of new items for one queue, limited by `maxPublishBatch` items and `maxPublishBytes`. The response gives a per-item result: accepted (with `itemId` and `sequence`) or rejected (with a reason). It is **not all-or-nothing**. The overflow policy applies item by item. Accepted items get consecutive sequence numbers in request order.

**Peek.** Up to N items from the front of the main queue, without removing or leasing them. A point-in-time snapshot; expired items are skipped. It does not read the buffer or spill files.

**Purge.** Removes all waiting items in every tier, including deleting that queue's spill files, and returns how many were removed. The sequence counter is **not** reset. In-flight batches are unaffected; if they time out they return as usual.

**Overflow.** A queue has `maxSize` (default 10,000). In-flight items count toward it and are never evicted. When it is full, `overflow` decides:

| Policy | Behaviour | Good for |
|---|---|---|
| `drop-oldest` | Remove the oldest waiting item, count it as dropped | Telemetry |
| `reject` | The publish is refused as "queue full"; the producer decides | Queues where every item matters |
| `spill` | Overflow into an in-memory buffer, then to disk files | Keeping data when no consumer is attached |

Drops and rejections are counted in stats, and a rate-limited warning is logged at 80% and when full.

**The three tiers (`overflow: spill`)**

1. **Main queue.** The oldest items. Consumers read only from here.
2. **Spill buffer.** In memory (`spillBufferSize`, default 10,000); takes new publishes while the main queue is full.
3. **Disk files.** Written from the buffer when it fills.

Items are oldest in main, newer in files, newest in the buffer, so reading main, then files oldest first, then the buffer is **strict FIFO with no sorting**. Nothing is ever carved out of main.

* **Publish rule.** While any spill files or buffered items exist, new publishes go to the buffer, even if main has room. Otherwise they would jump ahead of older items. With none, and room in main, publishes go straight to main.
* **Flushing.** When the buffer reaches `spillBufferSize`, its oldest `spillBatchSize` items (default 2,000) are written to one file and removed from memory. Writes are batched, never continuous.
* **Refilling.** After each take or ack: if files exist and main has at least as many free slots as the oldest file holds, that file is loaded onto the back of main and deleted, repeating while headroom remains. If no files exist, items move buffer → main whenever main has space (no disk). Requiring headroom for a whole file means a reload can never immediately overflow the queue, which prevents thrashing. `spillBatchSize` may not exceed `maxSize` or `spillBufferSize`.
* **Disk cap.** Spill requires `maxSpillFiles` or `maxSpillBytes`. At the cap, `spillFull` decides: `reject` (default) or `drop-oldest` (delete the oldest file, count its items as dropped).
* **Write failures** (disk full, permissions): keep items in memory, fall back to `drop-oldest` for the buffer, log a warning. A disk problem must not take the broker down.
* **Spill without a disk** is not available; an in-memory buffer alone is the same as a bigger `maxSize`.
* **Memory** worst case: `maxSize` + `spillBufferSize` + one loaded file's worth of items.

**Spill file format**

* Layout: `<spillRoot>/<queueName>/<yyyy-MM-dd>/<timestamp-to-minute>_seq<first>-<last>.ndjson`, e.g. `2026-10-10T09-37_seq000123-002122.ndjson`. Hyphens, never colons, so names are Windows-safe.
* NDJSON: a header line `{kind:"header", version:1, count, firstSequence, lastSequence, maxExpiresAt, writtenAt}`, then one item per line, each with a `zlib.crc32` hex checksum.
* Written to a temporary name and renamed, so a file is complete or absent.
* Files are ordered by **first sequence, not timestamp**, because the shutdown flush writes older items after newer runtime files.
* The queue keeps an in-memory index of the headers, built at startup.
* A file is deleted after a successful load. A crash after a load therefore means loss, never replay.
* A partly corrupt file is salvaged line by line and the original renamed `.corrupt`.
* The sequence counter is saved to `state.json` `{nextSequence}` in the queue's folder.
* Spill I/O is **synchronous** on purpose. It keeps tier transitions atomic with publish and take, and batches are small.

**Message expiry (TTL).** A per-queue `messageTtlMs` sets `expiresAt` at publish, measured from the broker's `enqueuedAt` (not the producer's `createdAt`, because clocks drift). Default is no expiry.

* **Main and buffer:** TTL is uniform, so expired items are always at the front. The sweep pops from the head until it reaches a live item; a take also skips anything expired.
* **Disk files:** the index records each file's newest `expiresAt`. The sweep deletes fully expired files without opening them. Partly live files are filtered on load.
* **In-flight items** are exempt during the receipt window; a returned batch past its TTL is discarded.
* **After the ack:** TTL no longer applies.
* One shared sweeper (default every 30 seconds) serves all queues. `expired` is counted separately from `dropped`, with a rate-limited summary log.
* `expiresAt` is absolute, so with `persist` on, downtime counts against TTL.

**Persistence at shutdown.** Per-queue `persist` (default **off**), using the spill file format, so it requires `spillRoot`.

* **Shutdown:** stop accepting publishes and takes, release waiting long-polls with an empty response, return in-flight items to waiting, write main then the buffer as spill files (each at most `spillBatchSize`), and save the sequence counter. The shutdown flush ignores the disk cap.
* **Startup:** before opening either port, load files oldest first under the same headroom rule. What does not fit stays on disk. Missing files mean start empty.
* **Corrupt file:** rename `.corrupt`, log a warning, continue.
* **Leftover spill files from a crash** are loaded the same way (partial crash survival). Leftover `.tmp` files are cleaned up.
* Expired items are dropped as files load.
* Queue settings (limits, tokens) always come from config, never from files.

**Multiple queues.** Each named queue has its **own** main queue, buffer, spill folder, sequence counter, TTL, limits, policy and tokens, so a flood on one cannot squeeze out another and per-queue FIFO and sequence numbers hold. Names are lowercase letters, digits, hyphens and underscores, 1 to 64 characters, and not a Windows reserved name (`con`, `nul`, ...). Startup logs worst-case memory and disk totals across all queues. Ten queues at defaults is ten times the worst case; global caps are Phase 2.

**Consumer client rules**

* Flow: take a batch, **ack receipt immediately**, then process. Slow processing never causes redelivery.
* If the ack call **errors** (outcome unknown), the batch is still processed. If the ack explicitly reports "not acknowledged" (the batch already timed out and was re-queued), the batch is skipped, because the broker has put those items back.
* Each handler call receives the item including `deliveryCount`.
* Graceful `stop()`: abort the outstanding long-poll, finish the items already held.
* Errors on take back off with jitter.
* Optional helpers, off by default: a dedupe window keyed on `itemId`, and sorting each batch by `sequence`.
* The client uses built-in `fetch`, has no dependencies, and does not need `empire-ts`.

### 2.4 Security & Performance Defaults

**Unknown queues.** Queue names are not secrets, so an unknown queue gets `404` before the token is checked on the publish and pull routes. Admin routes check the admin token first.

**Authentication.** Bearer tokens, compared by hashing both sides with sha256 and using `timingSafeEqual`, replying `401` with `WWW-Authenticate: Bearer` (the same pattern as the load balancer's registration endpoint). A missing token for any queue throws at construction, and so does any pair of identical tokens (a pull token that could also publish would defeat having two ports). Admin routes exist only when an admin token is configured. The config loader rejects unknown settings, so a misspelt `messageTtl` cannot silently leave items that never expire. A publish token cannot take, a pull token cannot publish, and neither can use admin operations. The health route needs no token and reveals no counts or queue names.

**Take is a POST** because it changes state. Proxies and retries treat GETs as safe to repeat, and repeating a take would lose items.

**Limits.** `maxBodySize` of each Empire app is derived from `maxPublishBytes`. `maxTakeSize` caps one take. Long-poll waits are capped by `maxWaitMs` (30 s) to stay below typical proxy timeouts. A client disconnect (`res.once("close")`) cancels a held long-poll.

**Bind address.** Defaults to `127.0.0.1`. Binding wider is the operator's choice, and the README says tokens travel in the clear without TLS in front.

**Spill files contain payloads in plain text.** Protect the folder. Encryption and permissions are Phase 2.

**Defaults**

| Setting | Default | Notes |
|---|---|---|
| `maxSize` | 10,000 | Items in the main queue |
| `overflow` | `drop-oldest` | `drop-oldest`, `reject`, `spill` |
| `spillBufferSize` | 10,000 | `spill` only |
| `spillBatchSize` | 2,000 | Items per spill file; not above `maxSize` or `spillBufferSize`. When not set, it is lowered automatically to fit a smaller `maxSize` or `spillBufferSize` |
| `maxSpillFiles` / `maxSpillBytes` | none | At least one required for `spill` |
| `spillFull` | `reject` | `reject` or `drop-oldest` |
| `messageTtlMs` | none | Items expire this long after enqueue |
| `receiptTimeoutMs` | 10,000 | Time to confirm receipt |
| `maxWaitMs` | 30,000 | Cap on a long-poll wait |
| `maxPayloadBytes` | 65,536 | Rejected at publish if larger |
| `maxPublishBatch` | 500 | Items per batch publish |
| `maxPublishBytes` | 1,048,576 | Total size of a batch publish |
| `maxTakeSize` | 100 | Broker cap per take |
| `persist` | off | Save and restore at shutdown |
| `adminToken` | required for admin routes | Global |
| `spillRoot` | required for spill or persist | Global |
| `sweepIntervalMs` | 30,000 | One sweeper for all queues |

Settings validation: positive integers where numeric; `spillBatchSize` not above `maxSize` or `spillBufferSize`; `spill` and `persist` require `spillRoot`; `spill` requires a disk cap.

**Developer documentation: when nothing is consuming** (this text goes into the package READMEs)

> **Queues accept items whether or not anyone is consuming them.** Items wait in memory until a consumer takes them. With no consumer attached the queue fills up, and `overflow` decides what happens: `drop-oldest` discards the oldest items silently (check the `dropped` counter), `reject` fails publishing with "queue full", and `spill` moves items to a second in-memory buffer and then to JSON files on disk, loading them back oldest first as consumers make room.
>
> **If you use `spill`:** spill files hold your payloads in plain text; disk use is capped, and at the cap new items are rejected (or the oldest file is deleted); each queue spills separately.
>
> **Always:** items expire if `messageTtlMs` is set (check `expired`); delivery is at-least-once, so use `itemId` to dedupe and `sequence` to sort; after you acknowledge receipt the items are yours and a crash while processing loses them; a queue is not a database, and only a clean shutdown with `persist` saves everything; purge is permanent. Monitor `depth`, `spilledFiles`, `dropped`, `rejected` and `expired`.

### 2.5 Packaging, Hosting & Testing

**Three packages**, each a folder beside `src/empire`, each with its own `package.json`, build, tests and README:

| Folder | Package | Depends on | Contents |
|---|---|---|---|
| `packages/core` | `empire-ts-aqueduct-core` | nothing | Item types, validator, `Queue`, spill store, `QueueRegistry`, sweeper |
| `packages/client` | `empire-ts-aqueduct-client` | nothing | `QueueClient`, `QueueConsumer` |
| `packages/server` | `empire-ts-aqueduct` | `empire-ts`, `empire-ts-aqueduct-core` | `QueueServer` (two Empire apps), CLI |

The core and client stay free of the web framework, so workers install only what they need and the queue can be used in-process. `empire-ts` does not change.

**Hosting on Empire.** `QueueServer` creates two `Empire` instances sharing one `QueueRegistry`. Everything needed already exists in the public API: `start()` and `stop()`, `post()`/`get()` routes with `:name` parameters, `ctx.jsonBody()`, `ctx.res.once("close")` for client disconnect, `maxBodySize`, `ILogger`, and DI disposal. The registry implements `Disposable` so `stop()` persists it. Empire's `ILogger` and the core's `IQueueLogger` have the same shape, so the server passes its logger straight through with no adapter. The CLI registers SIGINT and SIGTERM handlers that call `stop()`, because `Empire` does not.

**Local development across packages.** The packages are siblings in one repository, not an npm workspace.

* `empire-ts-aqueduct` lists `empire-ts-aqueduct-core` as `"file:../core"` and `empire-ts-aqueduct-client` (dev only) as `"file:../client"`, so `npm install` works before anything is published. For tests and type-checking, a Vitest alias and tsconfig `paths` map both to the sibling `src/index.ts`, so nothing needs building first. The build config clears `paths` and compiles against the sibling's built `dist`, so build the core first.
* `npm run check-publishable` (run by `prepublishOnly`) **fails while any dependency is still a `file:` path**, so the server cannot be published by accident before the core is.

**Testing.**

* Verified in the build: core 209 tests, client 50 tests, server 72 tests (unit plus integration, including the command line).
* Unit tests mirror `src/` one-to-one as `tests/unit/.../ClassName.test.ts`, Vitest, plain-English names, no real waiting (a `ManualClock` fixture with `advance(ms)`).
* The client's unit tests use an injected fake `fetch`.
* Integration tests in the server package start the real broker on ephemeral ports with the real client.
* Spill and persistence tests use a per-test temp directory under `os.tmpdir()`.

### 2.6 Publishing

Each package is published separately by the owner (2FA by security key). Start at `0.1.0`, mark the packages experimental like `empire-ts`, and publish the core, then the client, then the server. Before publishing the server, replace its `"file:../core"` dependency with the published range (for example `"^0.1.0"`); `check-publishable` refuses to publish otherwise. Publishing is never done by the build; the owner runs it.

### 2.7 Phase 2 (documented, not built)

Worth doing once phase one has a real user. Each builds on the registry of named queues and does not change phase one's contracts.

1. **Dead-letter to a named queue** for expired, dropped or spill-refused items. One level only, validated at startup.
2. **Forwarding (copy-to)** for cheap fan-out. Copies are independent items; cycles rejected at startup.
3. **Publisher-side dedupe window** keyed on `idempotencyKey`.
4. **Scheduled (delayed) delivery**, deliberately outside strict FIFO.
5. **Per-item TTL override**, which forces the sweep to scan.
6. **Global caps** on total memory and spill disk.
7. **Spill file protection:** restricted permissions and optional encryption.
8. **Producer client package** with batching, retry and backoff.
9. **Admin conveniences:** peek across all tiers, runtime queue creation, a read-only dashboard.
10. **A separate admin port**, if mixing admin onto the pull port proves awkward.

Later, a **reliable mode** (write-ahead journal with checksummed segments, durability levels, a single-writer lock on the data folder) could be designed; spill files are NDJSON with checksums so they can serve as journal segments. Availability across machines is left to the platform.

---

## 3. Iterative Build Steps & Test Strategy (The Sonnet Instructions)

Build in slices, each useful on its own. The spill tiers (slice 4) were optional in the first draft; phase one includes them.

### Step 1: Types & Structural Definitions
* **Description:** In `src/queue/src`, define the item types, `IClock`, `IQueueLogger`, option and settings types, result types and enums, one type per file. Write `QueueItemValidator`, `isJsonValue` and `QueueSettings` (defaults and validation).
* **Sonnet Check:** `npm run typecheck` is clean. No dependencies were added.

### Step 2: Component Logic & Isolated Unit Tests
* **Description (slice 1):** `Queue`: single and batch publish, take with `deliveryCount`, receipt ack and timeout, long-poll waiting, TTL, stats, peek, purge, `drop-oldest` and `reject`.
* **Vitest Assertions:**
  * FIFO order for a single consumer; two consumers never receive the same item.
  * Take returns fewer than requested when fewer are available; an empty queue returns zero immediately when not long-polling.
  * Receipt ack removes items; a missing ack returns them to the front after the timeout.
  * `deliveryCount` starts at 1, increases on each timeout return, and is not stored on the item or in spill files.
  * Producer-supplied `itemId`, `sequence`, `enqueuedAt` and `expiresAt` are ignored; non-JSON and oversized payloads are rejected.
  * Batch publish: partial success, per-item results, consecutive sequences, `maxPublishBatch` and `maxPublishBytes`.
  * Long-poll: returns immediately when items exist; waits and returns on the first publish; returns empty at `waitMs`; capped by `maxWaitMs`; never waits to fill the batch; the longest-waiting consumer is served first; aborted waiters are cleaned up; shutdown releases waiters.
  * Peek does not change state or lease items and skips expired items. Purge empties every tier, does not reset the sequence counter and does not affect in-flight batches.
  * `drop-oldest` and `reject` update counters; in-flight items are never evicted.
  * TTL: expired items skipped on take and removed by the sweep; returned in-flight items past TTL discarded; `expired` counted apart from `dropped`.
* **Description (slice 3):** persistence at shutdown using the spill format. **Description (slice 4):** spill tiers.
* **More assertions:**
  * Tiers: publishes go to the buffer while files or buffered items exist; strict FIFO across main, files and buffer; the buffer flushes only its oldest `spillBatchSize` items; a file loads only with enough free slots; buffer → main moves need no disk.
  * Spill: file names sort correctly and are Windows-safe; writes are atomic; loaded files are deleted; the disk cap and `spillFull` behave as specified; write failures fall back without crashing; fully expired files are deleted unopened; partly expired files are filtered on load.
  * Persist: clean shutdown then restart restores items and the sequence counter in order; corrupt files are renamed aside and salvaged; missing files are fine; leftover crash files are loaded.
  * Registry: separate sequence counters, folders and settings; one queue overflowing does not affect another; invalid or colliding names are rejected; unknown queue errors; startup logs worst-case totals.

### Step 3: Network Pipeline Integration & Live Sockets
* **Description (slice 2, hosted):** `QueueServer` with two Empire apps, per-queue tokens, admin token, health and stats, and the CLI. `QueueClient` and `QueueConsumer` in their own package.
* **Integration Tests:** start a real broker on ephemeral ports and drive it with the real client.
  * Take is a POST; wrong or missing tokens are refused; the publish token cannot take, the pull token cannot publish, and neither can use admin operations.
  * Health needs no token and reveals nothing; stats, peek and purge need the admin token.
  * Publish through the publish port, consume through the client end to end, including a long-poll released by a publish and by a client disconnect.
  * Consumer client respects `batchSize` and `concurrency`, acks before processing, passes `deliveryCount`, skips a batch the broker reports as not acknowledged, and stops gracefully.
  * `stop()` with `persist` writes files and a restart restores them.

### Step 4: Verification, Benchmarking, & Example App
* **Description:** In each package run `npm run verify` (typecheck, lint, Vitest, examples) and `npm pack --dry-run`. Add a runnable example in `examples/` (a broker with a producer and competing consumers, in the server package; the core has two in-process examples). The client package has no examples of its own, since a consumer needs a broker. Write a consumer-facing `README.MD` per package using the section in 2.4, and a `CHANGELOG.md`.
* **Sonnet Check:** the packed file lists contain only `dist` and the changelog; nothing is committed, pushed or published without the owner's sign-off.

---

## 4. Open Questions

* **Default overflow policy:** `drop-oldest` is proposed; `reject` is safer for non-telemetry queues.
* **Default buffer size:** 10,000 doubles worst-case memory per queue.
* **Admin operations:** on the pull port with a global admin token (as written), or a third port.
* **Batch publish:** partial success (as written) or all-or-nothing.
* **Peek scope:** main queue only (as written), or all tiers.
* **Timestamp format:** epoch milliseconds (as written) or ISO strings.
* **Naming:** `queue` is used throughout; confirm before the API is frozen.

## 5. Consequences

* **Easier:** one place for framework telemetry and for handing work to separate processes, without adding dependencies to `empire-ts`.
* **Harder:** three new packages to version and publish, a stateful component with disk I/O and two network listeners, and a public surface to freeze.
* **Risk to watch:** the delivery guarantees are weak by design, and the word "queue" invites expectations of reliability. The READMEs must say so prominently.
* **Risk to watch:** scope creep toward Service Bus parity. Phase 2 exists so good ideas have a home without being built prematurely.
