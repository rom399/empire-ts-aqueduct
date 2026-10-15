import { ILogger } from "empire-ts";

/** Remembers every message so a test can check what was logged. */
export class TestLogger implements ILogger {
    readonly infos: string[] = [];
    readonly warnings: string[] = [];
    readonly errors: string[] = [];

    info(message: string): void {
        this.infos.push(message);
    }

    warn(message: string): void {
        this.warnings.push(message);
    }

    error(message: string): void {
        this.errors.push(message);
    }

    debug(): void {}
}
