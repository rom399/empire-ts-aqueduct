import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QueueItem } from "../../../src/items/QueueItem";
import { SpillStore } from "../../../src/spill/SpillStore";
import { listFiles, makeTempDirectory } from "../../fixtures/files/makeTempDirectory";
import { TestQueueLogger } from "../../fixtures/logging/TestQueueLogger";

const NOW = Date.UTC(2026, 9, 10, 9, 37);

function itemsFrom(first: number, count: number, expiresAt?: number): QueueItem[] {
    return Array.from({ length: count }, (_, index) => ({
        itemId: `id-${first + index}`,
        sequence: first + index,
        enqueuedAt: NOW,
        type: "t",
        createdAt: NOW,
        payload: { n: first + index },
        ...(expiresAt !== undefined ? { expiresAt } : {}),
    }));
}

function makeStore(): { store: SpillStore; directory: string; logger: TestQueueLogger } {
    const directory = path.join(makeTempDirectory(), "q");
    const logger = new TestQueueLogger();

    return { store: new SpillStore(directory, logger), directory, logger };
}

describe("SpillStore", () => {
    describe("writing", () => {
        it("writes a file and counts its items and bytes", () => {
            const { store } = makeStore();

            const info = store.write(itemsFrom(1, 3), NOW);

            expect(info).toMatchObject({ count: 3, firstSequence: 1, lastSequence: 3 });
            expect(store.fileCount).toBe(1);
            expect(store.itemCount).toBe(3);
            expect(store.totalBytes).toBe(fs.statSync(info.path).size);
        });

        it("uses a Windows-safe name inside a folder for the day", () => {
            const { store, directory } = makeStore();

            store.write(itemsFrom(1, 2), NOW);

            expect(listFiles(directory)).toEqual([path.join("2026-10-10", "2026-10-10T09-37_seq000000001-000000002.ndjson")]);
        });

        it("leaves no temporary file behind", () => {
            const { store, directory } = makeStore();

            store.write(itemsFrom(1, 2), NOW);

            expect(listFiles(directory).some((name) => name.endsWith(".tmp"))).toBe(false);
        });

        it("records the newest expiry when every item expires", () => {
            const { store } = makeStore();

            expect(store.write(itemsFrom(1, 2, NOW + 500), NOW).maxExpiresAt).toBe(NOW + 500);
        });

        it("records no expiry when any item never expires", () => {
            const { store } = makeStore();
            const items = [...itemsFrom(1, 1, NOW + 500), ...itemsFrom(2, 1)];

            expect(store.write(items, NOW).maxExpiresAt).toBeUndefined();
        });
    });

    describe("loading", () => {
        it("loads the oldest file's items in order and deletes the file", () => {
            const { store, directory } = makeStore();

            store.write(itemsFrom(1, 3), NOW);

            const loaded = store.loadOldest(NOW);

            expect(loaded.items.map((item) => item.sequence)).toEqual([1, 2, 3]);
            expect(loaded.corrupt).toBe(false);
            expect(store.fileCount).toBe(0);
            expect(listFiles(directory)).toEqual([]);
        });

        it("loads files oldest first by sequence, whatever order they were written in", () => {
            const { store } = makeStore();

            // A shutdown flush writes older items after newer runtime files.
            store.write(itemsFrom(11, 2), NOW);
            store.write(itemsFrom(1, 2), NOW);

            expect(store.loadOldest(NOW).items[0].sequence).toBe(1);
            expect(store.loadOldest(NOW).items[0].sequence).toBe(11);
        });

        it("leaves out items that expired and counts them", () => {
            const { store } = makeStore();

            store.write([...itemsFrom(1, 2, NOW - 1), ...itemsFrom(3, 1, NOW + 1000)], NOW);

            const loaded = store.loadOldest(NOW);

            expect(loaded.items.map((item) => item.sequence)).toEqual([3]);
            expect(loaded.expired).toBe(2);
        });

        it("returns nothing when there are no files", () => {
            const { store } = makeStore();

            expect(store.loadOldest(NOW)).toEqual({ items: [], expired: 0, corrupt: false });
        });

        it("salvages the good lines of a damaged file and renames it .corrupt", () => {
            const { store, directory, logger } = makeStore();
            const info = store.write(itemsFrom(1, 3), NOW);
            const lines = fs.readFileSync(info.path, "utf8").split("\n");

            lines[2] = lines[2].replace("id-2", "id-X");
            fs.writeFileSync(info.path, lines.join("\n"));

            const loaded = store.loadOldest(NOW);

            expect(loaded.items.map((item) => item.sequence)).toEqual([1, 3]);
            expect(loaded.corrupt).toBe(true);
            expect(listFiles(directory).map((name) => path.basename(name))).toEqual([path.basename(info.path) + ".corrupt"]);
            expect(logger.warnings.length).toBe(1);
        });
    });

    describe("deleting", () => {
        it("deletes the oldest file and returns its item count", () => {
            const { store } = makeStore();

            store.write(itemsFrom(1, 3), NOW);
            store.write(itemsFrom(4, 2), NOW);

            expect(store.deleteOldest()).toBe(3);
            expect(store.oldest()?.firstSequence).toBe(4);
        });

        it("deletes only the files that have fully expired, without opening them", () => {
            const { store } = makeStore();

            store.write(itemsFrom(1, 2, NOW + 100), NOW);
            store.write(itemsFrom(3, 2, NOW + 900), NOW);
            store.write(itemsFrom(5, 2), NOW);

            expect(store.deleteExpired(NOW + 500)).toBe(2);
            expect(store.fileCount).toBe(2);
        });

        it("deletes everything", () => {
            const { store, directory } = makeStore();

            store.write(itemsFrom(1, 3), NOW);
            store.write(itemsFrom(4, 2), NOW);

            expect(store.deleteAll()).toBe(5);
            expect(listFiles(directory)).toEqual([]);
        });
    });

    describe("disk caps", () => {
        it("is full when the file cap is reached", () => {
            const { store } = makeStore();

            store.write(itemsFrom(1, 1), NOW);

            expect(store.isFull(1, undefined)).toBe(true);
            expect(store.isFull(2, undefined)).toBe(false);
        });

        it("is full when the byte cap is reached", () => {
            const { store } = makeStore();

            store.write(itemsFrom(1, 1), NOW);

            expect(store.isFull(undefined, store.totalBytes)).toBe(true);
            expect(store.isFull(undefined, store.totalBytes + 1)).toBe(false);
        });

        it("is never full when no cap is set", () => {
            const { store } = makeStore();

            store.write(itemsFrom(1, 1), NOW);

            expect(store.isFull(undefined, undefined)).toBe(false);
        });
    });

    describe("scanning an existing folder", () => {
        it("rebuilds the index from the files, in sequence order", () => {
            const { store, directory, logger } = makeStore();

            store.write(itemsFrom(11, 2), NOW);
            store.write(itemsFrom(1, 2), NOW);

            const fresh = new SpillStore(directory, logger);

            fresh.scan();

            expect(fresh.fileCount).toBe(2);
            expect(fresh.itemCount).toBe(4);
            expect(fresh.oldest()?.firstSequence).toBe(1);
            expect(fresh.highestSequence()).toBe(12);
        });

        it("removes a temporary file left by an interrupted write", () => {
            const { store, directory, logger } = makeStore();
            const info = store.write(itemsFrom(1, 2), NOW);

            fs.writeFileSync(info.path.replace(".ndjson", "x.ndjson.tmp"), "half a file");

            const fresh = new SpillStore(directory, logger);

            fresh.scan();

            expect(listFiles(directory).some((name) => name.endsWith(".tmp"))).toBe(false);
            expect(fresh.fileCount).toBe(1);
        });

        it("renames a file with an unreadable header aside and carries on", () => {
            const { store, directory, logger } = makeStore();
            const info = store.write(itemsFrom(1, 2), NOW);

            fs.writeFileSync(info.path, "this is not a spill file\n");

            const fresh = new SpillStore(directory, logger);

            fresh.scan();

            expect(fresh.fileCount).toBe(0);
            expect(listFiles(directory).map((name) => path.basename(name))).toEqual([path.basename(info.path) + ".corrupt"]);
            expect(logger.warnings.length).toBeGreaterThan(0);
        });

        it("starts empty when the folder does not exist yet", () => {
            const { store } = makeStore();

            store.scan();

            expect(store.fileCount).toBe(0);
        });
    });

    describe("state", () => {
        it("saves and reads the next sequence number", () => {
            const { store } = makeStore();

            store.writeState({ nextSequence: 42 });

            expect(store.readState()).toEqual({ nextSequence: 42 });
        });

        it("reads nothing when there is no state or it is damaged", () => {
            const { store, directory } = makeStore();

            expect(store.readState()).toBeUndefined();

            fs.mkdirSync(directory, { recursive: true });
            fs.writeFileSync(path.join(directory, "state.json"), "{broken");

            expect(store.readState()).toBeUndefined();
        });
    });
});
