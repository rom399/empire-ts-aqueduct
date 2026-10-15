import { Empire } from "empire-ts";
import { ServerState } from "./ServerState";

/**
 * `GET /health`: up or down and nothing else. It needs no token and tells a caller
 * nothing about queue names or counts.
 */
export function registerHealthRoute(app: Empire, state: ServerState): void {
    app.get("/health", (ctx) => {
        ctx.status(state.isAccepting ? 200 : 503).json({ status: state.isAccepting ? "up" : "down" });
    });
}
