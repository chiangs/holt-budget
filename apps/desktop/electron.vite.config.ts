import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

// The workspace packages export TypeScript source, so they must be bundled, not loaded at runtime.
const workspacePackages = ["@holt/core", "@holt/importers"];

export default defineConfig(({ mode }) => ({
  main: {
    // The seed and the test file picker exist in every build except production (`pnpm build`, `pnpm dist`, `install.sh`).
    define: {
      __HOLT_DEV_SEED__: JSON.stringify(mode !== "production"),
      __HOLT_E2E__: JSON.stringify(mode === "e2e"),
    },
    build: { externalizeDeps: { exclude: workspacePackages } },
  },
  // Sandboxed preloads must be CommonJS.
  preload: {
    build: {
      externalizeDeps: { exclude: workspacePackages },
      rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") },
    },
  },
}));
