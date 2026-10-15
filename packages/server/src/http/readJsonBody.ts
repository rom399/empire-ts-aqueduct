import { Context } from "empire-ts";

/** The outcome of reading a request body as JSON. */
export type JsonBodyResult =
    | { ok: true; value: unknown }
    | { ok: false };

/**
 * Reads the body as JSON. A body that is empty counts as `{}`, and one that is not
 * valid JSON is reported as `ok: false` so the caller can reply 400. A body over
 * the app's size limit still throws Empire's 413.
 */
export async function readJsonBody(ctx: Context): Promise<JsonBodyResult> {
    const text = await ctx.body();

    if (text.trim().length === 0) {
        return { ok: true, value: {} };
    }

    try {
        return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
        return { ok: false };
    }
}
