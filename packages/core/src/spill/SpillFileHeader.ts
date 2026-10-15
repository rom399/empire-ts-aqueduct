/** The first line of every spill file. */
export interface SpillFileHeader {
    kind: "header";
    version: number;
    count: number;
    firstSequence: number;
    lastSequence: number;
    maxExpiresAt?: number;
    writtenAt: number;
}
