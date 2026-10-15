import { describe, expect, it } from "vitest";
import { RingBuffer } from "../src/data/RingBuffer";

describe("RingBuffer", () => {
    it("keeps the newest items and forgets the oldest past its capacity", () => {
        const buffer = new RingBuffer<number>(3);
        buffer.pushAll([1, 2]);
        buffer.pushAll([3, 4, 5]);

        expect(buffer.toArray()).toEqual([3, 4, 5]);
        expect(buffer.size).toBe(3);
    });

    it("lists newest first and honours a limit", () => {
        const buffer = new RingBuffer<number>(10);
        buffer.pushAll([1, 2, 3, 4]);

        expect(buffer.newest()).toEqual([4, 3, 2, 1]);
        expect(buffer.newest(2)).toEqual([4, 3]);
    });

    it("handles a single batch larger than the capacity", () => {
        const buffer = new RingBuffer<number>(2);
        buffer.pushAll([1, 2, 3, 4, 5]);
        expect(buffer.toArray()).toEqual([4, 5]);
    });

    it("clears, and ignores empty pushes", () => {
        const buffer = new RingBuffer<string>(2);
        buffer.pushAll([]);
        buffer.pushAll(["a"]);
        buffer.clear();
        expect(buffer.size).toBe(0);
    });

    it("refuses a capacity that makes no sense", () => {
        expect(() => new RingBuffer(0)).toThrow();
        expect(() => new RingBuffer(1.5)).toThrow();
    });
});
