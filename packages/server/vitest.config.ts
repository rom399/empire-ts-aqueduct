import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The queue packages are siblings in one repository and are not workspaces, so
 * tests load the sibling packages from source instead of from node_modules. That
 * way nothing has to be built first.
 */
export default defineConfig({
    resolve: {
        alias: [
            { find: /^empire-ts-aqueduct-client$/, replacement: path.resolve(__dirname, "../client/src/index.ts") },
            { find: /^empire-ts-aqueduct-core$/, replacement: path.resolve(__dirname, "../core/src/index.ts") },
        ],
    },
});
