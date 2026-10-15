import { StatementSync } from "node:sqlite";
import { TelemetryDatabase } from "./TelemetryDatabase";

/**
 * The processor's heartbeat, kept in the database so the web server (a
 * different process) can show whether the processor is alive and how much it
 * has stored.
 */
export class ProcessorStatusStore {
    private readonly start: StatementSync;
    private readonly stored: StatementSync;
    private readonly polled: StatementSync;
    private readonly failed: StatementSync;

    constructor(db: TelemetryDatabase, private readonly now: () => number = Date.now) {
        this.start = db.raw.prepare(
            `UPDATE processor_status SET started_at = ?, updated_at = ?, stored_total = 0, duplicates_skipped = 0, last_error = NULL WHERE id = 1`
        );
        this.stored = db.raw.prepare(
            `UPDATE processor_status SET stored_total = stored_total + ?, duplicates_skipped = duplicates_skipped + ?,
             last_stored_at = ?, updated_at = ? WHERE id = 1`
        );
        this.polled = db.raw.prepare(`UPDATE processor_status SET last_polled_at = ?, updated_at = ? WHERE id = 1`);
        this.failed = db.raw.prepare(`UPDATE processor_status SET last_error = ?, updated_at = ? WHERE id = 1`);
    }

    markStarted(): void {
        const at = this.now();
        this.start.run(at, at);
    }

    markStored(stored: number, duplicates: number): void {
        const at = this.now();
        this.stored.run(stored, duplicates, at, at);
    }

    markPolled(): void {
        const at = this.now();
        this.polled.run(at, at);
    }

    markError(message: string): void {
        this.failed.run(message.slice(0, 500), this.now());
    }
}
