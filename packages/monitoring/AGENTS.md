# empire-ts-monitoring

Drains a queue broker into SQLite, serves a small read API and a live stream, and hosts a React + three.js dashboard (`web/`). The example load balancer proxies it at `/admin`. Private and experimental. Read `README.MD` first; the data flow and why there is no separate aggregator are explained there.

- **Dependencies**: `empire-ts` and `empire-ts-aqueduct-client` (`file:../client`) only; the dashboard has its own `web/package.json` (Vite, React, three). Do not add npm packages to Empire, or here, without being asked. Node >= 22.13 because storage is `node:sqlite` (experimental, no native add-on).
- **Layout**: `src/db` (schema, writer, projector, one query class per read), `src/processor` (take, store, acknowledge), `src/server` (`HubServer`, `ApiRoutes`, `LiveStream`), `src/config`, `src/shared/apiTypes.ts` (the contract between server and dashboard; change it first, then both sides), `scripts/demo.ts`, `web/src` (`api`, `data`, `scene`, `components`). `tests/` mirrors `src/`; `web/tests/` holds the dashboard's.
- **Rules that keep it correct**
  - Store a batch in **one transaction, then acknowledge**. Delivery is at-least-once, so inserts dedupe on `item_id` (`ON CONFLICT DO NOTHING`); never switch to `INSERT OR IGNORE`, it hides NOT NULL failures.
  - The dashboard never reads everything: time series are capped at 600 points, event lists at 500 with a cursor. Keep new queries bounded and indexed, and add a summary table write at ingest instead of scanning raw events at read time.
  - `buckets` and `queue_samples` are `WITHOUT ROWID`; do not use `rowid` there. Bind JS numbers through `CAST(... AS INTEGER)` when SQLite does integer division.
  - Dashboard URLs are relative (`./`, `api/...`) so the same build works at `/`, `/admin/` and behind the Vite dev proxy. Do not add absolute paths.
  - No login: the hub, and the `/admin` proxy, serve loopback only. Do not expose either without adding authentication.
- **Style** (same as Empire): one class, interface or enum per file where practical, filename equals the type name, 4-space indent, JSDoc on public API, LF line endings.

Commands: `npm run setup` once, then `npm run demo` (broker, hub, balancer, three backends, traffic; open `http://localhost:8012/admin/`). `npm test`, `npm run typecheck`, `npm run lint`, `npm run verify`; in `web/`: `npm test`, `npm run typecheck`, `npm run build`, `npm run screenshots` (headless Chromium).

Do not commit, push or publish unless asked.
