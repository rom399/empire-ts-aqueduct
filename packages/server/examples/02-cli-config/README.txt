Run the broker from a config file:

    export QUEUE_ADMIN_TOKEN=...  TELEMETRY_PUBLISH_TOKEN=...  TELEMETRY_PULL_TOKEN=...
    export JOBS_PUBLISH_TOKEN=...  JOBS_PULL_TOKEN=...
    npx tsx src/cli.ts --config examples/02-cli-config/queues.json

Every token must be different. Spill and persisted files go to ./queue-data next to the config file.
