/** What the queue remembers about one spill file without opening it. */
export interface SpillFileInfo {
    /** Full path of the file. */
    path: string;

    /** Items in the file. */
    count: number;

    firstSequence: number;
    lastSequence: number;

    /** The latest `expiresAt` of any item in the file. Absent when the items never expire. */
    maxExpiresAt?: number;

    /** Size of the file on disk. */
    bytes: number;
}
