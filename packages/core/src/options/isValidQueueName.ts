const QUEUE_NAME_PATTERN = /^[a-z0-9_-]{1,64}$/;

/** Names Windows will not allow as a file or folder name, with or without an extension. */
const WINDOWS_RESERVED_NAMES = new Set([
    "con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/**
 * True when `name` is safe to use as a queue name and as a folder name on any
 * platform: lowercase letters, digits, hyphens and underscores, 1 to 64
 * characters, and not a Windows reserved name. Lowercase only, so `Telemetry`
 * and `telemetry` cannot collide on a case-insensitive disk.
 */
export function isValidQueueName(name: string): boolean {
    return QUEUE_NAME_PATTERN.test(name) && !WINDOWS_RESERVED_NAMES.has(name);
}
