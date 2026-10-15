import path from "node:path";

/** Sequence numbers are padded so names sort in sequence order. */
const SEQUENCE_DIGITS = 9;

/** Characters of an ISO timestamp that make up the date, `yyyy-MM-dd`. */
const DATE_LENGTH = 10;

/** Characters of an ISO timestamp up to the minute, `yyyy-MM-ddTHH:mm`. */
const MINUTE_LENGTH = 16;

/** The extension of a finished spill file. */
export const SPILL_EXTENSION = ".ndjson";

/** The extension a file has while it is being written. */
export const TEMP_EXTENSION = ".tmp";

/** The suffix added to a file that could not be read cleanly. */
export const CORRUPT_SUFFIX = ".corrupt";

/**
 * Where a spill file goes: `<queueDirectory>/<yyyy-MM-dd>/<yyyy-MM-ddTHH-mm>_seq<first>-<last>.ndjson`.
 *
 * Colons never appear, so the name is valid on Windows. The sequence range
 * keeps two files written in the same minute apart. UTC is used so the folder
 * does not change with the machine's time zone.
 */
export function spillFilePath(queueDirectory: string, writtenAt: number, firstSequence: number, lastSequence: number): string {
    const iso = new Date(writtenAt).toISOString();
    const day = iso.slice(0, DATE_LENGTH);
    const minute = iso.slice(0, MINUTE_LENGTH).replace(":", "-");
    const first = String(firstSequence).padStart(SEQUENCE_DIGITS, "0");
    const last = String(lastSequence).padStart(SEQUENCE_DIGITS, "0");

    return path.join(queueDirectory, day, `${minute}_seq${first}-${last}${SPILL_EXTENSION}`);
}
