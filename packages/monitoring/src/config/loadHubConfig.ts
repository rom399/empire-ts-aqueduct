import fs from "node:fs";
import path from "node:path";
import { ConfigError } from "./ConfigError";
import { HubConfig } from "./HubConfig";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_RETENTION_HOURS = 24;
const MAX_PORT = 65535;

type Json = Record<string, unknown>;

/**
 * Reads the config file. A secret may be written as the text itself or as
 * `{ "env": "NAME" }` to read it from an environment variable. Relative paths
 * are relative to the config file, not to where the program was started.
 */
export function loadHubConfig(file: string, env: NodeJS.ProcessEnv = process.env): HubConfig {
    const absolute = path.resolve(file);
    let raw: string;

    try {
        raw = fs.readFileSync(absolute, "utf8");
    } catch {
        throw new ConfigError(`Cannot read the config file ${absolute}.`);
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new ConfigError(`${absolute} is not valid JSON.`);
    }

    const root = object(parsed, "the config file");
    const broker = object(root.broker, "broker");
    const server = root.server === undefined ? {} : object(root.server, "server");
    const baseDir = path.dirname(absolute);

    const retentionHours = root.retentionHours === undefined ? DEFAULT_RETENTION_HOURS : positive(root.retentionHours, "retentionHours");
    const port = server.port === undefined ? 7130 : positive(server.port, "server.port");

    if (port > MAX_PORT) {
        throw new ConfigError(`server.port must be 1-${MAX_PORT}.`);
    }

    return {
        dbPath: path.resolve(baseDir, text(root.dbPath ?? "./data/telemetry.db", "dbPath")),
        retentionMs: retentionHours * HOUR_MS,
        broker: {
            pullUrl: text(broker.pullUrl, "broker.pullUrl"),
            queue: text(broker.queue, "broker.queue"),
            pullToken: secret(broker.pullToken, "broker.pullToken", env),
            adminToken: broker.adminToken === undefined ? undefined : secret(broker.adminToken, "broker.adminToken", env),
        },
        server: {
            host: text(server.host ?? "127.0.0.1", "server.host"),
            port,
            webRoot: path.resolve(baseDir, text(server.webRoot ?? "../web/dist", "server.webRoot")),
        },
    };
}

function object(value: unknown, where: string): Json {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new ConfigError(`${where} must be an object.`);
    }

    return value as Json;
}

function text(value: unknown, where: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new ConfigError(`${where} must be a non-empty string.`);
    }

    return value;
}

function positive(value: unknown, where: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new ConfigError(`${where} must be a number above 0.`);
    }

    return value;
}

function secret(value: unknown, where: string, env: NodeJS.ProcessEnv): string {
    if (typeof value === "string" && value.length > 0) {
        return value;
    }

    const name = typeof value === "object" && value !== null ? (value as { env?: unknown }).env : undefined;

    if (typeof name === "string") {
        const fromEnvironment = env[name];

        if (!fromEnvironment) {
            throw new ConfigError(`${where}: the environment variable ${name} is not set.`);
        }

        return fromEnvironment;
    }

    throw new ConfigError(`${where} must be a non-empty string or { "env": "VARIABLE_NAME" }.`);
}
