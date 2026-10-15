import { QueueItem } from "../items/QueueItem";

/** What came back from loading a spill file. */
export interface SpillLoadResult {
    /** The live items, in file order. */
    items: QueueItem[];

    /** How many items were skipped because they had expired. */
    expired: number;

    /** True if some lines were damaged. The file was renamed `.corrupt`. */
    corrupt: boolean;
}
