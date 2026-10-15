import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { RouteStats } from "../../../src/shared/apiTypes";
import { stalkHeight } from "./layout";
import { PALETTE } from "./palette";

const MAX_SATELLITES = 12;
const RING_RADIUS = 2.9;

interface Satellite {
    group: THREE.Group;
    sphere: THREE.Mesh;
    stalk: THREE.Mesh;
    element: HTMLDivElement;
    label: CSS2DObject;
}

/**
 * When a backend is selected it unfolds into one satellite per route: sized by
 * how many requests that route served, coloured by its error rate, with a stalk
 * as tall as its p95 latency. The route list comes from the 60 s summary, so it
 * is the same data the panels show.
 */
export class Satellites {
    readonly group = new THREE.Group();
    private readonly sphereGeometry = new THREE.SphereGeometry(0.5, 16, 12);
    private readonly stalkGeometry = new THREE.CylinderGeometry(0.06, 0.06, 1, 8);
    private satellites: Satellite[] = [];

    set(routes: readonly RouteStats[]): void {
        this.clear();
        const shown = routes.slice(0, MAX_SATELLITES);
        const maxCount = Math.max(1, ...shown.map((route) => route.stats.count));

        shown.forEach((route, i) => {
            const angle = (i / Math.max(1, shown.length)) * Math.PI * 2;
            const group = new THREE.Group();
            group.position.set(Math.cos(angle) * RING_RADIUS, 0.2, Math.sin(angle) * RING_RADIUS);

            const errorRate = Math.min(1, route.stats.errorRate / 0.25);
            const color = new THREE.Color(PALETTE.ok).lerp(new THREE.Color(PALETTE.bad), errorRate);
            const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.4 });
            const sphere = new THREE.Mesh(this.sphereGeometry, material);
            sphere.scale.setScalar(0.35 + 0.65 * Math.sqrt(route.stats.count / maxCount));

            const height = stalkHeight(route.stats.p95Ms);
            const stalk = new THREE.Mesh(this.stalkGeometry, new THREE.MeshBasicMaterial({ color: 0xcfd8e8, transparent: true, opacity: 0.55 }));
            stalk.scale.y = height;
            stalk.position.y = height / 2 + 0.4;

            const element = document.createElement("div");
            element.className = "lbl route";
            element.textContent = `${route.method} ${route.route} · p95 ${Math.round(route.stats.p95Ms)} ms`;
            const label = new CSS2DObject(element);
            label.position.set(0, height + 0.9, 0);

            group.add(sphere, stalk, label);
            this.group.add(group);
            this.satellites.push({ group, sphere, stalk, element, label });
        });
    }

    clear(): void {
        for (const satellite of this.satellites) {
            (satellite.sphere.material as THREE.Material).dispose();
            (satellite.stalk.material as THREE.Material).dispose();
            satellite.label.removeFromParent();
            satellite.element.remove();
            this.group.remove(satellite.group);
        }

        this.satellites = [];
    }

    dispose(): void {
        this.clear();
        this.sphereGeometry.dispose();
        this.stalkGeometry.dispose();
    }
}
