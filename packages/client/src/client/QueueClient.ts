import { ConsumedQueueItem } from "../types/ConsumedQueueItem";
import { TakeResponse } from "../types/TakeResponse";
import { QueueClientError } from "./QueueClientError";
import { QueueClientOptions } from "./QueueClientOptions";

/** Slack added to a take's wait before the request is abandoned, so the broker answers first. */
const DEFAULT_REQUEST_MARGIN_MS = 10_000;

/** How long an acknowledgement may take. */
const ACK_TIMEOUT_MS = 10_000;

/** Longest piece of an error body worth putting in a message. */
const MAX_ERROR_BODY_LENGTH = 200;

/** HTTP status for "no such batch", which is how the broker says an acknowledgement came too late. */
const NOT_FOUND = 404;

/**
 * The low-level calls to a broker's pull port: take a batch and acknowledge it.
 * Most programs use QueueConsumer, which runs these in a loop.
 */
export class QueueClient {
    private readonly baseUrl: string;
    private readonly fetchImplementation: typeof fetch;
    private readonly requestMarginMs: number;

    constructor(private readonly options: QueueClientOptions) {
        this.baseUrl = `${options.url.replace(/\/+$/, "")}/v1/queues/${encodeURIComponent(options.queue)}`;
        this.fetchImplementation = options.fetch ?? fetch;
        this.requestMarginMs = options.requestMarginMs ?? DEFAULT_REQUEST_MARGIN_MS;
    }

    /**
     * Takes up to `maxItems` items. With `waitMs`, an empty queue holds the
     * request until an item arrives or the time runs out. Throws
     * QueueClientError if the broker cannot be reached or refuses.
     */
    async take(maxItems: number, options: { waitMs?: number; signal?: AbortSignal } = {}): Promise<TakeResponse> {
        const waitMs = options.waitMs ?? 0;
        const timeout = AbortSignal.timeout(waitMs + this.requestMarginMs);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

        const response = await this.send("take", { maxItems, waitMs }, signal);

        if (!response.ok) {
            throw await this.failure(response, "take");
        }

        return this.parseTake(await response.json().catch(() => undefined));
    }

    /**
     * Confirms receipt of a batch. Returns true when the broker forgot the
     * items, or false when it no longer knew the batch: the receipt window had
     * closed and the items already went back to the queue. Throws
     * QueueClientError for any other failure, in which case the outcome is unknown.
     */
    async acknowledge(batchId: string): Promise<boolean> {
        const response = await this.send("ack", { batchId }, AbortSignal.timeout(ACK_TIMEOUT_MS));

        if (response.ok) {
            return true;
        }

        if (response.status === NOT_FOUND) {
            return false;
        }

        throw await this.failure(response, "acknowledge");
    }

    private async send(action: "take" | "ack", body: unknown, signal: AbortSignal): Promise<Response> {
        try {
            return await this.fetchImplementation(`${this.baseUrl}/${action}`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.options.token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
                signal,
            });
        } catch (error) {
            // Keep the abort itself visible, so a caller who aborted can tell it from a broker failure.
            if (signal.aborted && error instanceof Error && error.name === "AbortError") {
                throw error;
            }

            throw new QueueClientError(`Could not reach the queue broker: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
        }
    }

    private async failure(response: Response, action: string): Promise<QueueClientError> {
        const text = (await response.text().catch(() => "")).slice(0, MAX_ERROR_BODY_LENGTH);

        return new QueueClientError(`The broker refused to ${action} (HTTP ${response.status})${text ? `: ${text}` : ""}`, response.status);
    }

    private parseTake(json: unknown): TakeResponse {
        const candidate = json as Partial<TakeResponse> | undefined;

        if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.items)) {
            throw new QueueClientError("The broker's answer to a take was not understood.");
        }

        return {
            batchId: typeof candidate.batchId === "string" ? candidate.batchId : null,
            count: candidate.items.length,
            drained: candidate.drained === true,
            items: candidate.items as ConsumedQueueItem[],
        };
    }
}
