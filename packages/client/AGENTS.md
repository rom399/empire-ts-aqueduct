# empire-ts-aqueduct-client

Consumer client for the Empire queue broker: take batches over the pull port, acknowledge them, and process with a concurrency limit. Experimental. Design: `../../doc/features/01_Aqueduct_Broker.md`.

- **Zero runtime dependencies**; it uses Node's built-in `fetch`. Do not add npm packages without being asked. Node >= 22.2, CommonJS.
- **Consumers only.** Publishing is deliberately not here: producers send plain `fetch` to the publish port (see `QueueTelemetryPublisher` in the empire repo's `examples/12-load-balancer`). The server side is `../server`.
- **Layout**: `src/client` (the broker calls), `src/consumer` (the take / process / acknowledge loop, with a `DedupeWindow` for redelivered ids), `src/types`, exported through `src/index.ts`. `tests/` mirrors `src/`.
- **Style** (same as Empire): one class, interface or enum per file, filename equals the type name, `I`-prefixed interfaces, 4-space indent, JSDoc on public API.
- **The acknowledgement confirms receipt, not finished work.** After `acknowledge(batchId)` the broker forgets the batch and the consumer owns the items. `QueueConsumer` acknowledges first and then processes, so a crash or a handler error loses those items. A consumer that must not lose items takes with `QueueClient`, does its work, and acknowledges after, and then has to cope with seeing an item twice if the receipt window closes first. `the monitoring package (in the empire repo)` does it that way (it stores a batch, then acknowledges, and skips duplicates by item id).
- `the monitoring package (in the empire repo)` and `../server` (dev) depend on this package through `file:../client`, so a change here shows up there without publishing.

Commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run verify`. Install with `npm install --legacy-peer-deps`.

Do not commit, push or publish unless asked.
