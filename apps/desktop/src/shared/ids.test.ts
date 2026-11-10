import { describe, expect, it } from "vitest";
import { type MintSources, createMint, mintId } from "./ids.ts";

const randomBytes = (bytes: Uint8Array): void => bytes.set(crypto.getRandomValues(new Uint8Array(bytes.length)));

const sequence = (values: number[]): MintSources => {
  let i = 0;
  return { now: () => values[Math.min(i++, values.length - 1)] as number, random: randomBytes };
};

const uuidv7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("minting IDs", () => {
  it("makes UUIDv7 text that core accepts for every kind", () => {
    for (const kind of ["household", "account", "group", "job", "transaction", "move", "enteredValue", "change", "proposal", "importBatch", "importRow", "rule"] as const) {
      expect(mintId(kind)).toMatch(uuidv7);
    }
  });

  it("puts the clock's milliseconds in the first 48 bits", () => {
    const ms = Date.UTC(2026, 10, 10, 12, 30, 15, 123);
    const id = createMint(sequence([ms]))("change");
    expect(Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(ms);
  });

  it("keeps IDs strictly increasing while the clock stands still", () => {
    const mint = createMint({ now: () => 1_800_000_000_000, random: randomBytes });
    const ids = Array.from({ length: 10_000 }, () => mint("transaction") as string);
    expect(ids.every((id, i) => i === 0 || id > (ids[i - 1] as string))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps IDs increasing when the clock steps back", () => {
    const mint = createMint(sequence([1_800_000_000_000, 1_700_000_000_000, 1_700_000_000_001]));
    const [a, b, c] = [mint("job") as string, mint("job") as string, mint("job") as string];
    expect(a < b && b < c).toBe(true);
  });

  it("moves to the next millisecond rather than repeat when the counter runs out", () => {
    const mint = createMint({ now: () => 1_800_000_000_000, random: randomBytes });
    const stamps = new Set(Array.from({ length: 6_000 }, () => (mint("rule") as string).slice(0, 13)));
    expect(stamps.size).toBeGreaterThan(1);
  });
});
