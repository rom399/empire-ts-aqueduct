import { describe, expect, it } from "vitest";
import { isValidQueueName } from "../../../src/options/isValidQueueName";

describe("isValidQueueName", () => {
    it("accepts lowercase letters, digits, hyphens and underscores", () => {
        for (const name of ["telemetry", "orders-2", "a_b", "x", "a".repeat(64)]) {
            expect(isValidQueueName(name)).toBe(true);
        }
    });

    it("refuses uppercase, so names cannot collide on a case-insensitive disk", () => {
        expect(isValidQueueName("Telemetry")).toBe(false);
    });

    it("refuses an empty name and one over 64 characters", () => {
        expect(isValidQueueName("")).toBe(false);
        expect(isValidQueueName("a".repeat(65))).toBe(false);
    });

    it("refuses characters that are unsafe in a folder name", () => {
        for (const name of ["a/b", "a\\b", "..", "a.b", "a b", "a:b", "é"]) {
            expect(isValidQueueName(name)).toBe(false);
        }
    });

    it("refuses Windows reserved names", () => {
        for (const name of ["con", "nul", "aux", "prn", "com1", "lpt9"]) {
            expect(isValidQueueName(name)).toBe(false);
        }
    });
});
