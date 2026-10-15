import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { BackendNode } from "../../../src/shared/apiTypes";
import { leaseRemaining, nodeScale, Vec3 } from "./layout";
import { PALETTE } from "./palette";

const LEASE_SEGMENTS = 48;
const LEASE_RADIUS = 1.35;
const MOVE_RATE = 3;
const SPAWN_SECONDS = 0.6;

/**
 * One backend in the scene: a sphere on the ring, a lease arc around it that
 * drains between heartbeats, and a label. A backend that left stays visible for
 * a while, grey after a clean shutdown and red-and-flickering after a crash, so
 * the two look different.
 */
export class BackendActor {
    readonly group = new THREE.Group();
    readonly core: THREE.Mesh;
    private readonly material: THREE.MeshStandardMaterial;
    private readonly arc: THREE.Line;
    private readonly arcPositions: Float32Array;
    private readonly labelElement = document.createElement("div");
    private readonly label: CSS2DObject;
    private target: Vec3 = { x: 0, y: 0.6, z: 0 };
    private age = 0;
    private data: BackendNode | undefined;
    private focused = false;
    private dimmed = false;

    constructor(readonly id: string, start: Vec3) {
        this.group.position.set(start.x, start.y, start.z);
        this.group.scale.setScalar(0.01);

        this.material = new THREE.MeshStandardMaterial({
            color: PALETTE.node, emissive: PALETTE.node, emissiveIntensity: 0.55, roughness: 0.4, transparent: true,
        });
        this.core = new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 18), this.material);
        this.core.userData.backendId = id;
        this.group.add(this.core);

        this.arcPositions = new Float32Array((LEASE_SEGMENTS + 1) * 3);
        const arcGeometry = new THREE.BufferGeometry();
        arcGeometry.setAttribute("position", new THREE.BufferAttribute(this.arcPositions, 3));
        this.arc = new THREE.Line(arcGeometry, new THREE.LineBasicMaterial({ color: PALETTE.lease, transparent: true }));
        this.arc.rotation.x = -Math.PI / 2;
        this.group.add(this.arc);

        this.labelElement.className = "lbl node";
        this.label = new CSS2DObject(this.labelElement);
        this.label.position.set(0, 1.5, 0);
        this.group.add(this.label);
    }

    get position(): THREE.Vector3 {
        return this.group.position;
    }

    get isGone(): boolean {
        return this.data?.status === "removed";
    }

    setTarget(target: Vec3): void {
        this.target = target;
    }

    setFocus(focused: boolean, dimmed: boolean): void {
        this.focused = focused;
        this.dimmed = dimmed;
    }

    apply(data: BackendNode): void {
        this.data = data;
        const port = data.url ? safePort(data.url) : "";
        const detail = data.status === "removed"
            ? (data.removalReason === "expired" ? "crashed" : "left")
            : `${data.recent.perSecond.toFixed(1)}/s`;

        this.labelElement.textContent = `${data.id}${port} · ${detail}`;
        this.labelElement.classList.toggle("gone", data.status === "removed");
        this.labelElement.classList.toggle("crashed", data.status === "removed" && data.removalReason === "expired");
    }

    update(dt: number, now: number): void {
        this.age += dt;
        const blend = 1 - Math.exp(-MOVE_RATE * dt);
        this.group.position.x += (this.target.x - this.group.position.x) * blend;
        this.group.position.y += (this.target.y - this.group.position.y) * blend;
        this.group.position.z += (this.target.z - this.group.position.z) * blend;

        const data = this.data;
        const gone = data?.status === "removed";
        const crashed = gone && data?.removalReason === "expired";
        const grow = Math.min(1, this.age / SPAWN_SECONDS);
        const eased = 1 - Math.pow(1 - grow, 3);
        const size = (data ? nodeScale(data.recent.perSecond) : 1) * (gone ? 0.8 : 1) * (this.focused ? 1.15 : 1);
        this.group.scale.setScalar(Math.max(0.01, eased * size));

        const errorTint = data ? Math.min(1, data.recent.errorRate / 0.3) : 0;
        const base = new THREE.Color(gone ? PALETTE.gone : PALETTE.node);
        base.lerp(new THREE.Color(PALETTE.bad), crashed ? 0.7 : errorTint * 0.7);
        this.material.color.copy(base);
        this.material.emissive.copy(base);
        const flicker = crashed ? 0.3 + 0.2 * Math.sin(now / 90) : 0.55;
        this.material.emissiveIntensity = gone && !crashed ? 0.1 : flicker;
        this.material.opacity = (gone ? 0.5 : 1) * (this.dimmed ? 0.3 : 1);

        this.updateArc(data, now, gone);
        this.labelElement.style.opacity = this.dimmed ? "0.3" : "1";
    }

    dispose(): void {
        this.core.geometry.dispose();
        this.material.dispose();
        this.arc.geometry.dispose();
        (this.arc.material as THREE.Material).dispose();
        this.label.removeFromParent();
        this.labelElement.remove();
    }

    private updateArc(data: BackendNode | undefined, now: number, gone: boolean): void {
        const remaining = gone || data === undefined ? 0 : leaseRemaining(data.leaseExpiresAt, now);
        const arcMaterial = this.arc.material as THREE.LineBasicMaterial;
        const segments = Math.round(remaining * LEASE_SEGMENTS);

        for (let i = 0; i <= LEASE_SEGMENTS; i++) {
            const angle = (Math.min(i, segments) / LEASE_SEGMENTS) * Math.PI * 2;
            this.arcPositions[i * 3] = Math.cos(angle) * LEASE_RADIUS;
            this.arcPositions[i * 3 + 1] = Math.sin(angle) * LEASE_RADIUS;
            this.arcPositions[i * 3 + 2] = 0;
        }

        (this.arc.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        arcMaterial.opacity = remaining === 0 ? 0 : this.dimmed ? 0.2 : 0.8;
        arcMaterial.color.set(remaining < 0.25 ? PALETTE.warn : PALETTE.lease);
    }
}

function safePort(url: string): string {
    try {
        const port = new URL(url).port;
        return port ? `:${port}` : "";
    } catch {
        return "";
    }
}
