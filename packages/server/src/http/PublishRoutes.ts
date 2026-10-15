import { Context, Empire } from "empire-ts";
import { PublishRejected, PublishRejectionReason, PublishResult, QueueRegistry } from "empire-ts-aqueduct-core";
import { QueueTokens } from "../auth/QueueTokens";
import { readJsonBody } from "./readJsonBody";
import { registerHealthRoute } from "./registerHealthRoute";
import { sendError, sendUnauthorized } from "./sendError";
import { ServerState } from "./ServerState";

/**
 * The publish port: producers send items to a named queue.
 *
 * - `POST /v1/queues/:name/items` with one item or an array of items. Needs that queue's publish token.
 * - `GET /health`
 */
export class PublishRoutes {
    constructor(
        private readonly registry: QueueRegistry,
        private readonly tokens: ReadonlyMap<string, QueueTokens>,
        private readonly state: ServerState
    ) {}

    register(app: Empire): void {
        registerHealthRoute(app, this.state);
        app.post("/v1/queues/:name/items", (ctx) => this.publish(ctx));
    }

    private async publish(ctx: Context): Promise<void> {
        const name = ctx.params.name;
        const queue = this.registry.find(name);
        const tokens = this.tokens.get(name);

        if (!queue || !tokens) {
            sendError(ctx, 404, `There is no queue named "${name}".`);
            return;
        }

        if (!tokens.publish.matches(ctx.headers.authorization)) {
            sendUnauthorized(ctx);
            return;
        }

        const body = await readJsonBody(ctx);

        if (!body.ok) {
            sendError(ctx, 400, "The request body is not valid JSON.");
            return;
        }

        if (Array.isArray(body.value)) {
            this.replyToBatch(ctx, body.value.length === 0 ? undefined : queue.publishBatch(body.value));
            return;
        }

        this.replyToSingle(ctx, queue.publish(body.value));
    }

    private replyToSingle(ctx: Context, result: PublishResult): void {
        if (result.accepted) {
            ctx.status(201).json({ itemId: result.itemId, sequence: result.sequence });
            return;
        }

        this.replyRejected(ctx, result);
    }

    private replyToBatch(ctx: Context, results: PublishResult[] | undefined): void {
        if (!results) {
            sendError(ctx, 400, "A batch must contain at least one item.");
            return;
        }

        const rejected = results.filter((result): result is PublishRejected => !result.accepted);

        // The whole batch was refused for one reason that is not about any single item.
        if (rejected.length === results.length) {
            const reason = rejected[0].reason;

            if (rejected.every((result) => result.reason === reason)
                && (reason === PublishRejectionReason.BatchTooLarge || reason === PublishRejectionReason.QueueClosed)) {
                this.replyRejected(ctx, rejected[0]);
                return;
            }
        }

        ctx.status(200).json({
            results,
            acceptedCount: results.length - rejected.length,
            rejectedCount: rejected.length,
        });
    }

    private replyRejected(ctx: Context, rejected: PublishRejected): void {
        const status = REJECTION_STATUS[rejected.reason];

        if (status === 503) {
            ctx.header("Retry-After", String(RETRY_AFTER_SECONDS));
        }

        sendError(ctx, status, rejected.message, { reason: rejected.reason });
    }
}

/** What a client should wait before retrying a refused publish. */
const RETRY_AFTER_SECONDS = 1;

const REJECTION_STATUS: Record<PublishRejectionReason, number> = {
    [PublishRejectionReason.InvalidItem]: 400,
    [PublishRejectionReason.BatchTooLarge]: 413,
    [PublishRejectionReason.QueueFull]: 503,
    [PublishRejectionReason.SpillFull]: 503,
    [PublishRejectionReason.QueueClosed]: 503,
};
