import fs from "node:fs";
import path from "node:path";
import { ConsoleLogger, Empire, ILogger } from "empire-ts";
import { TelemetryDatabase } from "../db/TelemetryDatabase";
import { TelemetryQueries } from "../db/TelemetryQueries";
import { ApiRoutes } from "./ApiRoutes";
import { HubServerOptions } from "./HubServerOptions";
import { LiveStream } from "./LiveStream";

const DEFAULT_PORT_HOST = "127.0.0.1";
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIVE_POLL_MS = 250;
const SHUTDOWN_TIMEOUT_MS = 3000;

/**
 * The web server: the dashboard's static files and the JSON/SSE API behind
 * them. It only reads the database; the processor is the only writer.
 */
export class HubServer {
    private readonly app: Empire;
    private readonly db: TelemetryDatabase;
    private readonly live: LiveStream;
    private readonly logger: ILogger;
    private started = false;

    constructor(private readonly options: HubServerOptions) {
        this.logger = options.logger ?? new ConsoleLogger();
        this.db = new TelemetryDatabase(options.dbPath);

        const queries = new TelemetryQueries(this.db, options.retentionMs ?? DEFAULT_RETENTION_MS);
        this.live = new LiveStream(queries.events, queries.queue, options.livePollMs ?? DEFAULT_LIVE_POLL_MS);

        this.app = new Empire({
            host: options.host ?? DEFAULT_PORT_HOST,
            port: options.port,
            shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
            logger: this.logger,
        });

        new ApiRoutes(queries, this.live).register(this.app);
        this.serveDashboard();
    }

    async start(): Promise<void> {
        await this.app.start();
        this.started = true;
    }

    /** Safe to call more than once, and before start(). */
    async stop(): Promise<void> {
        if (!this.started) {
            return;
        }

        this.started = false;

        // Open streams never finish by themselves; end them first so the app can drain.
        this.live.close();
        await this.app.stop();
        this.db.close();
    }

    private serveDashboard(): void {
        const root = this.options.webRoot === undefined ? undefined : path.resolve(this.options.webRoot);

        if (root !== undefined && fs.existsSync(path.join(root, "index.html"))) {
            this.app.useStaticFiles(root, { spaFallback: true });
            return;
        }

        this.logger.warn(`No built dashboard found${root ? ` at ${root}` : ""}; only the API (/api/...) is served. Build it with "npm run web:build".`);
    }
}
