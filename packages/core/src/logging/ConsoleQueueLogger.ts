import { IQueueLogger } from "./IQueueLogger";

/** Writes to the console. The default, because a full or dropping queue should never be silent. */
export class ConsoleQueueLogger implements IQueueLogger {
    info(message: string): void {
        console.log(`[queue] ${message}`);
    }

    warn(message: string): void {
        console.warn(`[queue] ${message}`);
    }

    error(message: string, error?: unknown): void {
        console.error(`[queue] ${message}`, error ?? "");
    }

    debug(message: string): void {
        console.debug(`[queue] ${message}`);
    }
}
