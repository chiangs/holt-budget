import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Facts, type TableName, keyOfRow, tableNames } from "./facts.ts";
import { rowsEqual } from "./patch.ts";
import { DuplicateRowError, type Tables, factsOf, tablesOf } from "./tables.ts";
import { arbitraryFacts } from "./testing/arbitrary-facts.ts";

function sameFacts(a: Facts, b: Facts): boolean {
  return tableNames.every((table) => {
    const left = a[table] as ReadonlyMap<string, unknown>;
    const right = b[table] as ReadonlyMap<string, unknown>;
    return left.size === right.size && [...left].every(([key, row]) => right.has(key) && rowsEqual(right.get(key), row));
  });
}

/** The same rows with each table's Map filled in the reverse order. */
function reversed(facts: Facts): Facts {
  return Object.fromEntries(tableNames.map((table) => [table, new Map([...(facts[table] as ReadonlyMap<string, unknown>)].reverse())])) as unknown as Facts;
}

describe("tables", () => {
  it("give back the same facts they were made from, with every table", () => {
    fc.assert(
      fc.property(arbitraryFacts(), (facts) => {
        expect(sameFacts(factsOf(tablesOf(facts)), facts)).toBe(true);
      }),
    );
  });

  it("name every table of the facts and nothing else", () => {
    fc.assert(
      fc.property(arbitraryFacts(), (facts) => {
        expect(Object.keys(tablesOf(facts)).sort()).toEqual([...tableNames].sort());
        expect(Object.keys(factsOf(tablesOf(facts))).sort()).toEqual([...tableNames].sort());
      }),
    );
  });

  it("hold every row of a table once", () => {
    fc.assert(
      fc.property(arbitraryFacts(), (facts) => {
        const tables = tablesOf(facts);
        for (const table of tableNames) expect(tables[table]).toHaveLength((facts[table] as ReadonlyMap<string, unknown>).size);
      }),
    );
  });

  it("list the rows of each table in the order of their keys, whatever order they were added in", () => {
    fc.assert(
      fc.property(arbitraryFacts(), (facts) => {
        const tables = tablesOf(facts);
        for (const table of tableNames) {
          const keys = (tables[table] as readonly never[]).map((row) => keyOfRow(table, row));
          expect(keys, table).toEqual([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
        }
        expect(tablesOf(reversed(facts))).toEqual(tables);
      }),
    );
  });
});

describe("rebuilding the facts from tables", () => {
  it("is refused when a table holds two rows with the same key, and says which table and which key", () => {
    fc.assert(
      fc.property(arbitraryFacts(), fc.constantFrom(...tableNames), (facts, table) => {
        const tables = tablesOf(facts);
        const first = (tables[table] as readonly never[])[0];
        fc.pre(first !== undefined);
        const doubled = { ...tables, [table]: [...tables[table], first] } as Tables;
        const attempt = () => factsOf(doubled);
        expect(attempt).toThrow(DuplicateRowError);
        try {
          attempt();
        } catch (error) {
          expect((error as DuplicateRowError).table).toBe(table satisfies TableName);
          expect((error as DuplicateRowError).key).toBe(keyOfRow(table, first));
        }
      }),
    );
  });

  it("is refused even when the two rows differ", () => {
    const facts = fc.sample(arbitraryFacts(), { numRuns: 50 }).find((f) => f.accounts.size > 0) as Facts;
    const tables = tablesOf(facts);
    const [account] = tables.accounts;
    expect(() => factsOf({ ...tables, accounts: [...tables.accounts, { ...account!, name: "Another" }] })).toThrow(DuplicateRowError);
  });

  it("accepts empty tables", () => {
    const empty = Object.fromEntries(tableNames.map((table) => [table, []])) as unknown as Tables;
    expect(tableNames.every((table) => (factsOf(empty)[table] as ReadonlyMap<string, unknown>).size === 0)).toBe(true);
  });
});
