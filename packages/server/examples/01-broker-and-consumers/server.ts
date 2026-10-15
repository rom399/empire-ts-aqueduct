/**
 * A broker with two queues, one producer and three consumers, all in one process
 * so you can see it work. In real use the broker, the producers and the consumers
 * are separate processes.
 *
 * - `telemetry` has two consumers that compete: each item goes to exactly one of them.
 * - `emails` has one consumer.
 *
 * Run it: npx tsx examples/01-broker-and-consumers/server.ts
 */
import { QueueConsumer } from "empire-ts-aqueduct-client";
import { QueueServer } from "../../src";

const HOST = "127.0.0.1";
const PUBLISH_PORT = 7101;
const PULL_PORT = 7102;

async function main(): Promise<void> {
    const server = new QueueServer({
        host: HOST,
        publishPort: PUBLISH_PORT,
        pullPort: PULL_PORT,
        adminToken: "admin-token-for-the-example",
        queues: {
            telemetry: { publishToken: "telemetry-publish", pullToken: "telemetry-pull", overflow: "drop-oldest", maxSize: 1000 },
            emails: { publishToken: "emails-publish", pullToken: "emails-pull", overflow: "reject", maxSize: 100 },
        },
    });

    await server.start();

    const processed: string[] = [];
    const consumers = [
        consumerFor("telemetry", "telemetry-pull", "worker A", processed),
        consumerFor("telemetry", "telemetry-pull", "worker B", processed),
        consumerFor("emails", "emails-pull", "mailer", processed),
    ];

    consumers.forEach((consumer) => consumer.start());

    // Producers: a batch of telemetry events and a pair of emails.
    await publish("telemetry", "telemetry-publish", Array.from({ length: 6 }, (_, n) => ({
        type: "request.completed", payload: { route: "/orders", ms: 10 + n }, createdAt: Date.now(),
    })));
    await publish("emails", "emails-publish", [
        { type: "email.send", payload: { to: "a@example.com" }, createdAt: Date.now() },
        { type: "email.send", payload: { to: "b@example.com" }, createdAt: Date.now() },
    ]);

    while (processed.length < 8) {
        await new Promise((resolve) => setTimeout(resolve, 20));
    }

    processed.forEach((line) => console.log(line));

    await Promise.all(consumers.map((consumer) => consumer.stop()));
    await server.stop();
}

function consumerFor(queue: string, token: string, name: string, processed: string[]): QueueConsumer {
    return new QueueConsumer({
        url: `http://${HOST}:${PULL_PORT}`,
        queue,
        token,
        batchSize: 2,
        waitMs: 2000,
        handler: async (item) => {
            processed.push(`${name} handled ${queue} #${item.sequence} ${JSON.stringify(item.payload)}`);
        },
    });
}

async function publish(queue: string, token: string, items: unknown[]): Promise<void> {
    const response = await fetch(`http://${HOST}:${PUBLISH_PORT}/v1/queues/${queue}/items`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(items),
    });

    console.log(`published ${items.length} to ${queue}: HTTP ${response.status}`);
}

void main();
