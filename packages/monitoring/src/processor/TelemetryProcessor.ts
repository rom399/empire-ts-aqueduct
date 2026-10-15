import { ConsoleLogger, ILogger } from "empire-ts";
import { QueueClient } from "empire-ts-aqueduct-client";
import { EventWriter } from "../db/EventWriter";
import { ProcessorStatusStore } from "../db/ProcessorStatusStore";
import { QueueSampleStore } from "../db/QueueSampleStore";
import { RetentionSweeper } from "../db/RetentionSweeper";
import { TelemetryDatabase } from "../db/TelemetryDatabase";
import { QueueStatsPoller } from "./QueueStatsPoller";
import { TelemetryProcessorOptions } from "./TelemetryProcessorOptions";

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_WAIT_MS = 5000;
const DEFAULT_SAMPLE_INTERVAL_MS = 2000;
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15_000;
const SHUTDOWN_GRACE_MS = 6000;

/**
 * Drains the telemetry queue into the database, and samples the queue itself.
 *
 * - **Drain loop**: take a batch, store it in one transaction, and only then
 *   acknowledge it. If the process dies between the two, the broker hands the
 *   batch out again and the database skips the items it already has, so a crash
 *   duplicates nothing and loses nothing that reached the broker.
 * - **Sampler**: every few seconds, read the queue's depth, in-flight count and
 *   counters from the broker's admin API and store them, so the queue's history
 *   is in the database too.
 * - **Sweeper**: delete rows older than the retention period.
 *
 * It is the only writer. The web server only reads.
 */
export class TelemetryProcessor {
    readonly db: TelemetryDatabase;
    private readonly logger: ILogger;
    private readonly client: QueueClient;
    private readonly writer: EventWriter;
    private readonly status: ProcessorStatusStore;
    private readonly samples: QueueSampleStore;
    private readonly sweeper: RetentionSweeper;
    private readonly poller: QueueStatsPoller | undefined;
    private readonly batchSize: number;
    private readonly waitMs: number;
    private readonly sampleIntervalMs: number;
    private readonly sweepIntervalMs: number;
    private readonly initialBackoffMs: number;

    private stopping = new AbortController();
    private timers: NodeJS.Timeout[] = [];
    private loop: Promise<void> | undefined;
    private lastSampleError = "";

    constructor(private readonly options: TelemetryProcessorOptions) {
        this.logger = options.logger ?? new ConsoleLogger();
        this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
        this.waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
        this.sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
        this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
        this.initialBackoffMs = options.initialBackoffMs ?? INITIAL_BACKOFF_MS;

        this.db = new TelemetryDatabase(options.dbPath);
        this.client = new QueueClient({ url: options.brokerPullUrl, queue: options.queue, token: options.pullToken });
        this.writer = new EventWriter(this.db);
        this.status = new ProcessorStatusStore(this.db);
        this.samples = new QueueSampleStore(this.db);
        this.sweeper = new RetentionSweeper(this.db, options.retentionMs ?? DEFAULT_RETENTION_MS);
        this.poller = options.adminToken === undefined
            ? undefined
            : new QueueStatsPoller(options.brokerPullUrl, options.queue, options.adminToken);
    }

    start(): void {
        if (this.loop !== undefined) {
            throw new Error("The processor is already running.");
        }

        this.stopping = new AbortController();
        this.status.markStarted();
        this.loop = this.drain();

        if (this.poller === undefined) {
            this.logger.warn("No admin token configured: the queue will be drained but not sampled.");
        } else {
            this.timers.push(setInterval(() => void this.sample(), this.sampleIntervalMs));
            void this.sample();
        }

        this.timers.push(setInterval(() => this.sweep(), this.sweepIntervalMs));
        this.timers.forEach((timer) => timer.unref());
        this.logger.info(`Telemetry processor draining "${this.options.queue}" from ${this.options.brokerPullUrl} into ${this.options.dbPath}`);
    }

    /** Finishes the batch in hand, then closes the database. */
    async stop(): Promise<void> {
        this.timers.forEach(clearInterval);
        this.timers = [];
        this.stopping.abort();

        const loop = this.loop;
        this.loop = undefined;

        if (loop !== undefined) {
            await Promise.race([loop, new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS).unref())]);
        }

        this.db.close();
    }

    private async drain(): Promise<void> {
        let backoffMs = this.initialBackoffMs;
        const signal = this.stopping.signal;

        while (!signal.aborted) {
            try {
                const batch = await this.client.take(this.batchSize, { waitMs: this.waitMs, signal });
                this.status.markPolled();
                backoffMs = this.initialBackoffMs;

                if (batch.batchId === null || batch.items.length === 0) {
                    continue;
                }

                const result = this.writer.storeBatch(batch.items);
                this.status.markStored(result.stored, result.duplicates);

                if (result.invalid > 0) {
                    this.logger.warn(`${result.invalid} malformed item(s) were skipped.`);
                }

                if (result.projectionErrors > 0) {
                    this.logger.warn(`${result.projectionErrors} event(s) were stored but could not update the summary tables.`);
                }

                // Acknowledge only after the commit: a crash before this line means redelivery, never loss.
                const acknowledged = await this.client.acknowledge(batch.batchId);

                if (!acknowledged) {
                    this.logger.warn("The broker no longer knew the batch (acknowledged too late); the items will come back and be skipped as duplicates.");
                }
            } catch (err) {
                if (signal.aborted) {
                    return;
                }

                const message = err instanceof Error ? err.message : String(err);
                this.status.markError(message);
                this.logger.warn(`Draining failed (${message}); retrying in ${Math.round(backoffMs / 1000)} s.`);
                await sleep(backoffMs, signal);
                backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
            }
        }
    }

    private async sample(): Promise<void> {
        try {
            this.samples.save(await this.poller!.poll());
            this.lastSampleError = "";
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);

            // One line per distinct problem, not one per poll.
            if (message !== this.lastSampleError) {
                this.logger.warn(`Could not sample the queue: ${message}`);
                this.lastSampleError = message;
            }
        }
    }

    private sweep(): void {
        try {
            const deleted = this.sweeper.sweep(Date.now());

            if (deleted > 0) {
                this.logger.info(`Retention sweep removed ${deleted} old row(s).`);
            }
        } catch (err) {
            this.logger.warn(`Retention sweep failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}
