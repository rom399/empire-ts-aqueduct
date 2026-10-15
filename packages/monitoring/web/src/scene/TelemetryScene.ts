import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type { DatabaseResponse, QueueSample, RouteStats, StoredEvent, TopologyResponse } from "../../../src/shared/apiTypes";
import { evenlySpread, particleBudget } from "../data/spawnSampler";
import { BackendActor } from "./BackendActor";
import {
    DATABASE_POSITION, easeInOutCubic, HUB_POSITION, OVERVIEW_TARGET, outcomeKind, PROCESSOR_POSITION,
    QUEUE_POSITION, RING_RADIUS, ringPosition, Vec3,
} from "./layout";
import { PALETTE } from "./palette";
import { Leg, ParticleSystem } from "./ParticleSystem";
import { PipelineLane } from "./PipelineLane";
import { Satellites } from "./Satellites";

export type PanelName = "queue" | "database";

export interface SceneCallbacks {
    onSelectBackend(id: string | null): void;
    onSelectPanel(panel: PanelName): void;
}

const POOL_SIZE = 1600;
const MAX_LIVE_PARTICLES = 1200;
const REQUESTS_PER_BATCH = 40;
const PACKETS_PER_BATCH = 14;
const FLY_S = 0.55;
const RETURN_S = 0.4;
const MIN_ORBIT_S = 0.15;
const PACKET_TO_QUEUE_S = 0.9;
const PACKET_TO_PROCESSOR_S = 0.7;
const PACKET_TO_DATABASE_S = 0.7;
const CAMERA_TWEEN_S = 0.8;
const CLICK_SLOP_PX = 5;
const IDLE_ROTATE_DELAY_MS = 6000;
const OVERVIEW_OFFSET: Vec3 = { x: 0, y: 25, z: 30 };
const FOCUS_BACK = 11;
const FOCUS_HEIGHT = 8;

/** Events that produce a telemetry packet. Lease heartbeats are left out: they would drown the interesting ones. */
const PACKET_TYPES = new Set([
    "loadbalancer.dispatched", "loadbalancer.completed", "loadbalancer.failed", "loadbalancer.aborted",
    "loadbalancer.backendAdded", "loadbalancer.backendRemoved", "backend.request", "backend.started", "backend.stopping",
]);

interface CameraTween {
    fromPosition: THREE.Vector3;
    toPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    elapsed: number;
}

/** Views a backend from outside the ring, looking in toward the balancer, so the hub is behind it and not in the way. */
function focusOffset(position: Vec3): Vec3 {
    const length = Math.hypot(position.x, position.z) || 1;
    return { x: (position.x / length) * FOCUS_BACK, y: FOCUS_HEIGHT, z: (position.z / length) * FOCUS_BACK };
}

const toVector = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v.x, v.y, v.z);

/**
 * The 3D view. React owns the data and the panels; this class owns everything
 * in the canvas and exposes a small imperative surface (`setTopology`,
 * `ingest`, ...). Nothing here reads React state, so a burst of events costs
 * some particles, not renders.
 */
export class TelemetryScene {
    private readonly renderer: THREE.WebGLRenderer;
    private readonly labels = new CSS2DRenderer();
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    private readonly controls: OrbitControls;
    private readonly particles = new ParticleSystem(POOL_SIZE);
    private readonly lane = new PipelineLane();
    private readonly satellites = new Satellites();
    private readonly hub: THREE.Mesh;
    private readonly hubMaterial: THREE.MeshStandardMaterial;
    private readonly actors = new Map<string, BackendActor>();
    private readonly slotOrder: string[] = [];
    private readonly pending = new Map<string, number>();
    private readonly raycaster = new THREE.Raycaster();
    private readonly resizeObserver: ResizeObserver;
    private readonly disposables: Array<{ dispose(): void }> = [];

    private frame = 0;
    private lastTime = 0;
    private hubPulse = 0;
    private focusId: string | null = null;
    private tween: CameraTween | undefined;
    private idleTimer: number | undefined;
    private pointerDown: { x: number; y: number } | undefined;
    private now = Date.now();
    private disposed = false;

    constructor(private readonly container: HTMLElement, private readonly callbacks: SceneCallbacks) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setClearColor(PALETTE.background);
        container.appendChild(this.renderer.domElement);

        this.labels.domElement.className = "labels";
        container.appendChild(this.labels.domElement);

        const start = toVector(OVERVIEW_TARGET).add(toVector(OVERVIEW_OFFSET));
        this.camera.position.copy(start);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.copy(toVector(OVERVIEW_TARGET));
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.maxPolarAngle = Math.PI * 0.49;
        this.controls.minDistance = 3;
        this.controls.maxDistance = 90;
        this.controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        this.controls.autoRotateSpeed = 0.35;
        this.controls.addEventListener("start", () => {
            this.controls.autoRotate = false;
            window.clearTimeout(this.idleTimer);
            this.tween = undefined;
        });
        this.controls.addEventListener("end", () => {
            window.clearTimeout(this.idleTimer);
            this.idleTimer = window.setTimeout(() => {
                if (this.focusId === null && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                    this.controls.autoRotate = true;
                }
            }, IDLE_ROTATE_DELAY_MS);
        });

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const sun = new THREE.DirectionalLight(0xffffff, 1.4);
        sun.position.set(8, 16, 10);
        this.scene.add(sun);

        const floor = new THREE.GridHelper(80, 40, 0x1f2b4a, 0x141c33);
        floor.position.set(OVERVIEW_TARGET.x, -0.2, OVERVIEW_TARGET.z);
        this.scene.add(floor);
        this.disposables.push(floor.geometry, floor.material as THREE.Material);

        this.hubMaterial = new THREE.MeshStandardMaterial({ color: 0x8fa8ff, emissive: PALETTE.hub, emissiveIntensity: 0.6, roughness: 0.35 });
        this.hub = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), this.hubMaterial);
        this.hub.position.set(HUB_POSITION.x, HUB_POSITION.y, HUB_POSITION.z);
        const hubLabelElement = document.createElement("div");
        hubLabelElement.className = "lbl hub";
        hubLabelElement.textContent = "balancer";
        this.hub.add(new CSS2DObject(hubLabelElement));
        this.hub.children[0].position.set(0, 1.9, 0);
        this.disposables.push(this.hub.geometry, this.hubMaterial);
        this.scene.add(this.hub);

        const ring = new THREE.Mesh(
            new THREE.RingGeometry(RING_RADIUS - 0.05, RING_RADIUS + 0.05, 120),
            new THREE.MeshBasicMaterial({ color: 0x8899bb, transparent: true, opacity: 0.16, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.02;
        this.scene.add(ring);
        this.disposables.push(ring.geometry, ring.material as THREE.Material);

        this.scene.add(this.lane.group, this.particles.mesh, this.satellites.group);

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.resize();

        const canvas = this.renderer.domElement;
        canvas.addEventListener("pointerdown", this.onPointerDown);
        canvas.addEventListener("pointerup", this.onPointerUp);
        canvas.addEventListener("pointermove", this.onPointerMove);

        this.lastTime = performance.now();
        this.frame = requestAnimationFrame(this.loop);
    }

    // -------------------------------------------------------------- data in

    setTopology(topology: TopologyResponse): void {
        this.now = topology.now;
        const seen = new Set<string>();

        for (const node of topology.backends) {
            seen.add(node.id);
            let actor = this.actors.get(node.id);

            if (actor === undefined) {
                this.slotOrder.push(node.id);
                actor = new BackendActor(node.id, ringPosition(this.slotOrder.length - 1, this.slotOrder.length));
                this.actors.set(node.id, actor);
                this.scene.add(actor.group);
            }

            actor.apply(node);
        }

        // Backends the server no longer lists are gone for good.
        for (const [id, actor] of this.actors) {
            if (!seen.has(id)) {
                this.removeActor(id, actor);
            }
        }

        this.slotOrder.forEach((id, index) => this.actors.get(id)?.setTarget(ringPosition(index, this.slotOrder.length)));
        this.applyFocusStyle();
    }

    setQueue(sample: QueueSample | null): void {
        this.lane.setQueue(sample);
    }

    setProcessorAlive(alive: boolean): void {
        this.lane.setProcessor(alive);
    }

    setDatabase(info: DatabaseResponse | undefined): void {
        this.lane.setDatabase(info);
    }

    setRoutes(routes: readonly RouteStats[]): void {
        if (this.focusId !== null) {
            this.satellites.set(routes.filter((route) => route.backendId === this.focusId));
        }
    }

    /** Selects (or clears) the focused backend and flies the camera to it. */
    setFocus(id: string | null): void {
        if (id === this.focusId) {
            return;
        }

        this.focusId = id;
        this.satellites.clear();
        const actor = id === null ? undefined : this.actors.get(id);
        this.applyFocusStyle();

        if (actor !== undefined) {
            this.controls.autoRotate = false;
            this.flyTo(actor.position, focusOffset(actor.position));
            this.satellites.group.position.copy(actor.position);
        } else {
            this.flyTo(toVector(OVERVIEW_TARGET), OVERVIEW_OFFSET);
        }
    }

    /** Applies a batch of stored events the stream just delivered: particles, pulses. */
    ingest(events: readonly StoredEvent[]): void {
        const hubPosition = toVector(HUB_POSITION);
        let requestBudget = particleBudget(events.length, this.particles.live, MAX_LIVE_PARTICLES, REQUESTS_PER_BATCH);
        const packetEvents = events.filter((event) => PACKET_TYPES.has(event.type));
        const packetPicks = new Set(evenlySpread(packetEvents.length, particleBudget(packetEvents.length, this.particles.live, MAX_LIVE_PARTICLES, PACKETS_PER_BATCH)));

        for (const event of events) {
            const requestId = typeof event.payload.requestId === "string" ? event.payload.requestId : undefined;

            switch (event.type) {
                case "loadbalancer.dispatched": {
                    this.hubPulse = 1;
                    const actor = this.actors.get(String(event.payload.backendId));

                    if (requestId !== undefined && actor !== undefined && requestBudget > 0) {
                        requestBudget--;
                        const handle = this.particles.spawn([
                            { from: hubPosition, to: actor.position.clone(), seconds: FLY_S, arc: 1.4 },
                            { from: actor.position.clone(), to: actor.position.clone(), seconds: MIN_ORBIT_S, arc: 0, hold: true },
                            { from: actor.position.clone(), to: hubPosition, seconds: RETURN_S, arc: 0.8 },
                        ], PALETTE.dispatch);

                        if (handle !== undefined) {
                            this.pending.set(requestId, handle);
                        }
                    }

                    break;
                }
                case "loadbalancer.completed":
                case "loadbalancer.failed":
                case "loadbalancer.aborted": {
                    const handle = requestId === undefined ? undefined : this.pending.get(requestId);

                    if (requestId !== undefined && handle !== undefined) {
                        const status = typeof event.payload.status === "number" ? event.payload.status : undefined;
                        const kind = event.type === "loadbalancer.aborted" ? "warn" : outcomeKind(status, event.type === "loadbalancer.failed");
                        this.particles.release(handle, PALETTE[kind]);
                        this.pending.delete(requestId);
                    }

                    break;
                }
                default:
                    break;
            }
        }

        packetEvents.forEach((event, index) => {
            if (packetPicks.has(index)) {
                this.spawnPacket(event);
            }
        });

        // Anything stored this batch has reached the queue and the database.
        if (events.length > 0) {
            this.lane.pulseQueue();
            window.setTimeout(() => this.lane.pulseDatabase(), 1200);
        }
    }

    // -------------------------------------------------------------- lifecycle

    dispose(): void {
        this.disposed = true;
        cancelAnimationFrame(this.frame);
        window.clearTimeout(this.idleTimer);
        this.resizeObserver.disconnect();
        const canvas = this.renderer.domElement;
        canvas.removeEventListener("pointerdown", this.onPointerDown);
        canvas.removeEventListener("pointerup", this.onPointerUp);
        canvas.removeEventListener("pointermove", this.onPointerMove);

        this.controls.dispose();
        this.actors.forEach((actor) => actor.dispose());
        this.actors.clear();
        this.particles.dispose();
        this.lane.dispose();
        this.satellites.dispose();
        this.disposables.forEach((item) => item.dispose());
        this.renderer.dispose();
        canvas.remove();
        this.labels.domElement.remove();
    }

    // -------------------------------------------------------------- internals

    private spawnPacket(event: StoredEvent): void {
        const queue = toVector({ x: QUEUE_POSITION.x, y: 1.6, z: QUEUE_POSITION.z });
        const processor = toVector(PROCESSOR_POSITION);
        const database = toVector({ x: DATABASE_POSITION.x, y: 1.6, z: DATABASE_POSITION.z });
        const source = event.source?.startsWith("lb-backend:") ? this.actors.get(event.source.slice("lb-backend:".length)) : undefined;
        const origin = source === undefined ? toVector(HUB_POSITION) : source.position.clone();
        const legs: Leg[] = [
            { from: origin, to: queue, seconds: PACKET_TO_QUEUE_S, arc: 2.2 },
            { from: queue, to: processor, seconds: PACKET_TO_PROCESSOR_S, arc: 0.6 },
            { from: processor, to: database, seconds: PACKET_TO_DATABASE_S, arc: 0.6 },
        ];

        this.particles.spawn(legs, PALETTE.telemetry, 0.7);
    }

    private removeActor(id: string, actor: BackendActor): void {
        this.scene.remove(actor.group);
        actor.dispose();
        this.actors.delete(id);
        const slot = this.slotOrder.indexOf(id);

        if (slot >= 0) {
            this.slotOrder.splice(slot, 1);
        }

        if (this.focusId === id) {
            this.focusId = null;
            this.satellites.clear();
            this.callbacks.onSelectBackend(null);
            this.flyTo(toVector(OVERVIEW_TARGET), OVERVIEW_OFFSET);
        }
    }

    private applyFocusStyle(): void {
        this.actors.forEach((actor, id) => actor.setFocus(id === this.focusId, this.focusId !== null && id !== this.focusId));
    }

    private flyTo(target: THREE.Vector3, offset: Vec3): void {
        this.tween = {
            fromPosition: this.camera.position.clone(),
            toPosition: target.clone().add(toVector(offset)),
            fromTarget: this.controls.target.clone(),
            toTarget: target.clone(),
            elapsed: 0,
        };
    }

    private resize(): void {
        const width = Math.max(1, this.container.clientWidth);
        const height = Math.max(1, this.container.clientHeight);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        this.labels.setSize(width, height);
    }

    private readonly loop = (time: number): void => {
        if (this.disposed) {
            return;
        }

        this.frame = requestAnimationFrame(this.loop);

        // A hidden tab keeps the loop alive but skips the work, and does not let the particles pile up a huge time step.
        if (document.hidden) {
            this.lastTime = time;
            return;
        }

        const dt = Math.min(0.1, (time - this.lastTime) / 1000);
        this.lastTime = time;
        this.now = Date.now();

        this.hubPulse = Math.max(0, this.hubPulse - dt * 4);
        this.hub.rotation.y += dt * 0.3;
        this.hub.scale.setScalar(1 + this.hubPulse * 0.12);
        this.hubMaterial.emissiveIntensity = 0.5 + this.hubPulse * 0.6;

        this.actors.forEach((actor) => actor.update(dt, this.now));
        this.lane.update(dt, time);
        this.particles.update(dt);
        this.pruneStalePending();

        if (this.focusId !== null) {
            const actor = this.actors.get(this.focusId);

            if (actor !== undefined) {
                this.satellites.group.position.copy(actor.position);
            }
        }

        if (this.tween !== undefined) {
            this.tween.elapsed += dt;
            const t = easeInOutCubic(Math.min(1, this.tween.elapsed / CAMERA_TWEEN_S));
            this.camera.position.lerpVectors(this.tween.fromPosition, this.tween.toPosition, t);
            this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, t);

            if (t >= 1) {
                this.tween = undefined;
            }
        }

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        this.labels.render(this.scene, this.camera);
    };

    /** A request whose finish event never arrived (dropped, or the balancer restarted) must not hold a particle forever. */
    private pruneStalePending(): void {
        if (this.pending.size > 3000) {
            this.pending.clear();
        }
    }

    // -------------------------------------------------------------- picking

    private readonly onPointerDown = (event: PointerEvent): void => {
        this.pointerDown = { x: event.clientX, y: event.clientY };
    };

    private readonly onPointerUp = (event: PointerEvent): void => {
        const start = this.pointerDown;
        this.pointerDown = undefined;

        if (start === undefined || Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX) {
            return;
        }

        const hit = this.pick(event);

        if (hit?.userData.backendId !== undefined) {
            const id = hit.userData.backendId as string;
            this.callbacks.onSelectBackend(id === this.focusId ? null : id);
        } else if (hit?.userData.panel !== undefined) {
            this.callbacks.onSelectPanel(hit.userData.panel as PanelName);
        } else {
            this.callbacks.onSelectBackend(null);
        }
    };

    private readonly onPointerMove = (event: PointerEvent): void => {
        this.renderer.domElement.style.cursor = this.pick(event) === undefined ? "" : "pointer";
    };

    private pick(event: PointerEvent): THREE.Object3D | undefined {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(pointer, this.camera);
        const targets = [...[...this.actors.values()].map((actor) => actor.core), ...this.lane.pickables];
        return this.raycaster.intersectObjects(targets, false)[0]?.object;
    }
}
