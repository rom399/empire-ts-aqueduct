/**
 * A queue that spills to disk when nobody is consuming. Tiny sizes are used so
 * every tier fills with a handful of items. Order stays strict first-in
 * first-out across main, spill files and the in-memory buffer.
 *
 * Run it: npx tsx examples/02-spill-to-disk/main.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { QueueRegistry, SilentQueueLogger } from "../../src";

async function main(): Promise<void> {
    const spillRoot = fs.mkdtempSync(path.join(os.tmpdir(), "empire-queue-example-"));

    const registry = new QueueRegistry({
        spillRoot,
        logger: new SilentQueueLogger(),
        queues: {
            telemetry: {
                maxSize: 5,
                overflow: "spill",
                spillBufferSize: 4,
                spillBatchSize: 2,
                maxSpillFiles: 100,
            },
        },
    });

    registry.start();

    const telemetry = registry.get("telemetry");

    for (let n = 1; n <= 20; n++) {
        telemetry.publish({ type: "tick", payload: { n }, createdAt: Date.now() });
    }

    const { depth, buffered, spilledFiles, spilledItems } = telemetry.stats();

    console.log(`after 20 publishes with no consumer: main=${depth} buffer=${buffered} files=${spilledFiles} (${spilledItems} items)`);

    const order: number[] = [];

    for (;;) {
        const batch = await telemetry.take(3);

        if (!batch.batchId) {
            break;
        }

        telemetry.acknowledge(batch.batchId);
        order.push(...batch.items.map((item) => (item.payload as { n: number }).n));
    }

    console.log("consumed in order:", order.join(" "));

    registry.dispose();
    fs.rmSync(spillRoot, { recursive: true, force: true });
}

void main();
