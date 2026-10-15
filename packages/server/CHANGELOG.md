# Changelog

All notable changes to `empire-ts-aqueduct` are documented here. This package is experimental and does not yet commit to strict semantic versioning.

## [Unreleased]

## [0.1.0]

### Added

- `QueueServer`: named queues behind two Empire apps, a publish port and a pull port, sharing one registry.
- Per-queue publish and pull bearer tokens and a global admin token (peek, purge, stats), compared in constant time. Missing or duplicate tokens are refused at startup.
- Single and batch publish with per-item results, take with long-polling, and receipt acknowledgement.
- Unauthenticated up/down health on both ports.
- A command line, `empire-ts-aqueduct --config queues.json`, with tokens readable from environment variables and clean shutdown on SIGINT and SIGTERM.
- Saved queues are restored before either port opens, and shutdown releases waiting consumers before saving.
