/** The config file is missing, not JSON, or has a wrong or missing setting. */
export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ConfigError";
    }
}
