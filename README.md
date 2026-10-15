# Aqueduct

A small message broker built on [`empire-ts`](https://github.com/rom399/Empire): named queues, a publish port and a pull port with per-queue tokens, optional spill to disk, and a client for consuming. Experimental - a learning tool, not a production broker.

| Package | npm name | What it is |
|---|---|---|
| `packages/core` | `empire-ts-aqueduct-core` | The queue itself: no HTTP, no dependencies |
| `packages/client` | `empire-ts-aqueduct-client` | `QueueClient` and `QueueConsumer` |
| `packages/server` | `empire-ts-aqueduct` | The broker, hosted on Empire, with a CLI |
| `packages/monitoring` | `empire-ts-monitoring` | Reads a telemetry queue into SQLite and serves a dashboard |

`examples/lb-telemetry` is an Empire load balancer that publishes its telemetry to Aqueduct. From `packages/monitoring`, `npm run setup` once and then `npm run demo` start everything.

Design: [`doc/features/01_Aqueduct_Broker.md`](doc/features/01_Aqueduct_Broker.md). Each package is installed and tested on its own - install in the order core, client, server, monitoring.
