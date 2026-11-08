import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

// The workspace packages export TypeScript source, so they must be bundled, not loaded at runtime.
const workspacePackages = ["@holt/core", "@holt/importers"];

export default defineConfig({
  main: {
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
});
