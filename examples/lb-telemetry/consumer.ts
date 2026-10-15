/**
 * 12 - Load balancer: a telemetry consumer (optional)
 *
 * The telemetry hub already drains this queue into its database and dashboard;
 * this script is the smallest possible consumer, for seeing the events as text.
 * Run it only when the hub is not running, or the two compete for the items
 * (each item goes to exactly one of them).
 *
 * It reads the "lb-telemetry" queue from the broker and prints what the balancer
 * and the backends published: a line for every request and lifecycle event,
 * and every few seconds a summary of requests per backend. It uses plain
 * `fetch` against the broker's pull port (take, then acknowledge), so it needs
 * nothing from the queue packages. A real consumer would use empire-ts-aqueduct-client.
 *
 * Run: npx tsx examples/12-load-balancer/consumer.ts [quiet]
 *   e.g. npx tsx examples/12-load-balancer/consumer.ts          # every event, plus summaries
 *        npx tsx examples/12-load-balancer/consumer.ts quiet    # summaries only
 *
 * Heartbeats (loadbalancer.leaseRenewed) are counted but not printed line by
 * line; there is one per backend every second or so.
 */

import process from "process";
import { BROKER_PULL_URL, TELEMETRY_PULL_TOKEN, TELEMETRY_QUEUE } from "./telemetryConfig";

const TAKE_BATCH = 50;
const WAIT_MS = 5000;
const SUMMARY_EVERY_MS = 5000;
const RETRY_PAUSE_MS = 2000;
const quiet = process.argv[2] === "quiet";

/** The parts of a delivered item this consumer reads. */
interface ReceivedItem {
    type: string;
    source?: string;
    sequence: number;
    createdAt: number;
    payload: Record<string, unknown>;
}

interface TakeReply {
    batchId: string | null;
    items: ReceivedItem[];
}

const counts = new Map<string, number>();
const statusCounts = new Map<string, number>();
let received = 0;
let heartbeats = 0;
let running = true;

async function post<T>(path: string, body: unknown): Promise<T | undefined> {
    const response = await fetch(`${BROKER_PULL_URL}/v1/queues/${TELEMETRY_QUEUE}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TELEMETRY_PULL_TOKEN}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(WAIT_MS + 5000),
    });

    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`broker answered ${response.status} to ${path}`);
    }

    return (await response.json().catch(() => undefined)) as T | undefined;
}

function describe(item: ReceivedItem): string {
    const p = item.payload;
    const time = new Date(item.createdAt).toISOString().slice(11, 23);
    const who = item.source ?? "?";

    switch (item.type) {
        case "loadbalancer.dispatched":
            return `${time} ${who}  dispatched ${String(p.method)} ${String(p.path)} -> ${String(p.backendId)}`;
        case "loadbalancer.completed":
            return `${time} ${who}  completed  ${String(p.route ?? p.backendId)} ${String(p.status)} in ${String(p.durationMs)} ms (${String(p.backendId)})`;
        case "backend.request":
            return `${time} ${who}  served     ${String(p.method)} ${String(p.route ?? p.path)} ${String(p.status)} in ${String(p.durationMs)} ms${p.aborted ? " (client left)" : ""}`;
        default:
            return `${time} ${who}  ${item.type.replace(/^loadbalancer\./, "")} ${JSON.stringify(p)}`;
    }
}

function record(item: ReceivedItem): void {
    received++;

    if (item.type === "loadbalancer.leaseRenewed") {
        heartbeats++;
        return;
    }

    if (item.type === "loadbalancer.completed") {
        const backend = String(item.payload.backendId);
        counts.set(backend, (counts.get(backend) ?? 0) + 1);
        const status = `${Math.floor(Number(item.payload.status) / 100)}xx`;
        statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    }

    if (!quiet) {
        console.log(describe(item));
    }
}

function byName(a: [string, number], b: [string, number]): number {
    return a[0].localeCompare(b[0]);
}

function printSummary(): void {
    const perBackend = [...counts].sort(byName).map(([backend, n]) => `${backend} ${n}`).join("  ") || "none yet";
    const statuses = [...statusCounts].sort(byName).map(([status, n]) => `${status} ${n}`).join("  ") || "-";

    console.log(`--- ${received} items | completed per backend: ${perBackend} | statuses: ${statuses} | heartbeats: ${heartbeats}`);
}

async function pause(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
    console.log(`Reading "${TELEMETRY_QUEUE}" from ${BROKER_PULL_URL} - Ctrl-C to stop`);
    const summaryTimer = setInterval(printSummary, SUMMARY_EVERY_MS);

    process.on("SIGINT", () => {
        running = false;
        clearInterval(summaryTimer);
        printSummary();
        process.exit(0);
    });

    while (running) {
        try {
            const reply = await post<TakeReply>("take", { maxItems: TAKE_BATCH, waitMs: WAIT_MS });

            if (!reply?.batchId) {
                continue;
            }

            // Acknowledge first, then process: the broker delivers each batch once.
            await post("ack", { batchId: reply.batchId });
            reply.items.forEach(record);
        } catch (err) {
            console.error(`Broker not reachable (${err instanceof Error ? err.message : String(err)}); retrying...`);
            await pause(RETRY_PAUSE_MS);
        }
    }
}

void run();
