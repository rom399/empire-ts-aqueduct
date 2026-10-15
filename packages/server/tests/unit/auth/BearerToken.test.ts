import { describe, expect, it } from "vitest";
import { BearerToken } from "../../../src/auth/BearerToken";

describe("BearerToken", () => {
    const token = new BearerToken("s3cret", "test");

    it("matches the right token in a Bearer header", () => {
        expect(token.matches("Bearer s3cret")).toBe(true);
    });

    it("ignores the case of the word Bearer and extra spaces", () => {
        expect(token.matches("bearer   s3cret ")).toBe(true);
    });

    it("refuses a wrong token, a prefix of it, and one with extra characters", () => {
        for (const header of ["Bearer wrong", "Bearer s3cre", "Bearer s3crets"]) {
            expect(token.matches(header)).toBe(false);
        }
    });

    it("refuses a missing header or one that is not Bearer", () => {
        for (const header of [undefined, "", "s3cret", "Basic s3cret", "Bearer"]) {
            expect(token.matches(header)).toBe(false);
        }
    });

    it("refuses to be built with an empty secret", () => {
        expect(() => new BearerToken("", "pull")).toThrow(/pull token is missing/);
    });

    it("can tell whether two tokens hold the same secret", () => {
        expect(token.sameSecretAs(new BearerToken("s3cret", "other"))).toBe(true);
        expect(token.sameSecretAs(new BearerToken("different", "other"))).toBe(false);
    });
});
