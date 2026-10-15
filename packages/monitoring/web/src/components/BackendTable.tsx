import type { BackendNode, RouteStats } from "../../../src/shared/apiTypes";
import { formatMs, formatPercent, formatRate } from "../data/format";

interface Props {
    backends: BackendNode[] | undefined;
    selectedId: string | undefined;
    onSelect: (id: string | undefined) => void;
    routes: RouteStats[];
    selectedRoute: string | undefined;
    onSelectRoute: (route: string | undefined) => void;
    now: number;
}

function leaseText(node: BackendNode, now: number): string {
    if (node.status === "removed") {
        return node.removalReason === "expired" ? "crashed" : "left";
    }

    return node.leaseExpiresAt === null ? "pinned" : `${Math.max(0, (node.leaseExpiresAt - now) / 1000).toFixed(1)} s`;
}

export function BackendTable({ backends, selectedId, onSelect, routes, selectedRoute, onSelectRoute, now }: Props) {
    if (backends === undefined) {
        return <p className="muted">Waiting for the first reading…</p>;
    }

    if (backends.length === 0) {
        return <p className="muted">No backends have registered yet. Start one with <code>backend.ts &lt;id&gt; &lt;port&gt;</code>.</p>;
    }

    return (
        <>
            <table className="grid">
                <thead>
                    <tr><th>backend</th><th>in flight</th><th>req/s</th><th>errors</th><th>p95</th><th>lease</th></tr>
                </thead>
                <tbody>
                    {backends.map((node) => (
                        <tr
                            key={node.id}
                            className={`${node.id === selectedId ? "selected" : ""} ${node.status === "removed" ? "gone" : ""}`}
                            onClick={() => onSelect(node.id === selectedId ? undefined : node.id)}
                        >
                            <td>
                                <button type="button" className="link" aria-pressed={node.id === selectedId}>
                                    <i className={`dot ${node.status === "removed" ? (node.removalReason === "expired" ? "bad" : "gone") : "ok"}`} />{node.id}
                                </button>
                            </td>
                            <td>{node.inFlight}</td>
                            <td>{formatRate(node.recent.perSecond)}</td>
                            <td className={node.recent.errorRate > 0.05 ? "bad" : ""}>{formatPercent(node.recent.errorRate)}</td>
                            <td>{formatMs(node.recent.p95Ms)}</td>
                            <td>{leaseText(node, now)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {selectedId !== undefined ? (
                <div className="routes">
                    <h3>Routes on {selectedId} <small>last 60 s · click to chart one</small></h3>
                    {routes.length === 0 ? <p className="muted">No requests in the last minute.</p> : (
                        <table className="grid">
                            <thead><tr><th>route</th><th>n</th><th>errors</th><th>p95</th></tr></thead>
                            <tbody>
                                {routes.map((route) => (
                                    <tr
                                        key={`${route.method} ${route.route}`}
                                        className={route.route === selectedRoute ? "selected" : ""}
                                        onClick={() => onSelectRoute(route.route === selectedRoute ? undefined : route.route)}
                                    >
                                        <td><button type="button" className="link">{route.method} {route.route}</button></td>
                                        <td>{route.stats.count}</td>
                                        <td className={route.stats.errorRate > 0.05 ? "bad" : ""}>{formatPercent(route.stats.errorRate)}</td>
                                        <td>{formatMs(route.stats.p95Ms)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            ) : null}
        </>
    );
}
