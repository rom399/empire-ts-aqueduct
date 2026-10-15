import * as THREE from "three";
import { arcPoint, easeInOutCubic, Vec3 } from "./layout";

/** One stretch of a particle's journey. */
export interface Leg {
    from: Vec3;
    to: Vec3;
    seconds: number;
    /** How high the path bulges at its middle. */
    arc: number;
    /** Wait here (circling the destination) until the particle is released. */
    hold?: boolean;
}

interface Particle {
    legs: Leg[];
    index: number;
    legStart: number;
    color: THREE.Color;
    size: number;
    /** Set when a held leg may end. */
    released: boolean;
    /** Colour to switch to when released (the outcome of the request). */
    releaseColor?: THREE.Color;
    /** Safety: drop the particle if it lives longer than this many seconds. */
    deadline: number;
    serial: number;
}

const TEMP_MATRIX = new THREE.Matrix4();
const TEMP_SCALE = new THREE.Vector3();
const TEMP_POSITION = new THREE.Vector3();
const IDENTITY_QUATERNION = new THREE.Quaternion();
const ORBIT_RADIUS = 0.9;
const ORBIT_SPEED = 3.2;
const MAX_LIFETIME_S = 40;

/**
 * Every moving dot in the scene (requests and telemetry packets) drawn as one
 * InstancedMesh, so a few hundred of them cost one draw call. A particle is a
 * list of legs; a leg can be a "hold", where the particle circles its
 * destination until released: that is a request waiting for its backend.
 */
export class ParticleSystem {
    readonly mesh: THREE.InstancedMesh;
    private readonly particles: Array<Particle | undefined>;
    private readonly free: number[] = [];
    private liveCount = 0;
    private clock = 0;
    private nextSerial = 1;
    /** Handle -> slot, so a handle from a particle that already ended cannot release whoever reuses its slot. */
    private readonly slotBySerial = new Map<number, number>();

    constructor(private readonly capacity: number) {
        const geometry = new THREE.SphereGeometry(0.16, 8, 6);
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.mesh.count = capacity;
        this.particles = Array.from({ length: capacity }, () => undefined);

        for (let i = capacity - 1; i >= 0; i--) {
            this.free.push(i);
            this.hide(i);
            this.mesh.setColorAt(i, new THREE.Color(0xffffff));
        }

        this.mesh.instanceMatrix.needsUpdate = true;
    }

    get live(): number {
        return this.liveCount;
    }

    get max(): number {
        return this.capacity;
    }

    /** Starts a particle and returns its handle (never reused), or undefined if the pool is full. */
    spawn(legs: Leg[], color: number, size: number = 1): number | undefined {
        const slot = this.free.pop();

        if (slot === undefined || legs.length === 0) {
            if (slot !== undefined) {
                this.free.push(slot);
            }

            return undefined;
        }

        this.particles[slot] = {
            legs,
            index: 0,
            legStart: this.clock,
            color: new THREE.Color(color),
            size,
            released: false,
            deadline: this.clock + MAX_LIFETIME_S,
            serial: 0,
        };
        const serial = this.nextSerial++;
        this.slotBySerial.set(serial, slot);
        this.particles[slot]!.serial = serial;
        this.liveCount++;
        return serial;
    }

    /** Lets a held particle leave, changing its colour to the outcome. */
    release(handle: number, color?: number): void {
        const slot = this.slotBySerial.get(handle);
        const particle = slot === undefined ? undefined : this.particles[slot];

        if (particle !== undefined) {
            particle.released = true;
            particle.releaseColor = color === undefined ? undefined : new THREE.Color(color);
        }
    }

    /** Advances every particle by `dt` seconds and writes their positions. */
    update(dt: number): void {
        this.clock += dt;

        for (let i = 0; i < this.capacity; i++) {
            const particle = this.particles[i];

            if (particle === undefined) {
                continue;
            }

            if (this.clock > particle.deadline || !this.advance(i, particle)) {
                this.kill(i);
            }
        }

        this.mesh.instanceMatrix.needsUpdate = true;

        if (this.mesh.instanceColor) {
            this.mesh.instanceColor.needsUpdate = true;
        }
    }

    dispose(): void {
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
        this.mesh.dispose();
    }

    /** Returns false when the particle has finished its last leg. */
    private advance(slot: number, particle: Particle): boolean {
        let leg = particle.legs[particle.index];
        let elapsed = this.clock - particle.legStart;

        if (leg.hold && particle.released && elapsed >= leg.seconds) {
            particle.index++;
            particle.legStart = this.clock;

            if (particle.releaseColor !== undefined) {
                particle.color.copy(particle.releaseColor);
            }

            if (particle.index >= particle.legs.length) {
                return false;
            }

            leg = particle.legs[particle.index];
            elapsed = 0;
        } else if (!leg.hold && elapsed >= leg.seconds) {
            particle.index++;
            particle.legStart = this.clock;

            if (particle.index >= particle.legs.length) {
                return false;
            }

            leg = particle.legs[particle.index];
            elapsed = 0;
        }

        let fade = 1;

        if (leg.hold) {
            const angle = this.clock * ORBIT_SPEED + slot;
            TEMP_POSITION.set(
                leg.to.x + Math.cos(angle) * ORBIT_RADIUS,
                leg.to.y + 0.3 + Math.sin(angle * 1.7) * 0.2,
                leg.to.z + Math.sin(angle) * ORBIT_RADIUS
            );
        } else {
            const t = easeInOutCubic(Math.min(1, elapsed / leg.seconds));
            const point = arcPoint(leg.from, leg.to, leg.arc, t);
            TEMP_POSITION.set(point.x, point.y, point.z);

            // The last leg shrinks away as it arrives.
            if (particle.index === particle.legs.length - 1) {
                fade = Math.max(0.1, 1 - t * 0.8);
            }
        }

        TEMP_SCALE.setScalar(particle.size * fade);
        TEMP_MATRIX.compose(TEMP_POSITION, IDENTITY_QUATERNION, TEMP_SCALE);
        this.mesh.setMatrixAt(slot, TEMP_MATRIX);
        this.mesh.setColorAt(slot, particle.color);
        return true;
    }

    private kill(slot: number): void {
        this.slotBySerial.delete(this.particles[slot]!.serial);
        this.particles[slot] = undefined;
        this.free.push(slot);
        this.liveCount--;
        this.hide(slot);
    }

    private hide(slot: number): void {
        TEMP_SCALE.setScalar(0);
        TEMP_POSITION.set(0, -1000, 0);
        TEMP_MATRIX.compose(TEMP_POSITION, IDENTITY_QUATERNION, TEMP_SCALE);
        this.mesh.setMatrixAt(slot, TEMP_MATRIX);
    }
}
