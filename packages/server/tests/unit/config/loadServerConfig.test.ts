import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError } from "../../../src/config/ConfigError";
import { loadServerConfig } from "../../../src/config/loadServerConfig";

const folders: string[] = [];

afterEach(() => {
    for (const folder of folders.splice(0)) {
        fs.rmSync(folder, { recursive: true, force: true });
    }
});

function writeConfig(config: unknown): string {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "empire-queue-config-"));

    folders.push(folder);

    const file = path.join(folder, "queues.json");

    fs.writeFileSync(file, typeof config === "string" ? config : JSON.stringify(config));

    return file;
}

const valid = {
    publishPort: 7001,
    pullPort: 7002,
    queues: { telemetry: { publishToken: "p", pullToken: "q", maxSize: 50 } },
};

describe("loadServerConfig", () => {
    it("reads ports, queues and queue settings", () => {
        const options = loadServerConfig(writeConfig(valid), {});

        expect(options).toMatchObject({
            publishPort: 7001,
            pullPort: 7002,
            queues: { telemetry: { publishToken: "p", pullToken: "q", maxSize: 50 } },
        });
    });

    it("reads the optional top-level settings", () => {
        const options = loadServerConfig(writeConfig({ ...valid, host: "0.0.0.0", adminToken: "a", sweepIntervalMs: 5, shutdownTimeoutMs: 9 }), {});

        expect(options).toMatchObject({ host: "0.0.0.0", adminToken: "a", sweepIntervalMs: 5, shutdownTimeoutMs: 9 });
    });

    it("reads a token from an environment variable", () => {
        const config = { ...valid, adminToken: { env: "ADMIN" }, queues: { jobs: { publishToken: { env: "PUB" }, pullToken: "q" } } };

        const options = loadServerConfig(writeConfig(config), { ADMIN: "from-env", PUB: "pub-env" });

        expect(options.adminToken).toBe("from-env");
        expect(options.queues.jobs.publishToken).toBe("pub-env");
    });

    it("refuses a token whose environment variable is not set", () => {
        const config = { ...valid, adminToken: { env: "MISSING" } };

        expect(() => loadServerConfig(writeConfig(config), {})).toThrow(/MISSING is not set/);
    });

    it("refuses a missing or empty token", () => {
        const config = { ...valid, queues: { jobs: { pullToken: "q" } } };

        expect(() => loadServerConfig(writeConfig(config), {})).toThrow(/publishToken/);
    });

    it("takes a relative spillRoot from the config file's own folder", () => {
        const file = writeConfig({ ...valid, spillRoot: "./data" });

        expect(loadServerConfig(file, {}).spillRoot).toBe(path.join(path.dirname(file), "data"));
    });

    it("refuses a setting it does not know, at the top and inside a queue", () => {
        expect(() => loadServerConfig(writeConfig({ ...valid, port: 1 }), {})).toThrow(/Unknown setting "port"/);
        expect(() => loadServerConfig(writeConfig({ ...valid, queues: { a: { publishToken: "p", pullToken: "q", messageTtl: 5 } } }), {}))
            .toThrow(/Unknown setting "messageTtl" in queue "a"/);
    });

    it("refuses ports that are not whole numbers and a missing queues object", () => {
        expect(() => loadServerConfig(writeConfig({ ...valid, publishPort: "7001" }), {})).toThrow(/publishPort/);
        expect(() => loadServerConfig(writeConfig({ publishPort: 1, pullPort: 2 }), {})).toThrow(/queues/);
        expect(() => loadServerConfig(writeConfig({ ...valid, queues: {} }), {})).toThrow(/queues/);
    });

    it("refuses a file that is missing, not JSON, or not an object", () => {
        expect(() => loadServerConfig("/no/such/file.json", {})).toThrow(ConfigError);
        expect(() => loadServerConfig(writeConfig("{not json"), {})).toThrow(ConfigError);
        expect(() => loadServerConfig(writeConfig("[1]"), {})).toThrow(/JSON object/);
    });
});
