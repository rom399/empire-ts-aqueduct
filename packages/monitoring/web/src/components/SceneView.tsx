import { useEffect, useRef, useState } from "react";
import type { DatabaseResponse, QueueSample, RouteStats, TopologyResponse } from "../../../src/shared/apiTypes";
import type { EventListener } from "../data/useDashboard";
import { PanelName, TelemetryScene } from "../scene/TelemetryScene";

interface Props {
    topology: TopologyResponse | undefined;
    queue: QueueSample | null;
    processorAlive: boolean;
    database: DatabaseResponse | undefined;
    routes: RouteStats[];
    focusId: string | undefined;
    subscribeEvents: (listener: EventListener) => () => void;
    onSelectBackend: (id: string | undefined) => void;
    onSelectPanel: (panel: PanelName) => void;
}

/** Hosts the three.js canvas. If WebGL is missing the rest of the dashboard still works. */
export function SceneView(props: Props) {
    const container = useRef<HTMLDivElement>(null);
    const [scene, setScene] = useState<TelemetryScene | undefined>(undefined);
    const [failure, setFailure] = useState<string | undefined>(undefined);
    const callbacks = useRef(props);
    callbacks.current = props;

    useEffect(() => {
        if (container.current === null) {
            return undefined;
        }

        let created: TelemetryScene | undefined;

        try {
            created = new TelemetryScene(container.current, {
                onSelectBackend: (id) => callbacks.current.onSelectBackend(id ?? undefined),
                onSelectPanel: (panel) => callbacks.current.onSelectPanel(panel),
            });
            setScene(created);
        } catch (err) {
            setFailure(err instanceof Error ? err.message : "WebGL is not available in this browser.");
        }

        return () => {
            created?.dispose();
            setScene(undefined);
        };
    }, []);

    useEffect(() => { if (props.topology) scene?.setTopology(props.topology); }, [scene, props.topology]);
    useEffect(() => { scene?.setQueue(props.queue); }, [scene, props.queue]);
    useEffect(() => { scene?.setProcessorAlive(props.processorAlive); }, [scene, props.processorAlive]);
    useEffect(() => { scene?.setDatabase(props.database); }, [scene, props.database]);
    useEffect(() => { scene?.setFocus(props.focusId ?? null); }, [scene, props.focusId, props.topology]);
    useEffect(() => { scene?.setRoutes(props.routes); }, [scene, props.routes, props.focusId]);
    useEffect(() => (scene ? props.subscribeEvents((events) => scene.ingest(events)) : undefined), [scene, props.subscribeEvents]);

    return (
        <div className="scene" ref={container}>
            {failure ? <div className="notice">3D view unavailable: {failure} The panels still work.</div> : null}
        </div>
    );
}
