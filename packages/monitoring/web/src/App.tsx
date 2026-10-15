import { useCallback, useEffect, useMemo, useState } from "react";
import { BackendTable } from "./components/BackendTable";
import { ChartsPanel } from "./components/ChartsPanel";
import { DatabasePanel } from "./components/DatabasePanel";
import { EventTail } from "./components/EventTail";
import { Panel } from "./components/Panel";
import { QueuePanel } from "./components/QueuePanel";
import { SceneView } from "./components/SceneView";
import { TopBar } from "./components/TopBar";
import { RangeName, useDashboard } from "./data/useDashboard";
import type { PanelName } from "./scene/TelemetryScene";

const HIGHLIGHT_MS = 2500;

export function App() {
    const [range, setRange] = useState<RangeName>("5 min");
    const [backendId, setBackendId] = useState<string | undefined>(undefined);
    const [route, setRoute] = useState<string | undefined>(undefined);
    const [tailPaused, setTailPaused] = useState(false);
    const [highlight, setHighlight] = useState<PanelName | undefined>(undefined);

    const data = useDashboard({ range, backendId, route, tailPaused });

    const selectBackend = useCallback((id: string | undefined) => {
        setBackendId(id);
        setRoute(undefined);
    }, []);

    const selectPanel = useCallback((panel: PanelName) => {
        setHighlight(panel);
        document.getElementById(`panel-${panel}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, []);

    useEffect(() => {
        if (highlight === undefined) {
            return undefined;
        }

        const timer = window.setTimeout(() => setHighlight(undefined), HIGHLIGHT_MS);
        return () => window.clearTimeout(timer);
    }, [highlight]);

    // A selected backend that disappears from the server's list is no longer selected.
    useEffect(() => {
        if (backendId !== undefined && data.topology && !data.topology.backends.some((b) => b.id === backendId)) {
            selectBackend(undefined);
        }
    }, [backendId, data.topology, selectBackend]);

    const routes = useMemo(
        () => (backendId === undefined ? [] : (data.summary?.routes ?? []).filter((r) => r.backendId === backendId)),
        [data.summary, backendId]
    );

    const processor = data.queue?.processor;
    const scope = backendId === undefined ? "all backends" : route ? `${backendId} · ${route}` : backendId;

    return (
        <div className="app">
            <SceneView
                topology={data.topology}
                queue={data.latestQueue}
                processorAlive={processor?.alive ?? false}
                database={data.database}
                routes={routes}
                focusId={backendId}
                subscribeEvents={data.subscribeEvents}
                onSelectBackend={selectBackend}
                onSelectPanel={selectPanel}
            />
            <TopBar connection={data.connection} unreachable={data.unreachable} topology={data.topology} processor={processor} now={data.now} />

            {data.unreachable ? (
                <div className="banner" role="alert">
                    Cannot reach the telemetry hub. Is <code>empire-ts-monitoring server</code> running? Retrying…
                </div>
            ) : null}

            <aside className="column left" aria-label="Backends and charts">
                <Panel title="Backends" badge={data.topology ? `${data.topology.backends.length}` : undefined}>
                    <BackendTable
                        backends={data.topology?.backends}
                        selectedId={backendId}
                        onSelect={selectBackend}
                        routes={routes}
                        selectedRoute={route}
                        onSelectRoute={setRoute}
                        now={data.now}
                    />
                </Panel>
                <Panel title="Traffic">
                    <ChartsPanel series={data.timeseries} range={range} onRange={setRange} scope={scope} />
                </Panel>
            </aside>

            <aside className="column right" aria-label="Telemetry pipeline">
                <Panel
                    title="Queue"
                    id="panel-queue"
                    active={highlight === "queue"}
                    badge={data.latestQueue ? `${data.latestQueue.depth} waiting` : "no reading"}
                >
                    <QueuePanel latest={data.latestQueue} samples={data.queueSamples} series={data.queueSeries} processor={processor} now={data.now} />
                </Panel>
                <Panel
                    title="Database"
                    id="panel-database"
                    active={highlight === "database"}
                    badge={processor ? (processor.alive ? "processor up" : "processor down") : undefined}
                >
                    <DatabasePanel info={data.database} processor={processor} now={data.now} />
                </Panel>
                <Panel title="Live events" defaultOpen={false}>
                    <EventTail events={data.tail} paused={tailPaused} onTogglePause={() => setTailPaused(!tailPaused)} />
                </Panel>
            </aside>
        </div>
    );
}
