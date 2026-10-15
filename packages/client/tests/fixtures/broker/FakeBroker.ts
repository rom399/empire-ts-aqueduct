import { ConsumedQueueItem } from "../../../src/types/ConsumedQueueItem";

export interface RecordedRequest {
    action: "take" | "ack";
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
}

type TakeScript = () => Response | Promise<Response>;

/** Builds an item as the broker delivers it. */
export function deliveredItem(sequence: number, overrides: Partial<ConsumedQueueItem> = {}): ConsumedQueueItem {
    return {
        itemId: `item-${sequence}`,
        sequence,
        type: "test.event",
        payload: { n: sequence },
        createdAt: 1,
        enqueuedAt: 2,
        deliveryCount: 1,
        ...overrides,
    };
}

/** A JSON response. */
export function jsonResponse(body: unknown, status: number = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** The broker's answer to a take that returned `items`. */
export function takeAnswer(batchId: string, items: ConsumedQueueItem[]): Response {
    return jsonResponse({ batchId, count: items.length, drained: true, items });
}

/** The broker's answer to a take on an empty queue. */
export function emptyAnswer(): Response {
    return jsonResponse({ batchId: null, count: 0, drained: true, items: [] });
}

/**
 * A stand-in for the network. Takes are answered from a script in order; once the
 * script runs out a take hangs like a long-poll until its signal aborts.
 * Acknowledgements are answered by `ack`.
 */
export class FakeBroker {
    readonly requests: RecordedRequest[] = [];

    /** What an acknowledgement gets back. Replace it to simulate failures. */
    ack: (batchId: string) => Response | Promise<Response> = () => jsonResponse({ acknowledged: true });

    private readonly script: TakeScript[] = [];

    /** Queues the answer to the next take. */
    willTake(answer: Response | TakeScript): this {
        this.script.push(typeof answer === "function" ? answer : () => answer);

        return this;
    }

    readonly fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const action = url.endsWith("/take") ? "take" : "ack";
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;

        this.requests.push({ action, url, headers: init?.headers as Record<string, string>, body });

        if (action === "ack") {
            return Promise.resolve(this.ack(String(body.batchId)));
        }

        const next = this.script.shift();

        if (next) {
            return Promise.resolve(next());
        }

        return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")), { once: true });
        });
    };

    /** The requests of one kind, in order. */
    of(action: "take" | "ack"): RecordedRequest[] {
        return this.requests.filter((request) => request.action === action);
    }
}
