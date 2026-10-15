import path from "node:path";
import { describe, expect, it } from "vitest";
import { spillFilePath } from "../../../src/spill/spillFilePath";

describe("spillFilePath", () => {
    const writtenAt = Date.UTC(2026, 9, 10, 9, 37, 12);

    it("puts the file in a folder for the day, named for the minute and the sequence range", () => {
        expect(spillFilePath("/q/telemetry", writtenAt, 123, 2122)).toBe(
            path.join("/q/telemetry", "2026-10-10", "2026-10-10T09-37_seq000000123-000002122.ndjson")
        );
    });

    it("never uses a colon, so the name is valid on Windows", () => {
        expect(path.basename(spillFilePath("/q", writtenAt, 1, 2))).not.toContain(":");
    });

    it("sorts names in sequence order", () => {
        const names = [10, 9, 100, 1].map((first) => path.basename(spillFilePath("/q", writtenAt, first, first + 1)));

        expect([...names].sort()).toEqual([1, 9, 10, 100].map((first) => path.basename(spillFilePath("/q", writtenAt, first, first + 1))));
    });

    it("keeps two files written in the same minute apart", () => {
        expect(spillFilePath("/q", writtenAt, 1, 100)).not.toBe(spillFilePath("/q", writtenAt, 101, 200));
    });
});
