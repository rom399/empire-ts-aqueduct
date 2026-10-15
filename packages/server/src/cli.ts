#!/usr/bin/env node
import { ConsoleLogger } from "empire-ts";
import { parseCliArguments } from "./cli/parseCliArguments";
import { USAGE } from "./cli/usage";
import { ConfigError } from "./config/ConfigError";
import { loadServerConfig } from "./config/loadServerConfig";
import { QueueServer } from "./QueueServer";

/** Exit code for a bad command line or config file. */
const EXIT_USAGE = 2;

/** Exit code for a broker that could not start. */
const EXIT_FAILURE = 1;

async function main(): Promise<void> {
    const logger = new ConsoleLogger();
    const args = parseCliArguments(process.argv.slice(2));

    if (args.help) {
        console.log(USAGE);
        return;
    }

    if (args.problem || !args.configPath) {
        console.error(`${args.problem ?? "A config file is required."}\n\n${USAGE}`);
        process.exitCode = EXIT_USAGE;
        return;
    }

    let server: QueueServer;

    try {
        server = new QueueServer({ ...loadServerConfig(args.configPath), logger });
    } catch (error) {
        console.error(error instanceof ConfigError || error instanceof Error ? error.message : String(error));
        process.exitCode = EXIT_USAGE;
        return;
    }

    let stopping = false;

    const shutDown = (signal: string): void => {
        if (stopping) {
            // A second signal means stop waiting.
            process.exit(EXIT_FAILURE);
        }

        stopping = true;
        logger.info(`${signal} received; stopping the queue broker.`);
        server.stop().then(() => process.exit(0), (error: unknown) => {
            logger.error("The queue broker did not stop cleanly.", error);
            process.exit(EXIT_FAILURE);
        });
    };

    process.on("SIGINT", () => shutDown("SIGINT"));
    process.on("SIGTERM", () => shutDown("SIGTERM"));

    try {
        await server.start();
        logger.info(`Queue broker ready. Publish: ${server.publishUrl}  Pull: ${server.pullUrl}`);
    } catch (error) {
        logger.error("The queue broker could not start.", error);
        process.exitCode = EXIT_FAILURE;
    }
}

void main();
