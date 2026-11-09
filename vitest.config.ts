import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/desktop/src/{main,shared,renderer}/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
