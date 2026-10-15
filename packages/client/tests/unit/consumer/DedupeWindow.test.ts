import { describe, expect, it } from "vitest";
import { DedupeWindow } from "../../../src/consumer/DedupeWindow";

describe("DedupeWindow", () => {
    it("remembers an id it was given", () => {
        const window = new DedupeWindow(3);

        window.add("a");

        expect(window.has("a")).toBe(true);
        expect(window.has("b")).toBe(false);
    });

    it("forgets the oldest id once it holds more than its size", () => {
        const window = new DedupeWindow(2);

        ["a", "b", "c"].forEach((id) => window.add(id));

        expect(window.has("a")).toBe(false);
        expect(window.has("b")).toBe(true);
        expect(window.has("c")).toBe(true);
    });
});
