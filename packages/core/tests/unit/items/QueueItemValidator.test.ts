import { describe, expect, it } from "vitest";
import { QueueItemValidator } from "../../../src/items/QueueItemValidator";
import { newItem } from "../../fixtures/items/newItem";

const MAX_PAYLOAD_BYTES = 100;

describe("QueueItemValidator", () => {
    const validator = new QueueItemValidator(MAX_PAYLOAD_BYTES);

    describe("a valid item", () => {
        it("is accepted and returned with the fields the producer set", () => {
            const result = validator.validate(newItem(1, { source: "orders", correlationId: "c-1", idempotencyKey: "k-1", schemaVersion: 2 }));

            expect(result).toMatchObject({
                ok: true,
                item: {
                    type: "test.event",
                    payload: { n: 1 },
                    source: "orders",
                    correlationId: "c-1",
                    idempotencyKey: "k-1",
                    schemaVersion: 2,
                },
            });
        });

        it("reports the size of the serialised payload", () => {
            const result = validator.validate(newItem(1));

            expect(result).toMatchObject({ ok: true, payloadBytes: JSON.stringify({ n: 1 }).length });
        });

        it("accepts a payload that is not an object", () => {
            expect(validator.validate(newItem(0, { payload: "just text" })).ok).toBe(true);
            expect(validator.validate(newItem(0, { payload: null })).ok).toBe(true);
        });
    });

    describe("fields only the queue may set", () => {
        it("drops itemId, sequence, enqueuedAt and expiresAt if a producer sends them", () => {
            const forged = { ...newItem(1), itemId: "forged", sequence: 999, enqueuedAt: 1, expiresAt: 2, extra: "x" };
            const result = validator.validate(forged);

            expect(result.ok).toBe(true);

            if (result.ok) {
                expect(Object.keys(result.item).sort()).toEqual(["createdAt", "payload", "type"]);
            }
        });
    });

    describe("an invalid item", () => {
        it("refuses something that is not an object", () => {
            for (const raw of [null, undefined, "text", 5, [newItem()]]) {
                expect(validator.validate(raw).ok).toBe(false);
            }
        });

        it("refuses a missing, empty or overlong type", () => {
            expect(validator.validate({ ...newItem(), type: undefined }).ok).toBe(false);
            expect(validator.validate(newItem(0, { type: "" })).ok).toBe(false);
            expect(validator.validate(newItem(0, { type: "x".repeat(201) })).ok).toBe(false);
        });

        it("refuses a missing or non-numeric createdAt", () => {
            expect(validator.validate({ type: "t", payload: {} }).ok).toBe(false);
            expect(validator.validate({ type: "t", payload: {}, createdAt: "now" }).ok).toBe(false);
            expect(validator.validate({ type: "t", payload: {}, createdAt: -1 }).ok).toBe(false);
        });

        it("refuses a missing payload", () => {
            expect(validator.validate({ type: "t", createdAt: 1 }).ok).toBe(false);
        });

        it("refuses a payload that is not plain JSON", () => {
            expect(validator.validate(newItem(0, { payload: new Date() as never })).ok).toBe(false);
        });

        it("refuses a payload over the size limit and says how big it was", () => {
            const result = validator.validate(newItem(0, { payload: "x".repeat(MAX_PAYLOAD_BYTES) }));

            expect(result.ok).toBe(false);
            expect(!result.ok && result.message).toContain("limit is 100");
        });

        it("refuses optional strings that are the wrong type or too long", () => {
            expect(validator.validate({ ...newItem(), source: 5 }).ok).toBe(false);
            expect(validator.validate(newItem(0, { correlationId: "x".repeat(257) })).ok).toBe(false);
        });

        it("refuses a schemaVersion that is not an integer of at least 1", () => {
            for (const schemaVersion of [0, 1.5, -1, "1"]) {
                expect(validator.validate({ ...newItem(), schemaVersion }).ok).toBe(false);
            }
        });
    });
});
