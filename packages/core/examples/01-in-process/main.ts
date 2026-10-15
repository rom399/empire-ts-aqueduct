/**
 * In-process queue: no HTTP, no ports. A producer publishes, a consumer takes
 * a batch, acknowledges it, and then processes it.
 *
 * Run it: npx tsx examples/01-in-process/main.ts
 */
import { QueueRegistry, SilentQueueLogger } from "../../src";

async function main(): Promise<void> {
    const registry = new QueueRegistry({
        queues: { jobs: { overflow: "reject", maxSize: 1000 } },
        logger: new SilentQueueLogger(),
    });

    registry.start();

    const jobs = registry.get("jobs");

    // A batch publish gives one result per item. It is not all-or-nothing.
    const results = jobs.publishBatch([
        { type: "email.send", payload: { to: "a@example.com" }, createdAt: Date.now() },
        { type: "email.send", payload: { to: "b@example.com" }, createdAt: Date.now() },
        { type: "email.send" }, // invalid: no payload or createdAt
    ]);

    console.log("publish results:", results.map((result) => (result.accepted ? `accepted #${result.sequence}` : `rejected (${result.reason})`)));

    // Take up to 10 items. Fewer are returned at once if fewer are waiting.
    const batch = await jobs.take(10);

    // Acknowledge receipt straight away. After this the items are the consumer's.
    if (batch.batchId) {
        jobs.acknowledge(batch.batchId);
    }

    for (const item of batch.items) {
        console.log(`processing #${item.sequence} ${item.type} (delivery ${item.deliveryCount})`, item.payload);
    }

    console.log("stats:", jobs.stats());

    registry.dispose();
}

void main();
