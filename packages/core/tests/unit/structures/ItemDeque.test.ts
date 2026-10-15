import { describe, expect, it } from "vitest";
import { ItemDeque } from "../../../src/structures/ItemDeque";

describe("ItemDeque", () => {
    it("returns items first in, first out", () => {
        const deque = new ItemDeque<number>();

        [1, 2, 3].forEach((n) => deque.pushBack(n));

        expect([deque.shift(), deque.shift(), deque.shift()]).toEqual([1, 2, 3]);
    });

    it("returns undefined from an empty deque", () => {
        const deque = new ItemDeque<number>();

        expect(deque.shift()).toBeUndefined();
        expect(deque.first()).toBeUndefined();
    });

    it("counts only the items still in it", () => {
        const deque = new ItemDeque<number>();

        [1, 2, 3].forEach((n) => deque.pushBack(n));
        deque.shift();

        expect(deque.length).toBe(2);
    });

    it("puts a batch back in front, keeping the batch's own order", () => {
        const deque = new ItemDeque<number>();

        [4, 5].forEach((n) => deque.pushBack(n));
        deque.pushFront([1, 2, 3]);

        expect(deque.toArray()).toEqual([1, 2, 3, 4, 5]);
    });

    it("copies from the front without removing", () => {
        const deque = new ItemDeque<number>();

        [1, 2, 3].forEach((n) => deque.pushBack(n));

        expect(deque.toArray(2)).toEqual([1, 2]);
        expect(deque.length).toBe(3);
    });

    it("removes a number of items from the front", () => {
        const deque = new ItemDeque<number>();

        [1, 2, 3].forEach((n) => deque.pushBack(n));
        deque.removeFront(2);

        expect(deque.toArray()).toEqual([3]);
    });

    it("keeps its order and length across many shifts, which trigger compaction", () => {
        const deque = new ItemDeque<number>();
        const total = 5000;

        for (let n = 0; n < total; n++) {
            deque.pushBack(n);
        }

        for (let n = 0; n < 3000; n++) {
            expect(deque.shift()).toBe(n);
        }

        expect(deque.length).toBe(2000);
        expect(deque.first()).toBe(3000);
    });

    it("can be cleared", () => {
        const deque = new ItemDeque<number>();

        deque.pushBack(1);
        deque.clear();

        expect(deque.length).toBe(0);
    });
});
