import { IQueueLogger } from "../../../src/logging/IQueueLogger";

/** Remembers every message so a test can check what was logged. */
export class TestQueueLogger implements IQueueLogger {
    readonly infos: string[] = [];
    readonly warnings: string[] = [];
    readonly errors: string[] = [];
    readonly debugs: string[] = [];

    info(message: string): void {
        this.infos.push(message);
    }

    warn(message: string): void {
        this.warnings.push(message);
    }

    error(message: string): void {
        this.errors.push(message);
    }

    debug(message: string): void {
        this.debugs.push(message);
    }
}
