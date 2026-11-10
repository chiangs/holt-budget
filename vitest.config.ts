import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The storage tests open encrypted databases and run property tests; a busy machine (CI, or other work running) needs more than 5 s.
    testTimeout: 20_000,
    include: ["packages/*/src/**/*.test.ts", "apps/desktop/src/{main,shared,renderer}/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
