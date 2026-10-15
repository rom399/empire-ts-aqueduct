/**
 * Smoke-tests every example: runs `examples/<name>/main.ts` and fails if any of
 * them exits with an error or takes too long. Run with `npm run examples`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EXAMPLES_DIRECTORY = path.join(__dirname, "..", "examples");

/** Each example is tiny; this only catches one that hangs. */
const EXAMPLE_TIMEOUT_MS = 30_000;

const names = fs.readdirSync(EXAMPLES_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

let failed = 0;

for (const name of names) {
    const entry = path.join(EXAMPLES_DIRECTORY, name, "main.ts");

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
