import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../../renderer/index.html", import.meta.url), "utf8");
const content = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter((tokens) => tokens[0] !== "")
      .map(([name, ...sources]) => [name as string, sources]),
  );
}

describe("N5 content security policy", () => {
  it("is present in index.html", () => expect(content).toBeDefined());

  const policy = directives(content ?? "");

  it("defaults to the app's own origin", () => expect(policy.get("default-src")).toEqual(["'self'"]));

  it("allows no eval and no inline script", () => {
    expect(content).not.toContain("unsafe-eval");
    expect(policy.get("script-src")).toEqual(["'self'"]);
  });

  it("names no remote origin, wildcard or network scheme", () => {
    const allowedSources = new Set(["'self'", "'none'", "'unsafe-inline'", "data:"]);
    for (const [name, sources] of policy) {
      for (const source of sources) expect(allowedSources.has(source), `${name} allows ${source}`).toBe(true);
    }
  });

  it("allows inline source only for styles", () => {
    for (const [name, sources] of policy) {
      if (name !== "style-src") expect(sources, name).not.toContain("'unsafe-inline'");
    }
  });

  it("shuts plugins, frames, base URLs and forms", () => {
    for (const name of ["object-src", "frame-src", "base-uri", "form-action"]) expect(policy.get(name)).toEqual(["'none'"]);
  });
});
