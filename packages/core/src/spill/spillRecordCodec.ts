import zlib from "node:zlib";
import { QueueItem } from "../items/QueueItem";
import { SpillFileHeader } from "./SpillFileHeader";

/** A line is `<8 hex digits of CRC32> <json>`. */
const CHECKSUM_LENGTH = 8;

/** Wraps a record as one line of a spill file, with a checksum of its JSON text. */
export function encodeRecord(record: SpillFileHeader | QueueItem): string {
    const json = JSON.stringify(record);

    return `${checksum(json)} ${json}`;
}

/**
 * Reads one line back. Returns undefined when the checksum does not match or
 * the JSON is damaged, so the caller can skip the line and keep the rest.
 */
export function decodeRecord(line: string): unknown {
    if (line.length <= CHECKSUM_LENGTH + 1 || line[CHECKSUM_LENGTH] !== " ") {
        return undefined;
    }

    const json = line.slice(CHECKSUM_LENGTH + 1);

    if (checksum(json) !== line.slice(0, CHECKSUM_LENGTH)) {
        return undefined;
    }

    try {
        return JSON.parse(json) as unknown;
    } catch {
        return undefined;
    }
}

/** True when `value` has the fields every stored item has. */
export function isStoredItem(value: unknown): value is QueueItem {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const candidate = value as Record<string, unknown>;

    return typeof candidate.itemId === "string"
        && typeof candidate.sequence === "number"
        && typeof candidate.enqueuedAt === "number"
        && typeof candidate.type === "string"
        && typeof candidate.createdAt === "number"
        && "payload" in candidate;
}

/** True when `value` is a spill file header. */
export function isSpillHeader(value: unknown): value is SpillFileHeader {
    return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "header";
}

function checksum(text: string): string {
    return zlib.crc32(text).toString(16).padStart(CHECKSUM_LENGTH, "0");
}
