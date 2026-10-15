import { Middleware } from "empire-ts";
import { QueueTelemetryPublisher } from "./QueueTelemetryPublisher";

/**
 * Reports one `backend.request` event to the telemetry queue for every
 * request this backend finishes, with the route it matched, the status it
 * answered and how long it took. A client that hangs up early is reported
 * too, with `aborted: true`, since its response never completed.
 *
 * The balancer's own events say what it saw from outside; these say what the
 * backend saw from inside. The balancer's request id is not passed to
 * backends, so the two sides are joined by backend id and time, not by a
 * shared correlation id.
 */
export function createBackendTelemetryMiddleware(backendId: string, publisher: QueueTelemetryPublisher): Middleware {
    return (ctx, next) => {
        const startedAt = Date.now();

        ctx.res.once("close", () => {
            const finishedAt = Date.now();

            publisher.publish("backend.request", {
                backendId,
                method: ctx.method,
                path: (ctx.req.url ?? "").split("?")[0],
                route: ctx.route,
                status: ctx.res.statusCode,
                durationMs: finishedAt - startedAt,
                aborted: !ctx.res.writableFinished,
            }, { at: finishedAt });
        });

        return next();
    };
}
