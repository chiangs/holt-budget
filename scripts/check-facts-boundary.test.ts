import { describe, expect, it } from "vitest";
import { findFactsBoundaryViolations } from "./check-facts-boundary.mjs";

const inMain = "apps/desktop/src/main/ipc.ts";
const flagged = (source: string, file = inMain): string[] => findFactsBoundaryViolations(source, file).map((p: { message: string }) => p.message);

describe("facts boundary lint", () => {
  it.each([
    'import { x } from "./facts/store.ts";',
    'import { x } from "./facts/columns";',
    'import x from "./facts/changes.ts";',
    'export { x } from "./facts/store.ts";',
    'export * from "./facts/errors.ts";',
    'const m = await import("./facts/store.ts");',
    'const m = require("./facts/store.ts");',
    'import type { Statements } from "./facts/store.ts";',
    'type T = import("./facts/store.ts").FactsStore;',
    'import { x } from "../facts/columns.ts";',
  ])("flags %s", (source) => {
    const file = source.includes('"../facts') ? "apps/desktop/src/main/storage/x.ts" : inMain;
    expect(flagged(source, file)).toHaveLength(1);
  });

  it.each([
    'import { openFactsStore } from "./facts/index.ts";',
    'import { openFactsStore } from "./facts/index";',
    'import { openFactsStore } from "./facts";',
    'import { openFactsStore } from "./facts/";',
    'import { openFactsStore } from "../facts/index.ts";',
    'import { createFactsStore } from "./facts/index.js";',
    'import { x } from "./facts-other/store.ts";',
    'import { x } from "./factsheet.ts";',
    'import { x } from "node:fs";',
  ])("allows %s", (source) => {
    const file = source.includes('"../facts') ? "apps/desktop/src/main/storage/x.ts" : inMain;
    expect(flagged(source, file)).toEqual([]);
  });

  it("flags a test outside the folder as it flags any other file", () => {
    expect(flagged('import { prepareStatements } from "../facts/store.ts";', "apps/desktop/src/main/storage/storage.test.ts")).toHaveLength(1);
  });

  it("flags a path written from the app's root, not only a relative one", () => {
    expect(flagged('import { x } from "src/main/facts/store.ts";')).toHaveLength(1);
    expect(flagged('import { x } from "src/main/facts/index.ts";')).toEqual([]);
  });

  it("lets files inside the folder import each other", () => {
    expect(flagged('import { x } from "./store.ts"; import { y } from "./columns.ts";', "apps/desktop/src/main/facts/changes.ts")).toEqual([]);
  });

  it("reports the line of each problem", () => {
    const source = 'import a from "node:path";\n\nimport b from "./facts/store.ts";\n';
    expect(findFactsBoundaryViolations(source, inMain)).toEqual([{ line: 3, message: 'imports "./facts/store.ts", which is private to apps/desktop/src/main/facts/' }]);
  });
});
