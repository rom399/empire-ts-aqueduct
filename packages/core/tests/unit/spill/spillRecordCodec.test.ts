import { describe, expect, it } from "vitest";
import { decodeRecord, encodeRecord, isSpillHeader, isStoredItem } from "../../../src/spill/spillRecordCodec";
import { QueueItem } from "../../../src/items/QueueItem";

const item: QueueItem = {
    itemId: "i-1", sequence: 1, enqueuedAt: 5, type: "t", createdAt: 4, payload: { a: [1, 2] },
};

describe("spillRecordCodec", () => {
    it("round-trips a record", () => {
        expect(decodeRecord(encodeRecord(item))).toEqual(item);
    });

    it("writes a record as one line", () => {
        expect(encodeRecord({ ...item, payload: "line\nbreak" })).not.toContain("\n");
    });

    it("rejects a line whose content was changed", () => {
        const line = encodeRecord(item);

        expect(decodeRecord(line.replace('"t"', '"u"'))).toBeUndefined();
    });

    it("rejects a line that was cut short", () => {
        expect(decodeRecord(encodeRecord(item).slice(0, 20))).toBeUndefined();
    });

    it("rejects an empty or garbage line", () => {
        expect(decodeRecord("")).toBeUndefined();
        expect(decodeRecord("not a record at all")).toBeUndefined();
    });

    it("tells headers from items", () => {
        expect(isSpillHeader({ kind: "header" })).toBe(true);
        expect(isSpillHeader(item)).toBe(false);
        expect(isStoredItem(item)).toBe(true);
        expect(isStoredItem({ kind: "header" })).toBe(false);
        expect(isStoredItem(null)).toBe(false);
    });
});
