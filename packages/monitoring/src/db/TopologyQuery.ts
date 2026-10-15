import { BackendNode, TopologyResponse } from "../shared/apiTypes";
import { TelemetryDatabase } from "./TelemetryDatabase";
import { WindowStatsQuery } from "./WindowStatsQuery";

const RECENT_MS = 60_000;
const REMOVED_VISIBLE_MS = 5 * 60_000;
const IN_FLIGHT_MS = 30_000;

/** A lease this far past its expiry with no removal event means the balancer stopped reporting. */
const LEASE_GRACE_MS = 10_000;

interface BackendRow {
    id: string;
    url: string | null;
    status: string;
    first_seen_at: number;
    last_seen_at: number;
    lease_expires_at: number | null;
    removed_at: number | null;
    removal_reason: string | null;
}

/** The ring as the telemetry last described it: who is in it, how busy each is, and who recently left. */
export class TopologyQuery {
    constructor(private readonly db: TelemetryDatabase, private readonly stats: WindowStatsQuery) {}

    run(now: number): TopologyResponse {
        const rows = this.db.raw.prepare(
            `SELECT * FROM backends WHERE status = 'active' OR removed_at > ? ORDER BY status = 'active' DESC, id`
        ).all(now - REMOVED_VISIBLE_MS) as unknown as BackendRow[];

        const inFlight = new Map<string, number>();
        const pending = this.db.raw.prepare(
            `SELECT backend_id, COUNT(*) AS n FROM requests WHERE outcome = 'pending' AND dispatched_at > ? AND backend_id IS NOT NULL GROUP BY backend_id`
        ).all(now - IN_FLIGHT_MS) as unknown as Array<{ backend_id: string; n: number }>;
        pending.forEach((row) => inFlight.set(row.backend_id, Number(row.n)));

        const balancer = this.db.raw.prepare(
            `SELECT source, last_seen_at FROM sources WHERE source NOT LIKE 'lb-backend:%' ORDER BY last_seen_at DESC LIMIT 1`
        ).get() as { source: string; last_seen_at: number } | undefined;

        return {
            now,
            balancer: balancer ? { source: balancer.source, lastSeenAt: Number(balancer.last_seen_at) } : null,
            backends: rows.map((row) => this.toNode(row, now, inFlight.get(row.id) ?? 0)),
            recent: this.stats.stats(now - RECENT_MS, now + 1),
        };
    }

    private toNode(row: BackendRow, now: number, inFlight: number): BackendNode {
        const lease = row.lease_expires_at === null ? null : Number(row.lease_expires_at);
        const lapsed = row.status === "active" && lease !== null && now > lease + LEASE_GRACE_MS;
        const removed = row.status === "removed" || lapsed;

        return {
            id: row.id,
            url: row.url,
            status: removed ? "removed" : "active",
            firstSeenAt: Number(row.first_seen_at),
            lastSeenAt: Number(row.last_seen_at),
            leaseExpiresAt: removed ? null : lease,
            removedAt: row.status === "removed" ? Number(row.removed_at) : lapsed ? lease : null,
            removalReason: row.status === "removed" ? (row.removal_reason === "deregistered" ? "deregistered" : "expired") : lapsed ? "expired" : null,
            inFlight,
            recent: this.stats.stats(now - RECENT_MS, now + 1, { sql: " AND backend_id = ?", params: [row.id] }),
        };
    }
}
