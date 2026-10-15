#!/usr/bin/env node
import { ConsoleLogger } from "empire-ts";
import { ConfigError } from "./config/ConfigError";
import { loadHubConfig } from "./config/loadHubConfig";
import { TelemetryProcessor } from "./processor/TelemetryProcessor";
import { HubServer } from "./server/HubServer";

const USAGE = `empire-ts-monitoring - drains a telemetry queue into SQLite and serves a dashboard

Usage:
  empire-ts-monitoring <command> --config <file>

Commands:
  processor   read the queue and write the database (the only writer)
  server      serve the dashboard and its API (read-only)
  all         both, in one process

Options:
  -c, --config <file>   JSON config file (required)
  -h, --help            show this help
`;

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const command = args[0];

    if (command === undefined || command === "-h" || command === "--help") {
        console.log(USAGE);
        return;
    }

    if (command !== "processor" && command !== "server" && command !== "all") {
        throw new ConfigError(`Unknown command "${command}". Use processor, server or all.`);
    }

    const flag = args.findIndex((arg) => arg === "--config" || arg === "-c");
    const file = flag >= 0 ? args[flag + 1] : undefined;

    if (!file) {
        throw new ConfigError("--config <file> is required.");
    }

    const config = loadHubConfig(file);
    const logger = new ConsoleLogger();

    // The processor goes first so the database file exists, with its tables, before the server opens it.
    const processor = command === "server" ? undefined : new TelemetryProcessor({
        dbPath: config.dbPath,
        brokerPullUrl: config.broker.pullUrl,
        queue: config.broker.queue,
        pullToken: config.broker.pullToken,
        adminToken: config.broker.adminToken,
        retentionMs: config.retentionMs,
        logger,
    });
    const server = command === "processor" ? undefined : new HubServer({
        dbPath: config.dbPath,
        host: config.server.host,
        port: config.server.port,
        webRoot: config.server.webRoot,
        retentionMs: config.retentionMs,
        logger,
    });

    processor?.start();
    await server?.start();

    if (server) {
        logger.info(`Dashboard: http://${config.server.host === "0.0.0.0" ? "localhost" : config.server.host}:${config.server.port}/`);
    }

    let stopping = false;
    const shutdown = async (): Promise<void> => {
        if (stopping) {
            return;
        }

        stopping = true;
        logger.info("Shutting down...");

        try {
            await server?.stop();
            await processor?.stop();
            process.exit(0);
        } catch (err) {
            logger.error("Error during shutdown", err);
            process.exit(1);
        }
    };

    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
    console.error(err instanceof ConfigError ? `Config problem: ${err.message}` : err);
    process.exit(1);
});
