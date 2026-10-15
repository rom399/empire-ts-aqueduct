import path from "node:path";
import { defineConfig } from "vitest/config";

/** The queue client is a sibling package, not a workspace, so tests load it from source. */
export default defineConfig({
    resolve: {
        alias: [{ find: /^empire-ts-aqueduct-client$/, replacement: path.resolve(__dirname, "../client/src/index.ts") }],
    },
    test: { include: ["tests/**/*.test.ts"] },
});
