import http from "http";
import { HttpError, ILogger, Middleware } from "empire-ts";

const ADMIN_TIMEOUT_MS = 10_000;
const REDIRECT = 308;
const BAD_GATEWAY = 502;
const IPV4_MAPPED_PREFIX = "::ffff:";

export interface AdminProxy extends Middleware {
    /** Closes the connections kept open to the hub. */
    dispose(): void;
}

/**
 * Shows the monitoring hub's dashboard under the balancer's own address:
 * everything under `/admin` is forwarded to the hub's web server with the
 * prefix removed, so `http://localhost:8012/admin/` is the dashboard and
 * `/admin/api/...` is its API and live stream.
 *
 * It must be registered before the load balancer, which is terminal and would
 * otherwise send `/admin` to a backend.
 *
 * The hub has no login, so this serves loopback clients only. Putting it on a
 * real network needs authentication first; that is deliberately not built here.
 */
export function createAdminProxyMiddleware(hubUrl: string, logger: ILogger, prefix: string = "/admin"): AdminProxy {
    const agent = new http.Agent({ keepAlive: true });
    const hub = new URL(hubUrl);

    const middleware: Middleware = async (ctx, next) => {
        const original = ctx.req.url ?? "/";
        const [pathOnly, query = ""] = original.split("?", 2);

        if (pathOnly !== prefix && !pathOnly.startsWith(`${prefix}/`)) {
            return next();
        }

        if (!isLoopback(ctx.req.socket.remoteAddress)) {
            throw new HttpError(403, "Forbidden");
        }

        // The dashboard loads its scripts and API with relative URLs, which only resolve under a trailing slash.
        if (pathOnly === prefix) {
            ctx.res.writeHead(REDIRECT, { Location: `${prefix}/${query ? `?${query}` : ""}` });
            ctx.res.end();
            return;
        }

        const path = (pathOnly.slice(prefix.length) || "/") + (query ? `?${query}` : "");

        await new Promise<void>((resolve, reject) => {
            const upstream = http.request(
                { agent, host: hub.hostname, port: hub.port, path, method: ctx.method, headers: { ...ctx.req.headers, host: hub.host }, timeout: ADMIN_TIMEOUT_MS },
                (response) => {
                    ctx.res.writeHead(response.statusCode ?? BAD_GATEWAY, response.headers);
                    response.pipe(ctx.res);
                    response.on("end", resolve);
                    response.on("error", reject);
                }
            );

            upstream.on("timeout", () => upstream.destroy(new Error("hub timed out")));
            upstream.on("error", (err) => {
                logger.warn(`The monitoring hub at ${hubUrl} is not reachable; start it to see the dashboard.`);
                reject(ctx.res.headersSent ? err : new HttpError(BAD_GATEWAY, "Bad Gateway"));
            });
            ctx.req.on("aborted", () => upstream.destroy());
            ctx.req.pipe(upstream);
        });
    };

    return Object.assign(middleware, {
        dispose(): void {
            agent.destroy();
        },
    });
}

function isLoopback(address: string | undefined): boolean {
    if (!address) {
        return false;
    }

    const unmapped = address.startsWith(IPV4_MAPPED_PREFIX) ? address.slice(IPV4_MAPPED_PREFIX.length) : address;

    return unmapped === "::1" || unmapped.startsWith("127.");
}
