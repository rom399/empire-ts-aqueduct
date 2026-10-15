import { isJsonValue } from "./isJsonValue";
import { ItemValidationResult } from "./ItemValidationResult";
import { MAX_OPTIONAL_STRING_LENGTH, MAX_TYPE_LENGTH } from "./itemLimits";
import { NewQueueItem } from "./NewQueueItem";

/**
 * Checks an item a producer sent and returns a clean copy of it. Hand-written
 * so the package needs no schema library.
 *
 * Unknown fields are dropped, which is also what stops a producer from
 * supplying `itemId`, `sequence`, `enqueuedAt` or `expiresAt`.
 */
export class QueueItemValidator {
    constructor(private readonly maxPayloadBytes: number) {}

    /** Validates `raw`, which may be anything a producer managed to send. */
    validate(raw: unknown): ItemValidationResult {
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
            return this.invalid("An item must be a JSON object.");
        }

        const candidate = raw as Record<string, unknown>;

        const type = candidate.type;
        if (typeof type !== "string" || type.length === 0 || type.length > MAX_TYPE_LENGTH) {
            return this.invalid(`"type" must be a string of 1 to ${MAX_TYPE_LENGTH} characters.`);
        }

        const createdAt = candidate.createdAt;
        if (typeof createdAt !== "number" || !Number.isFinite(createdAt) || createdAt < 0) {
            return this.invalid(`"createdAt" must be a non-negative number of epoch milliseconds.`);
        }

        if (!("payload" in candidate) || !isJsonValue(candidate.payload)) {
            return this.invalid(`"payload" must be plain JSON (no Dates, undefined, functions, BigInt, NaN or class instances).`);
        }

        const payloadBytes = Buffer.byteLength(JSON.stringify(candidate.payload), "utf8");
        if (payloadBytes > this.maxPayloadBytes) {
            return this.invalid(`"payload" is ${payloadBytes} bytes; the limit is ${this.maxPayloadBytes}.`);
        }

        const item: NewQueueItem = { type, payload: candidate.payload, createdAt };

        for (const field of ["source", "correlationId", "idempotencyKey"] as const) {
            const value = candidate[field];

            if (value === undefined) {
                continue;
            }

            if (typeof value !== "string" || value.length > MAX_OPTIONAL_STRING_LENGTH) {
                return this.invalid(`"${field}" must be a string of at most ${MAX_OPTIONAL_STRING_LENGTH} characters.`);
            }

            item[field] = value;
        }

        const schemaVersion = candidate.schemaVersion;
        if (schemaVersion !== undefined) {
            if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
                return this.invalid(`"schemaVersion" must be an integer of at least 1.`);
            }

            item.schemaVersion = schemaVersion;
        }

        return { ok: true, item, payloadBytes };
    }

    private invalid(message: string): ItemValidationResult {
        return { ok: false, message };
    }
}
