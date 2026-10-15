/** Once this many slots at the front are unused, the array is compacted. */
const COMPACT_THRESHOLD = 1024;

/**
 * A first-in first-out list that is cheap at both ends of the common
 * operations: adding at the back and removing from the front are O(1).
 * Returning a batch to the front is O(n), which only happens on a receipt
 * timeout.
 */
export class ItemDeque<T> {
    private items: T[] = [];
    private head = 0;

    get length(): number {
        return this.items.length - this.head;
    }

    /** Adds to the back. */
    pushBack(item: T): void {
        this.items.push(item);
    }

    /** Puts `batch` in front of everything, keeping its own order. */
    pushFront(batch: T[]): void {
        if (batch.length === 0) {
            return;
        }

        this.items = [...batch, ...this.items.slice(this.head)];
        this.head = 0;
    }

    /** Removes and returns the front item. */
    shift(): T | undefined {
        if (this.head >= this.items.length) {
            return undefined;
        }

        const item = this.items[this.head];

        // Drop the reference so the item can be collected.
        this.items[this.head] = undefined as T;
        this.head++;

        if (this.head >= COMPACT_THRESHOLD && this.head * 2 >= this.items.length) {
            this.items = this.items.slice(this.head);
            this.head = 0;
        }

        return item;
    }

    /** The front item, left in place. */
    first(): T | undefined {
        return this.head < this.items.length ? this.items[this.head] : undefined;
    }

    /** Copies up to `max` items from the front without removing them. */
    toArray(max: number = Number.POSITIVE_INFINITY): T[] {
        return this.items.slice(this.head, Number.isFinite(max) ? this.head + max : undefined);
    }

    /** Removes the first `count` items. */
    removeFront(count: number): void {
        for (let removed = 0; removed < count; removed++) {
            this.shift();
        }
    }

    clear(): void {
        this.items = [];
        this.head = 0;
    }
}
