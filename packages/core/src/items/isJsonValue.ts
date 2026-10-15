import { MAX_JSON_DEPTH } from "./itemLimits";
import { JsonValue } from "./JsonValue";

/**
 * True when `value` is plain JSON: null, booleans, finite numbers, strings,
 * arrays and plain objects, nested no deeper than MAX_JSON_DEPTH.
 *
 * It is strict on purpose. Dates, undefined, functions, BigInt, NaN and class
 * instances are refused instead of being quietly changed by JSON.stringify, so
 * what a consumer reads is what the producer meant.
 */
export function isJsonValue(value: unknown, depth: number = 0): value is JsonValue {
    if (depth > MAX_JSON_DEPTH) {
        return false;
    }

    if (value === null || typeof value === "boolean" || typeof value === "string") {
        return true;
    }

    if (typeof value === "number") {
        return Number.isFinite(value);
    }

    if (Array.isArray(value)) {
        return value.every((element) => isJsonValue(element, depth + 1));
    }

    if (typeof value === "object") {
        const prototype = Object.getPrototypeOf(value);

        if (prototype !== Object.prototype && prototype !== null) {
            return false;
        }

        return Object.values(value).every((member) => isJsonValue(member, depth + 1));
    }

    return false;
}
