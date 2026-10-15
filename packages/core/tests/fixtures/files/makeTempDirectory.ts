import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

const created: string[] = [];

afterEach(() => {
    for (const directory of created.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

/** A fresh empty folder under the system temp folder, removed after the test. */
export function makeTempDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "empire-queue-test-"));

    created.push(directory);

    return directory;
}

/** Every file under `directory`, as paths relative to it, sorted. */
export function listFiles(directory: string): string[] {
    if (!fs.existsSync(directory)) {
        return [];
    }

    return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
        .sort();
}
