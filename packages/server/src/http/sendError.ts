import { Context } from "empire-ts";

/** Replies with a JSON error body. Written directly so expected refusals are not logged as server errors. */
export function sendError(ctx: Context, status: number, message: string, extra: Record<string, unknown> = {}): void {
    ctx.status(status).json({ error: message, ...extra });
}

/** Replies 401 and tells the caller to send a bearer token. */
export function sendUnauthorized(ctx: Context): void {
    ctx.header("WWW-Authenticate", "Bearer");
    sendError(ctx, 401, "Unauthorized");
}
