# empire-ts-aqueduct-core

The queue core of the Empire queue broker: named in-memory queues, competing consumers, optional spill-to-disk and persistence. Experimental, not a production broker. Design: `../../doc/features/01_Aqueduct_Broker.md`.

- **Zero runtime dependencies.** Do not add npm packages without being asked. Node >= 22.2, CommonJS, run via `tsx`.
- **No HTTP in here.** The ports, auth and CLI live in `../server`; this package is the data structures and rules only. Anything that needs a clock goes through `src/clock/` so tests control time.
- **Layout**: `src/<area>/` (`queue`, `registry`, `taking`, `publishing`, `items`, `spill`, `stats`, `structures`, `options`, `clock`, `logging`), exported through `src/index.ts`. `tests/` mirrors `src/`. `examples/NN-name/` are runnable and are run by `npm run examples`.
- **Style** (same as Empire): one class, interface or enum per file, filename equals the type name, `I`-prefixed interfaces, 4-space indent, JSDoc on public API, LF line endings.
- **Delivery is at-least-once**: an item taken but not acknowledged before its lease ends is redelivered. Keep that true in any change, and keep the overflow policies (`reject`, `drop-oldest`, `spill`) honest in the stats.

Commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run examples`, `npm run verify` (all of those). Install with `npm install --legacy-peer-deps`.

Do not commit, push or publish unless asked.
