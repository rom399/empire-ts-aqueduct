import { ConsoleLogger, Empire, ILogger } from "empire-ts";
import { QueueRegistry, resolveQueueSettings } from "empire-ts-aqueduct-core";
import { BearerToken } from "./auth/BearerToken";
import { QueueTokens } from "./auth/QueueTokens";
import { PublishRoutes } from "./http/PublishRoutes";
import { PullRoutes } from "./http/PullRoutes";
import { ServerState } from "./http/ServerState";
import { publishBodyLimit } from "./publishBodyLimit";
import { QueueServerOptions } from "./QueueServerOptions";

const LOOPBACK_HOST = "127.0.0.1";

/** How long a stopping port waits for requests in flight. */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * The broker: named queues behind two Empire apps in one process, a **publish**
 * port for producers and a **pull** port for consumers (and, with an admin token,
 * operators).
 *
 * `start()` restores any saved queues before either port opens. `stop()` closes the
 * queues first: it refuses new work, releases consumers waiting on a long-poll so
 * the ports can drain at once, and saves queues that have `persist` on.
 */
export class QueueServer {
    private readonly logger: ILogger;
    private readonly state = new ServerState();
    private readonly queueRegistry: QueueRegistry;
    private readonly publishApp: Empire;
    private readonly pullApp: Empire;
    private readonly host: string;
    private started = false;

    /** Builds the queues and both apps. Throws if a setting or token is missing or wrong, before anything listens. */
    constructor(private readonly options: QueueServerOptions) {
        this.logger = options.logger ?? new ConsoleLogger();
        this.host = options.host ?? LOOPBACK_HOST;

        if (options.publishPort === options.pullPort) {
            throw new Error("publishPort and pullPort must be different ports.");
        }

        const queueNames = Object.keys(options.queues);

        if (queueNames.length === 0) {
            throw new Error("At least one queue must be declared.");
        }

        const tokens = this.buildTokens(options);
        const adminToken = options.adminToken === undefined ? undefined : new BearerToken(options.adminToken, "admin");

        this.checkTokensAreDistinct(tokens, adminToken);

        const queueSettings = queueNames.map((name) => resolveQueueSettings(name, options.queues[name], options.spillRoot));

        this.queueRegistry = new QueueRegistry({
            queues: Object.fromEntries(queueNames.map((name) => [name, withoutTokens(options.queues[name])])),
            spillRoot: options.spillRoot,
            sweepIntervalMs: options.sweepIntervalMs,
            logger: this.logger,
        });

        const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

        this.publishApp = new Empire({
            host: this.host,
            port: options.publishPort,
            logger: this.logger,
            maxBodySize: publishBodyLimit(queueSettings),
            shutdownTimeoutMs,
        });

        // Take and acknowledge bodies are tiny.
        this.pullApp = new Empire({ host: this.host, port: options.pullPort, logger: this.logger, shutdownTimeoutMs });

        new PublishRoutes(this.queueRegistry, tokens, this.state).register(this.publishApp);
        new PullRoutes(this.queueRegistry, tokens, adminToken, this.state).register(this.pullApp);
    }

    /** The queues, for in-process use alongside the ports. */
    get registry(): QueueRegistry {
        return this.queueRegistry;
    }

    get publishUrl(): string {
        return `http://${this.host}:${this.options.publishPort}`;
    }

    get pullUrl(): string {
        return `http://${this.host}:${this.options.pullPort}`;
    }

    /** Restores saved queues, then opens both ports. If a port cannot open, everything is closed again and the error is thrown. */
    async start(): Promise<void> {
        if (this.started) {
            throw new Error("This broker is already running.");
        }

        this.started = true;

        if (this.host !== LOOPBACK_HOST && this.host !== "localhost" && this.host !== "::1") {
            this.logger.warn(`The queue broker is listening on ${this.host}. Tokens are sent in the clear; put TLS in front of it.`);
        }

        try {
            this.queueRegistry.start();
            await this.publishApp.start();
            await this.pullApp.start();
            this.state.open();
        } catch (error) {
            await this.stop();
            throw error;
        }
    }

    /** Closes the queues, saves those that persist, and stops both ports. Safe to call twice. */
    async stop(): Promise<void> {
        if (!this.started) {
            return;
        }

        this.started = false;
        this.state.close();

        // Queues first: this releases long-polls, which would otherwise hold the ports open until the shutdown timeout.
        this.queueRegistry.dispose();

        const results = await Promise.allSettled([this.publishApp.stop(), this.pullApp.stop()]);

        for (const result of results) {
            if (result.status === "rejected") {
                this.logger.error("A port did not stop cleanly.", result.reason);
            }
        }
    }

    private buildTokens(options: QueueServerOptions): Map<string, QueueTokens> {
        const tokens = new Map<string, QueueTokens>();

        for (const [name, queue] of Object.entries(options.queues)) {
            tokens.set(name, {
                publish: new BearerToken(queue.publishToken, `publish (queue "${name}")`),
                pull: new BearerToken(queue.pullToken, `pull (queue "${name}")`),
            });
        }

        return tokens;
    }

    /** A pull token that also publishes, or a publish token that also administers, defeats having separate ports. */
    private checkTokensAreDistinct(tokens: Map<string, QueueTokens>, adminToken: BearerToken | undefined): void {
        const all: BearerToken[] = [];

        for (const pair of tokens.values()) {
            all.push(pair.publish, pair.pull);
        }

        if (adminToken) {
            all.push(adminToken);
        }

        for (const [index, token] of all.entries()) {
            for (const other of all.slice(index + 1)) {
                if (token.sameSecretAs(other)) {
                    throw new Error(`The ${token.purpose} token and the ${other.purpose} token are the same. Every token must be different.`);
                }
            }
        }
    }
}

function withoutTokens<T extends { publishToken: string; pullToken: string }>(queue: T): Omit<T, "publishToken" | "pullToken"> {
    const { publishToken: _publishToken, pullToken: _pullToken, ...settings } = queue;

    return settings;
}
