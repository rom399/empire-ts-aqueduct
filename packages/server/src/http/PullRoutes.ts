import { Context, Empire } from "empire-ts";
import { Queue, QueueRegistry } from "empire-ts-aqueduct-core";
import { BearerToken } from "../auth/BearerToken";
import { QueueTokens } from "../auth/QueueTokens";
import { readJsonBody } from "./readJsonBody";
import { registerHealthRoute } from "./registerHealthRoute";
import { sendError, sendUnauthorized } from "./sendError";
import { ServerState } from "./ServerState";

/** Items a take returns when the caller does not say. */
const DEFAULT_TAKE_ITEMS = 10;

/** Items a peek returns when the caller does not say. */
const DEFAULT_PEEK_ITEMS = 10;

/**
 * The pull port: consumers take batches and acknowledge them, and an operator with
 * the admin token can look at and empty queues.
 *
 * - `POST /v1/queues/:name/take` and `POST /v1/queues/:name/ack` need that queue's pull token.
 * - `GET /v1/queues`, `GET /v1/queues/:name/stats`, `GET /v1/queues/:name/peek` and
 *   `POST /v1/queues/:name/purge` need the admin token, and exist only if one is set.
 * - `GET /health`
 *
 * A take is a POST because it changes state: a proxy or client may safely repeat a
 * GET, and repeating a take would lose items.
 */
export class PullRoutes {
    constructor(
        private readonly registry: QueueRegistry,
        private readonly tokens: ReadonlyMap<string, QueueTokens>,
        private readonly adminToken: BearerToken | undefined,
        private readonly state: ServerState
    ) {}

    register(app: Empire): void {
        registerHealthRoute(app, this.state);

        app.post("/v1/queues/:name/take", (ctx) => this.take(ctx));
        app.post("/v1/queues/:name/ack", (ctx) => this.acknowledge(ctx));

        if (this.adminToken) {
            app.get("/v1/queues", (ctx) => this.admin(ctx, () => ctx.json({ queues: this.registry.names() })));
            app.get("/v1/queues/:name/stats", (ctx) => this.adminOnQueue(ctx, (queue) => ctx.json(queue.stats())));
            app.get("/v1/queues/:name/peek", (ctx) => this.adminOnQueue(ctx, (queue) => this.peek(ctx, queue)));
            app.post("/v1/queues/:name/purge", (ctx) => this.adminOnQueue(ctx, (queue) => ctx.json({ purged: queue.purge() })));
        }
    }

    private async take(ctx: Context): Promise<void> {
        const queue = this.authorisedQueue(ctx);

        if (!queue) {
            return;
        }

        const body = await readJsonBody(ctx);

        if (!body.ok || typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) {
            sendError(ctx, 400, "The request body must be a JSON object.");
            return;
        }

        const { maxItems = DEFAULT_TAKE_ITEMS, waitMs = 0 } = body.value as { maxItems?: unknown; waitMs?: unknown };

        if (typeof maxItems !== "number" || !Number.isInteger(maxItems) || maxItems < 1) {
            sendError(ctx, 400, `"maxItems" must be a positive integer.`);
            return;
        }

        if (typeof waitMs !== "number" || !Number.isInteger(waitMs) || waitMs < 0) {
            sendError(ctx, 400, `"waitMs" must be zero or a positive integer.`);
            return;
        }

        // A consumer that hangs up must not stay in the line of waiting consumers, or it would be handed an item nobody receives.
        const disconnected = new AbortController();

        ctx.res.once("close", () => disconnected.abort());

        const result = await queue.take(maxItems, { waitMs, signal: disconnected.signal });

        ctx.json(result);
    }

    private async acknowledge(ctx: Context): Promise<void> {
        const queue = this.authorisedQueue(ctx);

        if (!queue) {
            return;
        }

        const body = await readJsonBody(ctx);
        const batchId = body.ok && typeof body.value === "object" && body.value !== null
            ? (body.value as { batchId?: unknown }).batchId
            : undefined;

        if (typeof batchId !== "string" || batchId.length === 0) {
            sendError(ctx, 400, `"batchId" must be a non-empty string.`);
            return;
        }

        if (queue.acknowledge(batchId)) {
            ctx.json({ acknowledged: true });
        } else {
            sendError(ctx, 404, "Unknown batch. Its receipt window may have closed, in which case the items are back in the queue.");
        }
    }

    private peek(ctx: Context, queue: Queue): void {
        const requested = Number(ctx.query.get("max") ?? DEFAULT_PEEK_ITEMS);

        if (!Number.isInteger(requested) || requested < 1) {
            sendError(ctx, 400, `"max" must be a positive integer.`);
            return;
        }

        ctx.json({ items: queue.peek(requested) });
    }

    /** Finds the queue and checks the caller's pull token, replying 404 or 401 itself when it cannot proceed. */
    private authorisedQueue(ctx: Context): Queue | undefined {
        const name = ctx.params.name;
        const queue = this.registry.find(name);
        const tokens = this.tokens.get(name);

        if (!queue || !tokens) {
            sendError(ctx, 404, `There is no queue named "${name}".`);
            return undefined;
        }

        if (!tokens.pull.matches(ctx.headers.authorization)) {
            sendUnauthorized(ctx);
            return undefined;
        }

        return queue;
    }

    private admin(ctx: Context, action: () => void): void {
        if (!this.adminToken?.matches(ctx.headers.authorization)) {
            sendUnauthorized(ctx);
            return;
        }

        action();
    }

    private adminOnQueue(ctx: Context, action: (queue: Queue) => void): void {
        this.admin(ctx, () => {
            const queue = this.registry.find(ctx.params.name);

            if (queue) {
                action(queue);
            } else {
                sendError(ctx, 404, `There is no queue named "${ctx.params.name}".`);
            }
        });
    }
}
