import { NewQueueItem } from "../../../src/items/NewQueueItem";

/** A valid item a producer might send. `n` is put in the payload so tests can tell items apart. */
export function newItem(n: number = 0, overrides: Partial<NewQueueItem> = {}): NewQueueItem {
    return {
        type: "test.event",
        payload: { n },
        createdAt: 1_700_000_000_000,
        ...overrides,
    };
}

/** The `n` values of items, in order. */
export function payloadNumbers(items: { payload: unknown }[]): number[] {
    return items.map((item) => (item.payload as { n: number }).n);
}
