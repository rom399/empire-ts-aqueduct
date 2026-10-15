import { afterEach } from "vitest";
import { QueueServer } from "../../../src/QueueServer";
import { QueueServerOptions } from "../../../src/QueueServerOptions";
import { QueueServerQueueOptions } from "../../../src/QueueServerQueueOptions";
import { TestLogger } from "../logging/TestLogger";
import { getFreePort } from "../ports/getFreePort";

export const PUBLISH_TOKEN = "publish-secret";
export const PULL_TOKEN = "pull-secret";
export const ADMIN_TOKEN = "admin-secret";

export interface RunningBroker {
    server: QueueServer;
    logger: TestLogger;
    publishUrl: string;
    pullUrl: string;
    options: QueueServerOptions;
}

const started: QueueServer[] = [];

afterEach(async () => {
    await Promise.all(started.splice(0).map((server) => server.stop()));
});

/** The queue most tests use, with the tokens above. */
export function testQueue(overrides: Partial<QueueServerQueueOptions> = {}): QueueServerQueueOptions {
    return { publishToken: PUBLISH_TOKEN, pullToken: PULL_TOKEN, ...overrides };
}

/** Starts a broker on two free ports. It is stopped after the test. */
export async function startBroker(overrides: Partial<QueueServerOptions> = {}): Promise<RunningBroker> {
    const logger = new TestLogger();

    const options: QueueServerOptions = {
        publishPort: await getFreePort(),
        pullPort: await getFreePort(),
        adminToken: ADMIN_TOKEN,
        queues: { telemetry: testQueue() },
        logger,
        shutdownTimeoutMs: 1000,
        ...overrides,
    };

    const server = new QueueServer(options);

    started.push(server);
    await server.start();

    return { server, logger, publishUrl: server.publishUrl, pullUrl: server.pullUrl, options };
}
