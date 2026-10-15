/**
 * Fails if package.json still points a dependency at a local folder. While the
 * queue packages are developed side by side, `empire-ts-aqueduct-core` is a `file:`
 * dependency so that `npm install` works before it is published. A package
 * published that way cannot be installed by anyone else.
 *
 * Before publishing: publish `empire-ts-aqueduct-core` first, then change the `file:`
 * entries to its version, for example "^0.1.0".
 */
import fs from "node:fs";
import path from "node:path";

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
};

const local = Object.entries(packageJson.dependencies ?? {}).filter(([, version]) => version.startsWith("file:"));

if (local.length > 0) {
    console.error("Cannot publish: these dependencies point at local folders:");

    for (const [name, version] of local) {
        console.error(`  ${name}: ${version}`);
    }

    console.error('Publish them first, then replace each "file:..." with its version, for example "^0.1.0".');
    process.exit(1);
}

console.log("No local dependencies. Safe to publish.");
