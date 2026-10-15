import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * The dashboard is served by the hub at "/" and by the load balancer under
 * "/admin/", so every URL in it is relative ("./" base, "api/..." requests).
 * In development the Vite server proxies /api to the hub.
 */
export default defineConfig({
    base: "./",
    plugins: [react()],
    build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 900 },
    server: {
        port: 5173,
        proxy: { "/api": { target: "http://127.0.0.1:7130", changeOrigin: false } },
    },
    test: { include: ["tests/**/*.test.ts"] },
});
