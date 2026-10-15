/**
 * One-command demo of the lb-telemetry example: starts the queue broker, the telemetry hub,
 * the load balancer, three backends and a traffic generator, prefixes each
 * one's output with its name, and stops them all on Ctrl-C.
 *
 *   npm run setup      once: installs what the demo needs and builds the dashboard
 *   npm run demo       starts everything; open http://localhost:8012/admin/
 *   npm run demo -- --no-traffic    the same without the traffic generator
 *
 * It starts exactly the processes the header of examples/lb-telemetry/server.ts
 * lists, in the same order, so nothing here is special - it only saves the
 * seven terminals. Each one runs under tsx from its own package folder.
 */

import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import process from "process";

const HUB_DIR = path.resolve(__dirname, "..");
const ROOT_DIR = path.resolve(HUB_DIR, "..", "..");
const EXAMPLE_DIR = path.join(ROOT_DIR, "examples", "lb-telemetry");
const BROKER_DIR = path.join(ROOT_DIR, "packages", "server");

const READY_TIMEOUT_MS = 40_000;
const STOP_GRACE_MS = 20_000;
const SETTLE_BEFORE_TRAFFIC_MS = 3_000;

interface Part {
    name: string;
    cwd: string;
    args: string[];
    /** Where to look to know it is up. Omit for a part nobody waits on. */
    ready?: { url: string };
}

const withTraffic = !process.argv.includes("--no-traffic");

const parts: Part[] = [
    { name: "broker", cwd: BROKER_DIR, args: ["src/cli.ts", "--config", path.join(EXAMPLE_DIR, "telemetry-broker.json")], ready: { url: "http://127.0.0.1:7121/health" } },
    { name: "hub", cwd: HUB_DIR, args: ["src/cli.ts", "all", "--config", "config/hub.example.json"], ready: { url: "http://127.0.0.1:7130/api/health" } },
    { name: "balancer", cwd: EXAMPLE_DIR, args: [`server.ts`], ready: { url: "http://127.0.0.1:8012/health" } },
    { name: "alpha", cwd: EXAMPLE_DIR, args: [`backend.ts`, "alpha", "8021"] },
    { name: "beta", cwd: EXAMPLE_DIR, args: [`backend.ts`, "beta", "8022", "40"] },
    { name: "gamma", cwd: EXAMPLE_DIR, args: [`backend.ts`, "gamma", "8023", "120"] },
];

const traffic: Part = { name: "traffic", cwd: EXAMPLE_DIR, args: [`traffic.ts`] };

const running: ChildProcess[] = [];
let stopping = false;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function missingSetup(): string[] {
    const problems: string[] = [];
    const needsModules: Array<[string, string]> = [
        [HUB_DIR, "monitoring"],
        [BROKER_DIR, "server"],
        [EXAMPLE_DIR, "examples/lb-telemetry"],
    ];

    for (const [dir, label] of needsModules) {
        if (!fs.existsSync(path.join(dir, "node_modules"))) {
            problems.push(`${label} has no node_modules`);
        }
    }

    if (!fs.existsSync(path.join(HUB_DIR, "web", "dist", "index.html"))) {
        problems.push("the dashboard is not built (web/dist)");
    }

    return problems;
}

function isListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.connect({ port, host: "127.0.0.1" });
        socket.once("connect", () => { socket.destroy(); resolve(true); });
        socket.once("error", () => resolve(false));
    });
}

async function isUp(url: string): Promise<boolean> {
    try {
        // Any answer counts: the balancer's /health says 503 until a backend has registered.
        const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
        await res.arrayBuffer();
        return true;
    } catch {
        return false;
    }
}

function prefixLines(name: string, stream: NodeJS.ReadableStream, sink: NodeJS.WriteStream): void {
    let pending = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
        const lines = (pending + chunk).split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
            sink.write(`[${name}] ${line}\n`);
        }
    });
    stream.on("end", () => { if (pending) { sink.write(`[${name}] ${pending}\n`); } });
}

function start(part: Part): ChildProcess {
    // The hub's own tsx runs every part, so the other packages need no tsx of their own.
    const tsxCli = require.resolve("tsx/cli");
    const child = spawn(process.execPath, [tsxCli, ...part.args], { cwd: part.cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });

    prefixLines(part.name, child.stdout, process.stdout);
    prefixLines(part.name, child.stderr, process.stderr);
    running.push(child);

    child.once("exit", (code, signal) => {
        if (!stopping) {
            console.error(`[demo] ${part.name} stopped on its own (${signal ?? `exit ${code}`}); stopping the rest.`);
            void stop(1);
        }
    });

    return child;
}

async function waitUntilReady(part: Part): Promise<void> {
    if (!part.ready) {
        return;
    }

    const deadline = Date.now() + READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
        if (stopping) {
            return;
        }

        if (await isUp(part.ready.url)) {
            return;
        }

        await sleep(300);
    }

    throw new Error(`${part.name} did not answer at ${part.ready.url} within ${READY_TIMEOUT_MS / 1000} s`);
}

async function stop(code: number): Promise<void> {
    if (stopping) {
        return;
    }

    stopping = true;
    console.log("\n[demo] stopping...");

    // Newest first - traffic, backends, balancer, hub, broker - so the hub can drain the last events before the broker goes.
    const forced = setTimeout(() => {
        for (const child of running) {
            child.kill("SIGKILL");
        }
    }, STOP_GRACE_MS);

    for (const child of [...running].reverse()) {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
            child.kill("SIGINT");
            await exited;
        }
    }

    clearTimeout(forced);
    process.exit(code);
}

async function main(): Promise<void> {
    const problems = missingSetup();

    if (problems.length > 0) {
        console.error(`[demo] Not set up yet: ${problems.join("; ")}.\n[demo] Run this once, then try again:  npm run setup`);
        process.exit(1);
    }

    for (const port of [7121, 7122, 7130, 8012, 8021, 8022, 8023]) {
        if (await isListening(port)) {
            console.error(`[demo] Port ${port} is already in use - is an earlier demo (or the real thing) still running? Stop it and try again.`);
            process.exit(1);
        }
    }

    process.on("SIGINT", () => { void stop(0); });
    process.on("SIGTERM", () => { void stop(0); });

    for (const part of parts) {
        console.log(`[demo] starting ${part.name}`);
        start(part);
        await waitUntilReady(part);
    }

    if (withTraffic) {
        await sleep(SETTLE_BEFORE_TRAFFIC_MS);
        console.log("[demo] starting traffic");
        start(traffic);
    }

    console.log("\n[demo] Everything is running. Open  http://localhost:8012/admin/\n[demo] Ctrl-C stops it all.\n");
}

main().catch((err: unknown) => {
    console.error(`[demo] ${err instanceof Error ? err.message : String(err)}`);
    void stop(1);
});
