# empire-ts-aqueduct

The queue broker, hosted on Empire: a **publish** port for producers and a **pull** port for consumers (and, with an admin token, operators) over the named queues from `../core`. Experimental, not a production broker. Design: `../../doc/features/01_Aqueduct_Broker.md`.

- **Dependencies**: `empire-ts` and `empire-ts-aqueduct-core` only. Do not add npm packages without being asked. Node >= 22.2, CommonJS, run via `tsx`.
- **Lifecycle**: `QueueServer` has `start()` and `stop()` like Empire's app. `start()` restores saved queues and then opens both ports; `stop()` closes the queues first (releasing long-polls), saves queues with `persist`, then stops the ports, and is safe to call twice. `src/cli.ts` wires SIGINT/SIGTERM to `stop()`.
- **Layout**: `src/QueueServer.ts`, `src/http` (publish and pull routes), `src/auth` (bearer tokens), `src/config` (JSON config loading), `src/cli`. `tests/` mirrors `src/`. `examples/NN-name/` are run by `npm run examples`.
- **Tokens**: each queue has its own publish and pull token, and the admin token is separate; all must be distinct. They travel in the clear, so the broker listens on loopback unless told otherwise. Never log a token.
- **Style** (same as Empire): one class, interface or enum per file, filename equals the type name, `I`-prefixed interfaces, 4-space indent, JSDoc on public API.
- The demo broker config is `examples/12-load-balancer/telemetry-broker.json` in the empire repo (ports 7121 publish, 7122 pull, queue `lb-telemetry`).

Commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run examples`, `npm run verify`. Install with `npm install --legacy-peer-deps`.

Do not commit, push or publish unless asked.
