# Changelog

All notable changes to `empire-ts-aqueduct-client` are documented here. This package is experimental and does not yet commit to strict semantic versioning.

## [Unreleased]

## [0.1.0]

### Added

- `QueueConsumer`: take a batch, acknowledge receipt, then process with a concurrency limit. Long-polling, jittered backoff, graceful `stop()`.
- Optional dedupe window keyed on `itemId`, and optional sorting of each batch by `sequence`.
- `QueueClient`: the take and acknowledge calls on their own.
