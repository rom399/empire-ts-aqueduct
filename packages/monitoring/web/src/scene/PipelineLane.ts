import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { DatabaseResponse, QueueSample } from "../../../src/shared/apiTypes";
import { formatCount } from "../data/format";
import {
    DATABASE_POSITION, PROCESSOR_POSITION, QUEUE_HEIGHT, QUEUE_POSITION, queueFill, queueFillHeight, queueSeverity,
} from "./layout";
import { PALETTE } from "./palette";

const VESSEL_RADIUS = 1.7;
const FILL_RATE = 4;

function label(text: string, className: string): { element: HTMLDivElement; object: CSS2DObject } {
    const element = document.createElement("div");
    element.className = `lbl ${className}`;
    element.textContent = text;
    return { element, object: new CSS2DObject(element) };
}

/**
 * The telemetry's own path, drawn beside the balancer: the queue (a glass
 * vessel that fills with its depth), the processor that drains it, and the
 * database it writes to. Everything here reflects real readings: the vessel's
 * level is the broker's depth, the processor is lit only while it reports in,
 * and the database grows with its stored row count.
 */
export class PipelineLane {
    readonly group = new THREE.Group();
    readonly queuePickable = new THREE.Group();
    readonly databasePickable = new THREE.Group();

    private readonly fill: THREE.Mesh;
    private readonly fillMaterial: THREE.MeshStandardMaterial;
    private readonly queueLabel: ReturnType<typeof label>;
    private readonly processor: THREE.Mesh;
    private readonly processorMaterial: THREE.MeshStandardMaterial;
    private readonly processorLabel: ReturnType<typeof label>;
    private readonly discs: THREE.Mesh[] = [];
    private readonly databaseMaterial: THREE.MeshStandardMaterial;
    private readonly databaseLabel: ReturnType<typeof label>;
    private readonly disposables: Array<{ dispose(): void }> = [];

    private fillHeight = 0;
    private targetFillHeight = 0;
    private severity: "ok" | "warn" | "bad" = "ok";
    private processorAlive = false;
    private queuePulse = 0;
    private databasePulse = 0;
    private rows = 0;
    private dropped = 0;
    private droppedFlash = 0;

    constructor() {
        // ---- queue
        const queue = this.queuePickable;
        queue.position.set(QUEUE_POSITION.x, QUEUE_POSITION.y, QUEUE_POSITION.z);

        const glass = new THREE.Mesh(
            new THREE.CylinderGeometry(VESSEL_RADIUS, VESSEL_RADIUS, QUEUE_HEIGHT, 32, 1, true),
            new THREE.MeshStandardMaterial({ color: 0x9bd1ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, roughness: 0.2 })
        );
        glass.position.y = QUEUE_HEIGHT / 2;
        glass.userData.panel = "queue";
        const base = new THREE.Mesh(
            new THREE.CylinderGeometry(VESSEL_RADIUS + 0.1, VESSEL_RADIUS + 0.1, 0.2, 32),
            new THREE.MeshStandardMaterial({ color: 0x24324d, roughness: 0.6 })
        );
        base.position.y = -0.1;
        base.userData.panel = "queue";
        this.fillMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.queue, emissive: PALETTE.queue, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 });
        this.fill = new THREE.Mesh(new THREE.CylinderGeometry(VESSEL_RADIUS - 0.12, VESSEL_RADIUS - 0.12, 1, 32), this.fillMaterial);
        this.fill.userData.panel = "queue";
        this.fill.visible = false;
        this.queueLabel = label("queue", "pipe queue");
        this.queueLabel.object.position.set(0, QUEUE_HEIGHT + 0.9, 0);
        queue.add(glass, base, this.fill, this.queueLabel.object);
        this.disposables.push(glass.geometry, glass.material as THREE.Material, base.geometry, base.material as THREE.Material, this.fill.geometry, this.fillMaterial);

        // ---- processor
        this.processorMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.processor, emissive: PALETTE.processor, emissiveIntensity: 0.4, roughness: 0.35 });
        this.processor = new THREE.Mesh(new THREE.OctahedronGeometry(1.0, 0), this.processorMaterial);
        this.processor.position.set(PROCESSOR_POSITION.x, PROCESSOR_POSITION.y, PROCESSOR_POSITION.z);
        this.processorLabel = label("processor", "pipe processor");
        this.processorLabel.object.position.set(0, 1.9, 0);
        this.processor.add(this.processorLabel.object);
        this.disposables.push(this.processor.geometry, this.processorMaterial);

        // ---- database
        const database = this.databasePickable;
        database.position.set(DATABASE_POSITION.x, DATABASE_POSITION.y, DATABASE_POSITION.z);
        this.databaseMaterial = new THREE.MeshStandardMaterial({ color: 0xc99a1e, emissive: PALETTE.database, emissiveIntensity: 0.12, roughness: 0.5 });
        const discGeometry = new THREE.CylinderGeometry(1.5, 1.5, 0.7, 36);
        this.disposables.push(discGeometry, this.databaseMaterial);

        for (let i = 0; i < 3; i++) {
            const disc = new THREE.Mesh(discGeometry, this.databaseMaterial);
            disc.position.y = 0.4 + i * 0.85;
            disc.userData.panel = "database";
            this.discs.push(disc);
            database.add(disc);
        }

        this.databaseLabel = label("database", "pipe database");
        this.databaseLabel.object.position.set(0, 3.7, 0);
        database.add(this.databaseLabel.object);

        // ---- guide lines
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x5b6b8c, transparent: true, opacity: 0.35 });
        const points = [
            new THREE.Vector3(QUEUE_POSITION.x + VESSEL_RADIUS, 1.4, QUEUE_POSITION.z), new THREE.Vector3(PROCESSOR_POSITION.x - 1.1, PROCESSOR_POSITION.y, PROCESSOR_POSITION.z),
            new THREE.Vector3(PROCESSOR_POSITION.x + 1.1, PROCESSOR_POSITION.y, PROCESSOR_POSITION.z), new THREE.Vector3(DATABASE_POSITION.x - 1.6, 1.4, DATABASE_POSITION.z),
        ];
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
        this.group.add(new THREE.LineSegments(lineGeometry, lineMaterial));
        this.disposables.push(lineGeometry, lineMaterial);

        this.group.add(queue, this.processor, database);
        this.setQueue(null);
        this.setDatabase(undefined);
        this.setProcessor(false);
    }

    /** Things the camera can be asked to look at, and the clicks that open panels. */
    get pickables(): THREE.Object3D[] {
        return [...this.queuePickable.children.filter((child) => child.userData.panel), ...this.discs];
    }

    setQueue(sample: QueueSample | null): void {
        if (sample === null) {
            this.targetFillHeight = 0;
            this.queueLabel.element.textContent = "queue · no reading";
            return;
        }

        const fill = queueFill(sample.depth, sample.maxSize);
        this.targetFillHeight = queueFillHeight(sample.depth, sample.maxSize);
        this.severity = queueSeverity(fill);

        if (sample.dropped > this.dropped && this.dropped > 0) {
            this.droppedFlash = 1;
        }

        this.dropped = sample.dropped;
        const flags = [sample.inFlight > 0 ? `${sample.inFlight} in flight` : "", sample.spilled > 0 ? `${formatCount(sample.spilled)} spilled` : "", sample.dropped > 0 ? `${formatCount(sample.dropped)} dropped` : ""]
            .filter(Boolean).join(" · ");
        this.queueLabel.element.textContent = `${sample.queue} · ${formatCount(sample.depth)} / ${formatCount(sample.maxSize)}${flags ? ` · ${flags}` : ""}`;
    }

    setProcessor(alive: boolean): void {
        this.processorAlive = alive;
        this.processorLabel.element.textContent = alive ? "processor" : "processor · not running";
        this.processorLabel.element.classList.toggle("gone", !alive);
    }

    setDatabase(info: DatabaseResponse | undefined): void {
        const events = info?.tables.find((table) => table.name === "events")?.rows ?? 0;
        this.rows = events;
        this.databaseLabel.element.textContent = info === undefined ? "database" : `SQLite · ${formatCount(events)} events`;
    }

    /** Something just reached the queue / the database: flash them. */
    pulseQueue(): void {
        this.queuePulse = 1;
    }

    pulseDatabase(): void {
        this.databasePulse = 1;
    }

    update(dt: number, time: number): void {
        const blend = 1 - Math.exp(-FILL_RATE * dt);
        this.fillHeight += (this.targetFillHeight - this.fillHeight) * blend;
        this.fill.visible = this.fillHeight > 0.02;
        this.fill.scale.set(1, Math.max(0.01, this.fillHeight), 1);
        this.fill.position.y = this.fillHeight / 2;

        const color = new THREE.Color(this.severity === "bad" ? PALETTE.bad : this.severity === "warn" ? PALETTE.warn : PALETTE.queue);
        this.droppedFlash = Math.max(0, this.droppedFlash - dt * 1.5);
        this.queuePulse = Math.max(0, this.queuePulse - dt * 3);
        this.fillMaterial.color.copy(color);
        this.fillMaterial.emissive.copy(color);
        this.fillMaterial.emissiveIntensity = 0.45 + this.queuePulse * 0.5 + this.droppedFlash * 0.8;

        this.processor.rotation.y += dt * (this.processorAlive ? 1.6 : 0.1);
        this.processor.rotation.x = Math.sin(time / 900) * 0.2;
        const processorColor = new THREE.Color(this.processorAlive ? PALETTE.processor : PALETTE.gone);
        this.processorMaterial.color.copy(processorColor);
        this.processorMaterial.emissive.copy(processorColor);
        this.processorMaterial.emissiveIntensity = this.processorAlive ? 0.4 + 0.2 * Math.sin(time / 300) : 0.05;

        this.databasePulse = Math.max(0, this.databasePulse - dt * 3.5);
        const growth = 1 + Math.min(0.35, Math.log10(1 + this.rows) * 0.05);
        this.discs.forEach((disc, i) => {
            disc.scale.set(growth, 1 + this.databasePulse * 0.12 * (i + 1), growth);
        });
        this.databaseMaterial.emissiveIntensity = 0.12 + this.databasePulse * 0.6;
    }

    dispose(): void {
        this.disposables.forEach((item) => item.dispose());
        [this.queueLabel, this.processorLabel, this.databaseLabel].forEach((entry) => {
            entry.object.removeFromParent();
            entry.element.remove();
        });
    }
}
