import fs from "node:fs";
import path from "node:path";
import { QueueServerOptions } from "../QueueServerOptions";
import { QueueServerQueueOptions } from "../QueueServerQueueOptions";
import { ConfigError } from "./ConfigError";
import { QUEUE_KEYS, TOP_LEVEL_KEYS } from "./knownKeys";
import { resolveSecret } from "./resolveSecret";

/**
 * Reads a broker config file (JSON) into QueueServerOptions. Relative `spillRoot`
 * paths are taken from the file's own folder, so the broker behaves the same
 * wherever it is started from. Unknown keys are errors, because a misspelt setting
 * silently doing nothing is worse than a refusal to start.
 */
export function loadServerConfig(filePath: string, env: NodeJS.ProcessEnv = process.env): QueueServerOptions {
    let parsed: unknown;

    try {
        parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        throw new ConfigError(`Could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new ConfigError(`${filePath} must contain a JSON object.`);
    }

    const config = parsed as Record<string, unknown>;

    rejectUnknownKeys(config, TOP_LEVEL_KEYS, "the config file");

    const options: QueueServerOptions = {
        publishPort: requireInteger(config.publishPort, "publishPort"),
        pullPort: requireInteger(config.pullPort, "pullPort"),
        queues: loadQueues(config.queues, env),
    };

    if (config.host !== undefined) {
        options.host = requireString(config.host, "host");
    }

    if (config.adminToken !== undefined) {
        options.adminToken = resolveSecret(config.adminToken, "adminToken", env);
    }

    if (config.spillRoot !== undefined) {
        options.spillRoot = path.resolve(path.dirname(filePath), requireString(config.spillRoot, "spillRoot"));
    }

    if (config.sweepIntervalMs !== undefined) {
        options.sweepIntervalMs = requireInteger(config.sweepIntervalMs, "sweepIntervalMs");
    }

    if (config.shutdownTimeoutMs !== undefined) {
        options.shutdownTimeoutMs = requireInteger(config.shutdownTimeoutMs, "shutdownTimeoutMs");
    }

    return options;
}

function loadQueues(value: unknown, env: NodeJS.ProcessEnv): Record<string, QueueServerQueueOptions> {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length === 0) {
        throw new ConfigError(`"queues" must be an object with at least one queue.`);
    }

    const queues: Record<string, QueueServerQueueOptions> = {};

    for (const [name, raw] of Object.entries(value)) {
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
            throw new ConfigError(`Queue "${name}" must be an object.`);
        }

        const queue = raw as Record<string, unknown>;

        rejectUnknownKeys(queue, QUEUE_KEYS, `queue "${name}"`);

        queues[name] = {
            ...queue,
            publishToken: resolveSecret(queue.publishToken, `Queue "${name}" publishToken`, env),
            pullToken: resolveSecret(queue.pullToken, `Queue "${name}" pullToken`, env),
        } as QueueServerQueueOptions;
    }

    return queues;
}

function rejectUnknownKeys(object: Record<string, unknown>, allowed: Set<string>, where: string): void {
    for (const key of Object.keys(object)) {
        if (!allowed.has(key)) {
            throw new ConfigError(`Unknown setting "${key}" in ${where}.`);
        }
    }
}

function requireInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new ConfigError(`"${name}" must be a whole number.`);
    }

    return value;
}

function requireString(value: unknown, name: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new ConfigError(`"${name}" must be a non-empty string.`);
    }

    return value;
}
