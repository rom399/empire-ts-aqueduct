/** The longest `type` a producer may send. */
export const MAX_TYPE_LENGTH = 200;

/** The longest `source`, `correlationId` or `idempotencyKey`. */
export const MAX_OPTIONAL_STRING_LENGTH = 256;

/** How deeply a payload may nest. Also what stops a circular payload from looping forever. */
export const MAX_JSON_DEPTH = 64;
