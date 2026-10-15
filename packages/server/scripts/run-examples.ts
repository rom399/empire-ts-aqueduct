/**
 * Smoke-tests the examples: runs every `examples/<name>/server.ts` and fails if one
 * exits with an error or hangs. Run with `npm run examples`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EXAMPLES_DIRECTORY = path.join(__dirname, "..", "examples");

/** Each example finishes in a second or two; this only catches one that hangs. */
const EXAMPLE_TIMEOUT_MS = 60_000;

const names = fs.readdirSync(EXAMPLES_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

let failed = 0;

for (const name of names) {
    const entry = path.join(EXAMPLES_DIRECTORY, name, "server.ts");

    if (!fs.existsSync(entry)) {
        continue;
    }

    const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), entry], {
        encoding: "utf8",
        timeout: EXAMPLE_TIMEOUT_MS,
    });

    if (result.status === 0) {
        console.log(`ok   ${name}`);
    } else {
        failed++;
        console.log(`FAIL ${name}\n${result.stdout}${result.stderr}`);
    }
}

if (failed > 0) {
    process.exit(1);
}
