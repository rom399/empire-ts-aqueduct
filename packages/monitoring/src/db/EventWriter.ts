import { StatementSync } from "node:sqlite";
import { EventProjector } from "./EventProjector";
import { IncomingItem } from "./IncomingItem";
import { StoreResult } from "./StoreResult";
import { TelemetryDatabase } from "./TelemetryDatabase";

/**
 * Writes a batch of queue items: the raw event row and the summary updates it
 * implies, all in one transaction. Items the database already has (the broker
 * redelivered them because an acknowledgement was lost) are skipped, found by
 * the broker's item id, so storing is safe to repeat.
 *
 * An item that is not well formed is skipped and counted, not allowed to fail the batch. A summary update that fails for one item never loses the raw event or blocks
 * the rest of the batch; it is counted in `projectionErrors`.
 */
export class EventWriter {
    private readonly insert: StatementSync;
    private readonly projector: EventProjector;

    constructor(private readonly db: TelemetryDatabase, private readonly now: () => number = Date.now) {
        this.projector = new EventProjector(db);
        this.insert = db.raw.prepare(
            // ON CONFLICT, not OR IGNORE: only a repeated item id may be skipped. OR IGNORE would also swallow a
            // NOT NULL violation and report a broken item as a harmless duplicate.
            `INSERT INTO events (item_id, queue_seq, type, source, correlation_id, created_at, enqueued_at, stored_at, payload)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(item_id) DO NOTHING`
        );
    }

    storeBatch(items: IncomingItem[]): StoreResult {
        const result: StoreResult = { stored: 0, duplicates: 0, invalid: 0, projectionErrors: 0 };
        const storedAt = this.now();

        this.db.transaction(() => {
            for (const item of items) {
                if (!isWellFormed(item)) {
                    result.invalid++;
                    continue;
                }

                const payload = isRecord(item.payload) ? item.payload : { value: item.payload };
                const written = this.insert.run(
                    item.itemId,
                    item.sequence ?? null,
                    item.type,
                    item.source ?? null,
                    item.correlationId ?? null,
                    item.createdAt,
                    item.enqueuedAt ?? null,
                    storedAt,
                    JSON.stringify(payload)
                );

                if (Number(written.changes) === 0) {
                    result.duplicates++;
                    continue;
                }

                result.stored++;

                try {
                    this.projector.apply({ type: item.type, source: item.source ?? null, at: item.createdAt, payload });
                } catch {
                    result.projectionErrors++;
                }
            }
        });

        return result;
    }
}

/** The broker validates items, so this should never fail; but one bad item must not wedge the batch it arrived in. */
function isWellFormed(item: IncomingItem): boolean {
    return typeof item.itemId === "string" && item.itemId.length > 0
        && typeof item.type === "string" && item.type.length > 0
        && typeof item.createdAt === "number" && Number.isFinite(item.createdAt);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
