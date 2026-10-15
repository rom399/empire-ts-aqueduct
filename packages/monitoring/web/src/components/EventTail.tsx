import { useMemo, useState } from "react";
import type { StoredEvent } from "../../../src/shared/apiTypes";
import { formatClock } from "../data/format";

interface Props {
    events: StoredEvent[];
    paused: boolean;
    onTogglePause: () => void;
}

const FILTERS = {
    all: () => true,
    requests: (e: StoredEvent) => e.type.endsWith(".dispatched") || e.type.endsWith(".completed") || e.type.endsWith(".failed") || e.type.endsWith(".aborted") || e.type === "backend.request",
    "backends": (e: StoredEvent) => e.type.includes("backendAdded") || e.type.includes("backendRemoved") || e.type.startsWith("backend.started") || e.type.startsWith("backend.stopping"),
    "heartbeats": (e: StoredEvent) => e.type.endsWith("leaseRenewed"),
};
type FilterName = keyof typeof FILTERS;

function summarise(event: StoredEvent): string {
    const p = event.payload;

    switch (event.type) {
        case "loadbalancer.dispatched": return `${String(p.method)} ${String(p.path)} → ${String(p.backendId)}`;
        case "loadbalancer.completed": return `${String(p.route ?? p.backendId)} ${String(p.status)} in ${String(p.durationMs)} ms (${String(p.backendId)})`;
        case "loadbalancer.failed": return `failed in ${String(p.phase)} (${typeof p.backendId === "string" ? p.backendId : "?"})`;
        case "loadbalancer.aborted": return `client left (${String(p.backendId)})`;
        case "backend.request": return `${String(p.method)} ${String(p.route ?? p.path)} ${String(p.status)} in ${String(p.durationMs)} ms`;
        case "loadbalancer.leaseRenewed": return `lease renewed (${String(p.backendId)})`;
        case "loadbalancer.backendAdded": return `joined: ${String((p.backend as { id?: string } | undefined)?.id)}`;
        case "loadbalancer.backendRemoved": return `${String(p.backendId)} removed (${String(p.reason)})`;
        default: return JSON.stringify(p).slice(0, 90);
    }
}

export function EventTail({ events, paused, onTogglePause }: Props) {
    const [filter, setFilter] = useState<FilterName>("requests");
    const shown = useMemo(() => events.filter(FILTERS[filter]).slice(0, 60), [events, filter]);

    return (
        <div className="tail">
            <div className="range" role="group" aria-label="Event filter">
                {(Object.keys(FILTERS) as FilterName[]).map((name) => (
                    <button key={name} type="button" className={name === filter ? "on" : ""} aria-pressed={name === filter} onClick={() => setFilter(name)}>{name}</button>
                ))}
                <button type="button" className={`pause${paused ? " on" : ""}`} aria-pressed={paused} onClick={onTogglePause}>{paused ? "resume" : "pause"}</button>
            </div>
            {shown.length === 0 ? <p className="muted">No matching events yet.</p> : (
                <ol className="events">
                    {shown.map((event) => (
                        <li key={event.seq}>
                            <time>{formatClock(event.at)}</time>
                            <span className="src">{event.source ?? "?"}</span>
                            <span>{summarise(event)}</span>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}
