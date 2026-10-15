import { ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { call } from "../fixtures/http/call";
import { getFreePort } from "../fixtures/ports/getFreePort";

const CLI = path.join(__dirname, "..", "..", "src", "cli.ts");
const TSX = require.resolve("tsx/cli");

const folders: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
    children.splice(0).forEach((child) => child.kill("SIGKILL"));

    for (const folder of folders.splice(0)) {
        fs.rmSync(folder, { recursive: true, force: true });
    }
});

interface CliRun {
    child: ChildProcess;
    output: () => string;
    exited: Promise<number | null>;
}

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): CliRun {
    const child = spawn(process.execPath, [TSX, CLI, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";

    children.push(child);
    child.stdout?.on("data", (chunk: Buffer) => { text += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { text += chunk.toString(); });

    return { child, output: () => text, exited: new Promise((resolve) => child.once("exit", (code) => resolve(code))) };
}

async function waitForOutput(run: CliRun, fragment: string, timeoutMs: number = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (!run.output().includes(fragment)) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for "${fragment}". Output so far:\n${run.output()}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

describe("the command line", () => {
    it("prints usage for --help and exits 0", async () => {
        const run = runCli(["--help"]);

        expect(await run.exited).toBe(0);
        expect(run.output()).toContain("Usage:");
    });

    it("exits 2 with the usage when no config is given", async () => {
        const run = runCli([]);

        expect(await run.exited).toBe(2);
        expect(run.output()).toContain("A config file is required");
    });

    it("exits 2 and says what is wrong with an unusable config", async () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), "empire-queue-cli-"));
        folders.push(folder);
        const file = path.join(folder, "queues.json");

        fs.writeFileSync(file, JSON.stringify({ publishPort: 1, pullPort: 2, queues: { a: { publishToken: "x", pullToken: "y", messageTtl: 5 } } }));

        const run = runCli(["--config", file]);

        expect(await run.exited).toBe(2);
        expect(run.output()).toContain('Unknown setting "messageTtl"');
    });

    // Windows cannot deliver SIGTERM to a Node process as a signal; it just ends it.
    it.skipIf(process.platform === "win32")("starts from a config file, serves, and saves persisting queues on SIGTERM", async () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), "empire-queue-cli-"));
        folders.push(folder);
        const file = path.join(folder, "queues.json");
        const publishPort = await getFreePort();
        const pullPort = await getFreePort();

        fs.writeFileSync(file, JSON.stringify({
            publishPort,
            pullPort,
            spillRoot: "./data",
            queues: { jobs: { publishToken: { env: "TEST_PUBLISH" }, pullToken: "pull-token", persist: true } },
        }));

        const run = runCli(["--config", file], { TEST_PUBLISH: "publish-token" });

        await waitForOutput(run, "Queue broker ready");

        const published = await call(`http://127.0.0.1:${publishPort}`, "/v1/queues/jobs/items", {
            method: "POST", token: "publish-token", body: { type: "t", payload: { n: 1 }, createdAt: 1 },
        });

        expect(published.status).toBe(201);

        run.child.kill("SIGTERM");

        expect(await run.exited).toBe(0);
        expect(run.output()).toContain("saved 1 items to disk");
        expect(fs.existsSync(path.join(folder, "data", "jobs", "state.json"))).toBe(true);
    });
});
