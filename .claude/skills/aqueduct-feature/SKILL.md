---
name: "aqueduct-feature"
description: "Add a feature to Aqueduct following the standard build procedure - design doc from the template, implementation, mirrored unit tests, a runnable example, then verify. Use when asked to add a feature, build a phase 2 item, or extend the broker or client."
---

## 1. Design doc first (for anything substantial)

Create `doc/features/NN_Name.md` from `00-template-blueprint.md` (next free number). Keep the headings: Context & Architectural Goals, Design & API Contracts, Iterative Build Steps & Test Strategy. Non-goals matter - say what is not being built.

## 2. Implement in the right package

- Queue rules and data structures -> `packages/core` (no HTTP, no dependencies).
- Consumers and producers -> `packages/client` (no runtime dependencies; plain `fetch`).
- Ports, auth, CLI -> `packages/server` (depends on `empire-ts` public API only).
- One class per file, filename matches the type, JSDoc on public members, named constants, constructor injection.
- No new npm dependency without the user agreeing first.

## 3. Tests

One test file per class under `tests/unit/`, mirroring `src/`. Cover failure cases, not just the golden path. Server features also get an integration test over a real ephemeral port.

## 4. Example

Runnable and actually run: start it and exercise every case its header comment claims.

## 5. Verify and document

Run `npm run verify` in each changed package (and `npm run lint`). Update the package `README.MD` and `CHANGELOG.md`, and the design doc's status. Install order if links change: core, client, server, monitoring.
