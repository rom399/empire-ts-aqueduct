import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema";

/** How long a writer waits for another process's write to finish before giving up. */
const BUSY_TIMEOUT_MS = 5000;

/**
 * The SQLite file shared by the processor (which writes) and the web server
 * (which reads). Uses Node's built-in `node:sqlite`, so there is no native
 * add-on to build - but that module is still marked experimental by Node.
 *
 * WAL mode lets the server read while the processor writes, from separate
 * processes. Opening is safe to do from both at once.
 */
export class TelemetryDatabase {
    readonly raw: DatabaseSync;

    constructor(readonly filePath: string) {
        if (filePath !== ":memory:") {
            fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
        }

        this.raw = new DatabaseSync(filePath);
        this.raw.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
        this.raw.exec("PRAGMA journal_mode = WAL");
        this.raw.exec("PRAGMA synchronous = NORMAL");
        this.migrate();
    }

    /** Runs `work` inside one transaction; rolls back if it throws. */
    transaction<T>(work: () => T): T {
        this.raw.exec("BEGIN IMMEDIATE");

        try {
            const result = work();
            this.raw.exec("COMMIT");
            return result;
        } catch (err) {
            this.raw.exec("ROLLBACK");
            throw err;
        }
    }

    /** Size of the database file in bytes, including the write-ahead log. 0 for an in-memory database. */
    sizeBytes(): number {
        if (this.filePath === ":memory:") {
            return 0;
        }

        return [this.filePath, `${this.filePath}-wal`].reduce((total, file) => {
            try {
                return total + fs.statSync(file).size;
            } catch {
                return total;
            }
        }, 0);
    }

    close(): void {
        this.raw.close();
    }

    private migrate(): void {
        const current = Number((this.raw.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);

        if (current > SCHEMA_VERSION) {
            throw new Error(`The database at ${this.filePath} is version ${current}, newer than this program understands (${SCHEMA_VERSION}).`);
        }

        for (let version = current; version < SCHEMA_VERSION; version++) {
            this.transaction(() => {
                MIGRATIONS[version].forEach((statement) => this.raw.exec(statement));
                this.raw.exec(`PRAGMA user_version = ${version + 1}`);
            });
        }
    }
}
