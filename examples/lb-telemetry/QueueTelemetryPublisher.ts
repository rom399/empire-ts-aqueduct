import { QueueTelemetryPublisherOptions } from "./QueueTelemetryPublisherOptions";

/** One event in the broker's item format. */
interface TelemetryItem {
    type: string;
    payload: unknown;
    createdAt: number;
    source: string;
    correlationId?: string;
}

const DEFAULT_MAX_BATCH = 100;
const DEFAULT_MAX_BUFFERED = 5000;
const DEFAULT_FLUSH_INTERVAL_MS = 500;
const DEFAULT_REQUEST_TIMEOUT_MS = 2000;
const DEFAULT_WARN_INTERVAL_MS = 10_000;
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;
const SHUTDOWN_DEADLINE_MS = 3000;

/** Optional fields of one telemetry item. */
export interface TelemetryOptions {
    /** When it happened, in epoch milliseconds. Default: now. */
    at?: number;

    /** Ties items about the same request together across the balancer and a backend. */
    correlationId?: string;
}

/**
 * Sends telemetry events to a queue on a broker, so they leave the process
 * that produced them. The balancer sends what its LoadBalancerMonitor reports;
 * each backend sends what it serves.
 *
 * It uses plain `fetch` and knows the broker's wire format only: Empire has no
 * dependency on the queue packages and this example keeps it that way.
 *
 * Telemetry must never hurt the thing it describes, so the publisher is
 * failure tolerant. Events wait in a bounded buffer and go out in batches. If
 * the broker is down or full, the buffer grows to its limit and then drops the
 * oldest events, retrying with a growing pause; warnings are throttled so a
 * dead broker does not flood the log. Nothing here ever throws into its caller
 * or delays a proxied request.
 */
export class QueueTelemetryPublisher {
    private readonly publishUrl: string;
    private readonly maxBatch: number;
    private readonly maxBuffered: number;
    private readonly requestTimeoutMs: number;
    private readonly warnIntervalMs: number;
    private readonly flushTimer: NodeJS.Timeout;

    private buffer: TelemetryItem[] = [];
    private flushing = false;
    private disposed = false;
    private backoffMs = 0;
    private retryNotBefore = 0;
    private lastWarningAt = 0;

    private sentCount = 0;
    private droppedCount = 0;

    constructor(private readonly options: QueueTelemetryPublisherOptions) {
        this.publishUrl = `${options.brokerUrl.replace(/\/+$/, "")}/v1/queues/${encodeURIComponent(options.queueName)}/items`;
        this.maxBatch = options.maxBatch ?? DEFAULT_MAX_BATCH;
        this.maxBuffered = options.maxBuffered ?? DEFAULT_MAX_BUFFERED;
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.warnIntervalMs = options.warnIntervalMs ?? DEFAULT_WARN_INTERVAL_MS;

        this.flushTimer = setInterval(() => void this.flush(), options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
        // The forwarder alone must not keep the process alive.
        this.flushTimer.unref();
    }

    /** Events accepted by the broker so far. */
    get sent(): number {
        return this.sentCount;
    }

    /** Events thrown away: buffer overflow, or refused by the broker as invalid. */
    get dropped(): number {
        return this.droppedCount;
    }

    /** Events still waiting to be sent. */
    get pending(): number {
        return this.buffer.length;
    }

    /**
     * Stops accepting events and makes one last, time-boxed attempt to send what is
     * left. Whatever the broker does not take within the deadline is lost.
     */
    async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        clearInterval(this.flushTimer);

        const deadline = Date.now() + SHUTDOWN_DEADLINE_MS;

        while (this.buffer.length > 0 && Date.now() < deadline) {
            if (!(await this.sendBatch())) {
                break;
            }
        }

        if (this.buffer.length > 0) {
            this.warn(`Shutting down with ${this.buffer.length} telemetry event(s) not delivered.`);
        }
    }

    /**
     * Queues one event for sending. Returns at once and never throws: the
     * caller is a request path and must not wait for the broker.
     */
    publish(type: string, payload: unknown, options: TelemetryOptions = {}): void {
        if (this.disposed) {
            return;
        }

        const item: TelemetryItem = {
            type,
            // A round trip through JSON drops undefined members, which the broker refuses.
            payload: JSON.parse(JSON.stringify(payload)),
            createdAt: options.at ?? Date.now(),
            source: this.options.source,
        };

        if (options.correlationId !== undefined) {
            item.correlationId = options.correlationId;
        }

        this.buffer.push(item);

        if (this.buffer.length > this.maxBuffered) {
            const overflow = this.buffer.length - this.maxBuffered;
            this.buffer.splice(0, overflow);
            this.droppedCount += overflow;
            this.warn(`Telemetry buffer is full; dropped the ${overflow} oldest event(s).`);
        }

        if (this.buffer.length >= this.maxBatch) {
            void this.flush();
        }
    }

    /** Sends batches until the buffer is empty or a send fails. Never rejects. */
    private async flush(): Promise<void> {
        if (this.flushing || this.disposed || Date.now() < this.retryNotBefore) {
            return;
        }

        this.flushing = true;

        try {
            while (this.buffer.length > 0 && !this.disposed && (await this.sendBatch())) {
                // keep sending while the broker keeps accepting
            }
        } finally {
            this.flushing = false;
        }
    }

    /** True when the batch was taken off the buffer, whether accepted or refused for good. */
    private async sendBatch(): Promise<boolean> {
        const batch = this.buffer.slice(0, this.maxBatch);

        try {
            const response = await fetch(this.publishUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.options.token}`,
                },
                body: JSON.stringify(batch),
                signal: AbortSignal.timeout(this.requestTimeoutMs),
            });

            return await this.handleResponse(response, batch.length);
        } catch (err) {
            this.backOff(`Telemetry broker unreachable at ${this.options.brokerUrl} (${describe(err)}); ${this.buffer.length} event(s) waiting.`);
            return false;
        }
    }

    private async handleResponse(response: Response, batchLength: number): Promise<boolean> {
        if (response.status === 200 || response.status === 201) {
            const body = (await response.json().catch(() => ({}))) as { acceptedCount?: number; rejectedCount?: number };
            const rejected = body.rejectedCount ?? 0;

            this.buffer.splice(0, batchLength);
            this.sentCount += batchLength - rejected;
            this.droppedCount += rejected;
            this.backoffMs = 0;

            if (rejected > 0) {
                this.warn(`The broker refused ${rejected} telemetry event(s) as invalid.`);
            }

            return true;
        }

        await response.body?.cancel();

        // Full or shutting down: keep the events and try again later.
        if (response.status === 503) {
            this.backOff(`Telemetry queue "${this.options.queueName}" is full or stopping; ${this.buffer.length} event(s) waiting.`, retryAfterMs(response));
            return false;
        }

        // 401, 404, 413 and the like will not get better by retrying this batch.
        this.buffer.splice(0, batchLength);
        this.droppedCount += batchLength;
        this.warn(`The broker answered ${response.status}; dropped ${batchLength} telemetry event(s). Check the queue name and token.`);
        return true;
    }

    private backOff(message: string, minimumMs: number = 0): void {
        this.backoffMs = Math.min(Math.max(this.backoffMs * 2, INITIAL_BACKOFF_MS, minimumMs), MAX_BACKOFF_MS);
        this.retryNotBefore = Date.now() + this.backoffMs;
        this.warn(message);
    }

    private warn(message: string): void {
        const now = Date.now();

        if (now - this.lastWarningAt < this.warnIntervalMs) {
            return;
        }

        this.lastWarningAt = now;
        this.options.logger.warn(message);
    }
}

function describe(err: unknown): string {
    if (err instanceof Error) {
        const cause = (err as { cause?: { code?: string } }).cause;
        return cause?.code ?? err.message;
    }

    return String(err);
}

function retryAfterMs(response: Response): number {
    const seconds = Number(response.headers.get("retry-after"));
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}
