# Aqueduct

A small message broker (named queues, publish and pull ports, spill to disk) built on [`empire-ts`](https://github.com/rom399/Empire). Experimental, not a production broker.

- **Layout**: npm packages under `packages/` - `core` (`empire-ts-aqueduct-core`, the queue itself, no HTTP), `client` (`empire-ts-aqueduct-client`, consumers), `server` (`empire-ts-aqueduct`, the broker hosted on Empire), `monitoring` (`empire-ts-monitoring`, reads a telemetry queue into SQLite and serves a dashboard). `examples/` - runnable apps. `doc/features/` - per-feature design docs in the `00-template-blueprint.md` format, numbered `NN_Name.md`. `archive/` - old prototypes, not built.
- **Runtime**: CommonJS, run via `tsx`. Each package is its own project: run `npm test`, `npm run typecheck` and `npm run verify` from inside the package folder. Packages depend on each other through `file:../core` style links; install in the order core, client, server, monitoring.
- **Naming**: one class, interface, or enum per file; filename matches the type exactly. `I`-prefixed interfaces, PascalCase types, camelCase methods. Tests mirror `src/` one file per class.
- **Dependencies**: `core` and `client` have no runtime dependencies. `server` depends on `empire-ts` and `core` only. Do not add npm packages without being asked.
- **Scope**: all queue work lives in this repository. The Empire repository (`D:\dev\rom`) must not gain queue code.

Each package has its own `AGENTS.md` / `CLAUDE.md` with the rules for that package. The design is in `doc/features/01_Aqueduct_Broker.md`.
