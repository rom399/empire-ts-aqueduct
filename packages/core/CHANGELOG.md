# Changelog

All notable changes to `empire-ts-aqueduct-core` are documented here. This package is experimental and does not yet commit to strict semantic versioning.

## [Unreleased]

## [0.1.0]

### Added

- Named queues with competing consumers: `Queue` and `QueueRegistry`.
- Take with a receipt acknowledgement, `deliveryCount`, and return to the front of the queue on timeout.
- Long-poll takes with an abort signal.
- Single and batch publish with per-item results and hand-written validation (no schema library).
- Overflow policies `drop-oldest`, `reject` and `spill`, with a three-tier layout (main queue, in-memory buffer, disk files) that stays strictly first-in first-out.
- Optional message expiry (TTL) enforced in every tier by one shared sweeper.
- Optional persistence at shutdown, and loading of spill files left behind by a crash.
- `peek`, `purge` and `stats`.
