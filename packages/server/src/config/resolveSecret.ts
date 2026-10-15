import { ConfigError } from "./ConfigError";

/**
 * A secret in the config file is either the text itself or `{ "env": "NAME" }`,
 * which reads it from an environment variable so it need not sit in the file.
 */
export function resolveSecret(value: unknown, where: string, env: NodeJS.ProcessEnv): string {
    if (typeof value === "string" && value.length > 0) {
        return value;
    }

    if (typeof value === "object" && value !== null && typeof (value as { env?: unknown }).env === "string") {
        const name = (value as { env: string }).env;
        const fromEnvironment = env[name];

        if (!fromEnvironment) {
            throw new ConfigError(`${where}: the environment variable ${name} is not set.`);
        }

        return fromEnvironment;
    }

    throw new ConfigError(`${where} must be a non-empty string or { "env": "VARIABLE_NAME" }.`);
}
