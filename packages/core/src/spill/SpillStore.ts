import fs from "node:fs";
import path from "node:path";
import { QueueItem } from "../items/QueueItem";
import { IQueueLogger } from "../logging/IQueueLogger";
import { SpillFileHeader } from "./SpillFileHeader";
import { SpillFileInfo } from "./SpillFileInfo";
import { SpillLoadResult } from "./SpillLoadResult";
import { SpillState } from "./SpillState";
import { decodeRecord, encodeRecord, isSpillHeader, isStoredItem } from "./spillRecordCodec";
import { CORRUPT_SUFFIX, SPILL_EXTENSION, spillFilePath, TEMP_EXTENSION } from "./spillFilePath";

const STATE_FILE_NAME = "state.json";

/** The version written into every header. */
const SPILL_FORMAT_VERSION = 1;

/** A header line is far smaller than this, so one read always gets all of it. */
const HEADER_READ_BYTES = 8192;

/**
 * One queue's spill folder: writes batches of items to files, keeps an
 * in-memory index of them in sequence order, and loads them back oldest first.
 *
 * It uses synchronous file calls on purpose. A queue moves items between its
 * tiers in the same step as a publish or a take, and a half-finished move
 * would put items in two places or none. The files are small batches, written
 * rarely.
 */
export class SpillStore {
    private files: SpillFileInfo[] = [];

    constructor(
        private readonly directory: string,
        private readonly logger: IQueueLogger
    ) {}

    /** Number of spill files on disk. */
    get fileCount(): number {
        return this.files.length;
    }

    /** Number of items across those files. */
    get itemCount(): number {
        return this.files.reduce((total, file) => total + file.count, 0);
    }

    /** Bytes used by those files. */
    get totalBytes(): number {
        return this.files.reduce((total, file) => total + file.bytes, 0);
    }

    /** The oldest file, which holds the items that come next. */
    oldest(): SpillFileInfo | undefined {
        return this.files[0];
    }

    /** The highest sequence number in any file, or undefined when there are none. */
    highestSequence(): number | undefined {
        return this.files.length > 0 ? Math.max(...this.files.map((file) => file.lastSequence)) : undefined;
    }

    /** True when a disk cap is reached. A cap that is not set never is. */
    isFull(maxFiles: number | undefined, maxBytes: number | undefined): boolean {
        return (maxFiles !== undefined && this.files.length >= maxFiles)
            || (maxBytes !== undefined && this.totalBytes >= maxBytes);
    }

    /**
     * Reads the folder and rebuilds the index. Leftover temporary files from an
     * interrupted write are removed; files whose header cannot be read are
     * renamed aside.
     */
    scan(): void {
        this.files = [];
        fs.mkdirSync(this.directory, { recursive: true });

        for (const day of fs.readdirSync(this.directory, { withFileTypes: true })) {
            if (!day.isDirectory()) {
                continue;
            }

            const dayDirectory = path.join(this.directory, day.name);

            for (const name of fs.readdirSync(dayDirectory)) {
                const filePath = path.join(dayDirectory, name);

                if (name.endsWith(TEMP_EXTENSION)) {
                    this.tryDelete(filePath);
                } else if (name.endsWith(SPILL_EXTENSION)) {
                    this.indexFile(filePath);
                }
            }
        }

        this.sortFiles();
    }

    /** Writes `items` (oldest first, not empty) to a new file. Throws if the disk refuses. */
    write(items: QueueItem[], now: number): SpillFileInfo {
        const first = items[0];
        const last = items[items.length - 1];
        const expiries = items.map((item) => item.expiresAt);

        const header: SpillFileHeader = {
            kind: "header",
            version: SPILL_FORMAT_VERSION,
            count: items.length,
            firstSequence: first.sequence,
            lastSequence: last.sequence,
            writtenAt: now,
        };

        // One item that never expires means the file as a whole might never expire.
        if (expiries.every((expiresAt): expiresAt is number => expiresAt !== undefined)) {
            header.maxExpiresAt = Math.max(...expiries);
        }

        const content = [header, ...items].map(encodeRecord).join("\n") + "\n";
        const finalPath = spillFilePath(this.directory, now, header.firstSequence, header.lastSequence);
        const tempPath = finalPath + TEMP_EXTENSION;

        fs.mkdirSync(path.dirname(finalPath), { recursive: true });

        // Write under another name and rename, so a file is complete or absent.
        fs.writeFileSync(tempPath, content);
        fs.renameSync(tempPath, finalPath);

        const info: SpillFileInfo = {
            path: finalPath,
            count: header.count,
            firstSequence: header.firstSequence,
            lastSequence: header.lastSequence,
            maxExpiresAt: header.maxExpiresAt,
            bytes: Buffer.byteLength(content),
        };

        this.files.push(info);
        this.sortFiles();

        return info;
    }

    /**
     * Loads the oldest file and removes it from disk. Expired items are left
     * out. A file with damaged lines gives back what could be read and is
     * renamed `.corrupt` instead of deleted.
     */
    loadOldest(now: number): SpillLoadResult {
        const file = this.files.shift();

        if (!file) {
            return { items: [], expired: 0, corrupt: false };
        }

        const result: SpillLoadResult = { items: [], expired: 0, corrupt: false };

        try {
            const lines = fs.readFileSync(file.path, "utf8").split("\n");

            for (const line of lines) {
                if (line.length === 0) {
                    continue;
                }

                const record = decodeRecord(line);

                if (isSpillHeader(record)) {
                    continue;
                }

                if (!isStoredItem(record)) {
                    result.corrupt = true;
                } else if (record.expiresAt !== undefined && record.expiresAt <= now) {
                    result.expired++;
                } else {
                    result.items.push(record);
                }
            }
        } catch (error) {
            this.logger.error(`Could not read spill file ${file.path}; its items are lost.`, error);
            result.corrupt = true;
        }

        if (result.corrupt) {
            this.logger.warn(`Spill file ${file.path} had damaged lines. Recovered ${result.items.length} items; the file was renamed ${CORRUPT_SUFFIX}.`);
            this.tryRename(file.path, file.path + CORRUPT_SUFFIX);
        } else {
            this.tryDelete(file.path);
        }

        return result;
    }

    /** Deletes the oldest file and returns how many items it held. */
    deleteOldest(): number {
        const file = this.files.shift();

        if (!file) {
            return 0;
        }

        this.tryDelete(file.path);

        return file.count;
    }

    /** Deletes every file whose items have all expired, without opening it. Returns the item count. */
    deleteExpired(now: number): number {
        let deletedItems = 0;

        this.files = this.files.filter((file) => {
            if (file.maxExpiresAt === undefined || file.maxExpiresAt > now) {
                return true;
            }

            this.tryDelete(file.path);
            deletedItems += file.count;

            return false;
        });

        return deletedItems;
    }

    /** Deletes every file and returns how many items they held. */
    deleteAll(): number {
        const items = this.itemCount;

        for (const file of this.files) {
            this.tryDelete(file.path);
        }

        this.files = [];

        return items;
    }

    /** Reads the saved state, or undefined if there is none or it is unreadable. */
    readState(): SpillState | undefined {
        try {
            const parsed = JSON.parse(fs.readFileSync(path.join(this.directory, STATE_FILE_NAME), "utf8")) as Partial<SpillState>;

            if (typeof parsed.nextSequence === "number" && Number.isInteger(parsed.nextSequence) && parsed.nextSequence >= 1) {
                return { nextSequence: parsed.nextSequence };
            }
        } catch {
            // No state yet, or it is damaged. Either way the queue falls back to the files.
        }

        return undefined;
    }

    /** Saves the state. */
    writeState(state: SpillState): void {
        const statePath = path.join(this.directory, STATE_FILE_NAME);
        const tempPath = statePath + TEMP_EXTENSION;

        fs.mkdirSync(this.directory, { recursive: true });
        fs.writeFileSync(tempPath, JSON.stringify(state));
        fs.renameSync(tempPath, statePath);
    }

    private indexFile(filePath: string): void {
        try {
            const descriptor = fs.openSync(filePath, "r");

            try {
                const buffer = Buffer.alloc(HEADER_READ_BYTES);
                const bytesRead = fs.readSync(descriptor, buffer, 0, HEADER_READ_BYTES, 0);
                const firstLine = buffer.toString("utf8", 0, bytesRead).split("\n")[0];
                const header = decodeRecord(firstLine);

                if (!isSpillHeader(header) || !Number.isInteger(header.count) || !Number.isInteger(header.firstSequence)) {
                    throw new Error("The header line is missing or damaged.");
                }

                this.files.push({
                    path: filePath,
                    count: header.count,
                    firstSequence: header.firstSequence,
                    lastSequence: header.lastSequence,
                    maxExpiresAt: header.maxExpiresAt,
                    bytes: fs.fstatSync(descriptor).size,
                });
            } finally {
                fs.closeSync(descriptor);
            }
        } catch (error) {
            this.logger.warn(`Spill file ${filePath} could not be read (${error instanceof Error ? error.message : String(error)}); renaming it ${CORRUPT_SUFFIX}.`);
            this.tryRename(filePath, filePath + CORRUPT_SUFFIX);
        }
    }

    /**
     * Oldest items first. Sorted by first sequence rather than by name or time,
     * because the shutdown flush writes older items after newer runtime files.
     */
    private sortFiles(): void {
        this.files.sort((a, b) => a.firstSequence - b.firstSequence);
    }

    private tryDelete(filePath: string): void {
        try {
            fs.unlinkSync(filePath);
            this.tryRemoveEmptyFolder(path.dirname(filePath));
        } catch (error) {
            this.logger.warn(`Could not delete ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private tryRename(from: string, to: string): void {
        try {
            fs.renameSync(from, to);
        } catch (error) {
            this.logger.warn(`Could not rename ${from}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private tryRemoveEmptyFolder(folder: string): void {
        if (folder === this.directory) {
            return;
        }

        try {
            fs.rmdirSync(folder);
        } catch {
            // Not empty, which is the normal case.
        }
    }
}
