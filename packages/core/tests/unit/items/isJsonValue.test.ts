import { describe, expect, it } from "vitest";
import { isJsonValue } from "../../../src/items/isJsonValue";

describe("isJsonValue", () => {
    describe("accepts plain JSON", () => {
        it("accepts null, booleans, finite numbers and strings", () => {
            for (const value of [null, true, false, 0, -1.5, "text", ""]) {
                expect(isJsonValue(value)).toBe(true);
            }
        });

        it("accepts nested arrays and plain objects", () => {
            expect(isJsonValue({ a: [1, { b: null }], c: "d" })).toBe(true);
        });

        it("accepts an object with no prototype", () => {
            expect(isJsonValue(Object.assign(Object.create(null), { a: 1 }))).toBe(true);
        });
    });

    describe("refuses what JSON would change or lose", () => {
        it("refuses undefined, functions, symbols and BigInt", () => {
            for (const value of [undefined, () => 1, Symbol("x"), 10n]) {
                expect(isJsonValue(value)).toBe(false);
            }
        });

        it("refuses NaN and infinities", () => {
            for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
                expect(isJsonValue(value)).toBe(false);
            }
        });

        it("refuses Dates, Maps and class instances", () => {
            class Point { x = 1; }

            for (const value of [new Date(), new Map(), new Point()]) {
                expect(isJsonValue(value)).toBe(false);
            }
        });

        it("refuses a bad value hidden inside an array or object", () => {
            expect(isJsonValue([1, undefined])).toBe(false);
            expect(isJsonValue({ a: { b: new Date() } })).toBe(false);
        });

        it("refuses a circular object instead of looping forever", () => {
            const loop: Record<string, unknown> = {};

            loop.self = loop;

            expect(isJsonValue(loop)).toBe(false);
        });

        it("refuses values nested deeper than the limit", () => {
            let deep: unknown = 1;

            for (let level = 0; level < 100; level++) {
                deep = [deep];
            }

            expect(isJsonValue(deep)).toBe(false);
        });
    });
});
