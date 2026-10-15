import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError } from "../../src/config/ConfigError";
import { loadHubConfig } from "../../src/config/loadHubConfig";
import { makeTempDir } from "../fixtures/helpers";

describe("loadHubConfig", () => {
    let temp: ReturnType<typeof makeTempDir>;
    const write = (value: unknown): string => {
        const file = path.join(temp.dir, "hub.json");
        fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
        return file;
    };
    const minimal = { broker: { pullUrl: "http://b:1", queue: "q", pullToken: "t" } };

    beforeEach(() => { temp = makeTempDir(); });
    afterEach(() => temp.remove());

    it("applies defaults and resolves paths against the config file, not the working directory", () => {
        const config = loadHubConfig(write(minimal), {});

        expect(config.dbPath).toBe(path.join(temp.dir, "data", "telemetry.db"));
        expect(config.server).toEqual({ host: "127.0.0.1", port: 7130, webRoot: path.resolve(temp.dir, "../web/dist") });
        expect(config.retentionMs).toBe(24 * 3_600_000);
        expect(config.broker.adminToken).toBeUndefined();
    });

    it("reads secrets from the environment when written as { env }", () => {
        const config = loadHubConfig(write({ broker: { ...minimal.broker, pullToken: { env: "PULL" }, adminToken: { env: "ADMIN" } } }), { PULL: "p", ADMIN: "a" });

        expect(config.broker).toMatchObject({ pullToken: "p", adminToken: "a" });
    });

    it("names the missing variable", () => {
        expect(() => loadHubConfig(write({ broker: { ...minimal.broker, pullToken: { env: "NOPE" } } }), {})).toThrow(/NOPE/);
    });

    it.each([
        ["a missing file", "/definitely/not/here.json"],
        ["invalid JSON", "{ nope"],
        ["no broker", {}],
        ["a bad port", { ...minimal, server: { port: 70000 } }],
        ["a non-numeric retention", { ...minimal, retentionHours: "a day" }],
        ["an empty queue name", { broker: { ...minimal.broker, queue: "" } }],
    ])("rejects %s with a clear error", (_name, input) => {
        const file = typeof input === "string" && input.startsWith("/") ? input : write(input);

        expect(() => loadHubConfig(file, {})).toThrow(ConfigError);
    });
});
