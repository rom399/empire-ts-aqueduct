import { IQueueLogger } from "./IQueueLogger";

/** Discards everything. For tests and callers who do their own reporting. */
export class SilentQueueLogger implements IQueueLogger {
    info(): void {}

    warn(): void {}

    error(): void {}

    debug(): void {}
}
