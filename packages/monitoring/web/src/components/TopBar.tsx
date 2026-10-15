import type { ProcessorStatus, TopologyResponse } from "../../../src/shared/apiTypes";
import type { ConnectionState } from "../data/LiveConnection";
import { formatAgo, formatMs, formatPercent, formatRate } from "../data/format";

interface Props {
    connection: ConnectionState;
    unreachable: boolean;
    topology: TopologyResponse | undefined;
    processor: ProcessorStatus | undefined;
    now: number;
}

const LABELS: Record<ConnectionState, string> = {
    connecting: "connecting",
    live: "live",
    reconnecting: "reconnecting",
    resyncing: "resyncing",
};

export function TopBar({ connection, unreachable, topology, processor, now }: Props) {
    const recent = topology?.recent;
    const status = unreachable ? "down" : connection;

    return (
        <header className="topbar">
            <h1>Empire telemetry</h1>
            <span className={`pill ${status}`} role="status">{unreachable ? "server unreachable" : LABELS[connection]}</span>
            <span className={`pill ${processor?.alive ? "live" : "warn"}`} title={processor?.lastError ?? undefined}>
                processor {processor === undefined ? "unknown" : processor.alive ? `up · stored ${formatAgo(processor.lastStoredAt, now)}` : "not running"}
            </span>
            <dl className="metrics">
                <div><dt>requests/s</dt><dd>{formatRate(recent?.perSecond)}</dd></div>
                <div><dt>errors</dt><dd className={recent && recent.errorRate > 0.05 ? "bad" : ""}>{formatPercent(recent?.errorRate)}</dd></div>
                <div><dt>p50</dt><dd>{formatMs(recent?.p50Ms)}</dd></div>
                <div><dt>p95</dt><dd>{formatMs(recent?.p95Ms)}</dd></div>
                <div><dt>backends</dt><dd>{topology ? topology.backends.filter((b) => b.status === "active").length : "–"}</dd></div>
            </dl>
        </header>
    );
}
