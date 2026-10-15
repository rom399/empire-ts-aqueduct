# empire-ts-monitoring

> Experimental. Not published to npm, and `private` in `package.json` on purpose.

A small telemetry pipeline for Empire's example load balancer:

```
balancer ─┐                                                  ┌─ GET /api/...   (bounded reads)
          ├─► queue broker ─► processor ─► SQLite ─► web server ┤
backends ─┘   (lb-telemetry)    (writes)    (file)    (reads)   └─ GET /api/stream (live deltas, SSE)
                                                                         │
                                                              React dashboard (web/)
```

- **Processor** (`src/processor`): takes batches from the queue, stores each batch in one SQLite transaction, and only then acknowledges it. A crash between the two means redelivery, which the database skips by item id: nothing duplicated, nothing lost that reached the broker. It also samples the queue's own depth, in-flight count and counters through the broker's admin API, so **the queue's history is in the database too**. It is the only writer.
- **Database** (`src/db`): SQLite through Node's built-in `node:sqlite` (no native add-on to build; Node marks the module experimental). WAL mode, so the web server reads while the processor writes, from separate processes.
- **Web server** (`src/server`): an Empire app. It serves the built dashboard and a small JSON/SSE API. Read-only.
- **Dashboard** (`web/`): Vite + React + three.js. A 3D scene of the balancer and its backends, with the telemetry's own path (queue → processor → database) drawn beside it, plus panels for backends, traffic charts, the queue, the database and a live event tail.

## How data gets from the database to the dashboard (and why there is no aggregator)

Nothing reads "everything". Two things keep reads small:

1. **Summaries are kept as data arrives.** When the processor stores an event it also updates `requests` (one row per proxied request), `buckets` (one row per second, backend and route: count, errors, latency sum and max), `backends` and `sources`. Charts read `buckets`; "last minute" statistics read a narrow slice of `requests`, which is indexed by finish time.
2. **Every endpoint is bounded.** Time series answer at most 600 points (the server widens the slice width to fit), event lists at most 500 rows by cursor (`afterSeq` / `beforeSeq`), summaries at most about 150 rows.

Live updates are deltas: one timer in the server asks the database for events newer than the last one it sent and pushes only those to every open tab, and does nothing when no tab is open. The browser loads recent history once over REST and applies the stream on top. A tab that falls behind is told to `resync` instead of being buffered.

A separate aggregator process becomes worth having if several processors write at once, if you run several web servers, or if you want months of history (add 1-minute and 1-hour roll-up tables; `buckets` is the natural seam). None of that is needed for one balancer on one machine.

## Running it

You need Node 22.13 or newer. From this folder:

```
npm run setup      # once: installs this package, the broker and the dashboard, and builds the dashboard
npm run demo       # starts the broker, the hub, the example balancer, three backends and traffic
```

Open **http://localhost:8012/admin/** (through the balancer) or http://localhost:7130/ (the hub directly). Ctrl-C stops everything. `npm run demo -- --no-traffic` leaves out the traffic generator so you can start `traffic.ts` yourself.

### Starting the parts yourself

`npm run demo` only starts these, in this order, each from its own folder:

```
# 1. the queue broker (src/queue-server)
npx tsx src/cli.ts --config ../empire/examples/12-load-balancer/telemetry-broker.json

# 2. processor + dashboard server together (this folder)
npm start                               # = tsx src/cli.ts all --config config/hub.example.json

# 3. the example balancer, backends and traffic (src/empire)
npx tsx examples/12-load-balancer/server.ts
npx tsx examples/12-load-balancer/backend.ts alpha 8021
npx tsx examples/12-load-balancer/traffic.ts
```

`npm run setup` is `npm install --legacy-peer-deps` here and in `../server` (the flag works around an npm bug with the `file:` dependencies), then `npm run web:install` and `npm run web:build`. The demo also needs `../empire` installed, which it already is if you can run the Empire examples.

`empire-ts-monitoring processor` and `server` run the two halves separately. `--config` is a JSON file; secrets may be written as `{ "env": "NAME" }`; relative paths are relative to the config file. See `config/hub.example.json`.

## The API

All `GET`, JSON, `Cache-Control: no-store`. The types are in `src/shared/apiTypes.ts`, shared with the dashboard.

| Endpoint | Answers |
| --- | --- |
| `/api/topology` | The ring: active and recently removed backends, in-flight counts, last-minute stats, lease times |
| `/api/summary?windowMs=` | Totals, status classes, per-backend and per-route statistics (p50/p95) for a window (5 s to 24 h) |
| `/api/timeseries?from=&to=&bucketMs=&backendId=&route=` | Requests, errors and latency per slice, zero-filled, at most 600 points |
| `/api/events?afterSeq=&beforeSeq=&limit=&type=&source=` | Stored events by cursor, at most 500 |
| `/api/requests?limit=&backendId=&since=` | Recent requests, newest first |
| `/api/queue` | Latest queue reading, the last 60 readings, and the processor's heartbeat |
| `/api/queue/series?from=&to=` | The queue over time, at most 600 points |
| `/api/db` | Table row counts, time spans, file size, retention |
| `/api/stream?afterSeq=` | Server-sent events: `hello`, `events`, `queue`, `resync`, `ping` |

## Limits

- **No login.** The server binds to 127.0.0.1 by default, and the example balancer only forwards `/admin` for loopback clients. Put real authentication in front of it before exposing it.
- One processor, one web server, one SQLite file. Rows older than `retentionHours` (default 24) are deleted every minute.
- The live view samples: at most 40 request particles and 14 telemetry packets are drawn per arrival, 1,200 at once. Counts and charts are exact.
- `node:sqlite` is experimental in Node 22 and prints a warning at start.

## Development

```
npm run verify        # typecheck + tests (57)
npm run lint
cd web && npm test    # dashboard logic (36 tests); npm run dev serves it on :5173, proxying /api to :7130
cd web && npm run screenshots    # needs Chromium; writes web/screenshots/
```
