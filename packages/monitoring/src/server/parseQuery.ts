import { BadRequestError } from "empire-ts";

/** An optional whole number query parameter. Throws a 400 if it is present but not a number. */
export function optionalNumber(query: URLSearchParams, name: string): number | undefined {
    const raw = query.get(name);

    if (raw === null || raw === "") {
        return undefined;
    }

    const value = Number(raw);

    if (!Number.isFinite(value)) {
        throw new BadRequestError(`"${name}" must be a number.`);
    }

    return Math.floor(value);
}

export function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}
