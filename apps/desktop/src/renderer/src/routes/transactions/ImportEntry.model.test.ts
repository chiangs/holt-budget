import { type AccountId, type Currency, type Facts, type JobId, accountId, currency, jobId, localDate, money } from "@holt/core";
import { kr, testId } from "@holt/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { channels } from "../../../../shared/channels.ts";
import {
  type EntryDraft,
  buildEntry,
  parseBalanceText,
  sameEntry,
  withBalanceDate,
  withBalanceText,
  withChoice,
  withSuggest,
  withoutChoice,
} from "./ImportEntry.model.ts";
import { importHousehold, numbers, replan, statement, today } from "./ImportTestKit.ts";

const nok: Currency = currency("NOK");
const parse = (text: string) => {
  const result = parseBalanceText(text, nok);
  return result.kind === "amount" ? result.value : result.kind;
};

describe("typed balances", () => {
  it("reads the Norwegian and the English way of writing the same amount as the same money", () => {
    for (const text of ["24 960,50", "24 960,50", "24,960.50", "24960,50", "24960.50", "24 960,5", "24.960,50", "24960,5 kr", "24 960,50 NOK"]) {
      expect(parse(text), text).toBe(2_496_050);
    }
  });

  it("treats a lone separator before three digits as grouping thousands, not as a decimal point", () => {
    expect(parse("24,960")).toBe(kr(24_960));
    expect(parse("24.960")).toBe(kr(24_960));
    expect(parse("1.234.567")).toBe(kr(1_234_567));
    expect(parse("12,505")).toBe(kr(12_505));
    expect(parse("24 960")).toBe(kr(24_960));
  });

  it("keeps a decimal point before one or two digits as øre", () => {
    expect(parse("12.5")).toBe(1_250);
    expect(parse("12,05")).toBe(1_205);
  });

  it("allows an overdrawn account", () => {
    expect(parse("-1 200,00")).toBe(kr(-1_200));
    expect(parse("−1200")).toBe(kr(-1_200));
  });

  it("says empty for nothing typed and invalid for what is not an amount", () => {
    expect(parse("")).toBe("empty");
    expect(parse("   ")).toBe("empty");
    for (const text of ["abc", "12,345,67", "12,5,5", "1 2 3 x", "--5", "1,2,3", "12,34,567"]) expect(parse(text), text).toBe("invalid");
  });

  it("round-trips any amount written either way, with or without grouping, and never goes through a float", () => {
    const written = fc
      .record({
        minor: fc.integer({ min: 0, max: 9_000_000_000_000 }),
        decimal: fc.constantFrom(",", "."),
        group: fc.constantFrom("", " ", " "),
        negative: fc.boolean(),
      })
      .map(({ minor, decimal, group, negative }) => {
        const whole = String(Math.trunc(minor / 100));
        const grouped = group === "" ? whole : whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
        const text = `${negative && minor > 0 ? "-" : ""}${grouped}${decimal}${String(minor % 100).padStart(2, "0")}`;
        return { text, expected: negative ? -minor : minor };
      });
    fc.assert(
      fc.property(written, ({ text, expected }) => {
        const result = parseBalanceText(text, nok);
        return result.kind === "amount" && result.value === (expected === 0 ? 0 : expected);
      }),
    );
  });
});

const account = (n: number): AccountId => accountId(testId(n));
const job = (n: number): JobId => jobId(testId(100 + n));

const draft: EntryDraft = { balances: [{ accountId: account(1), text: "", asOf: "2026-11-06" }], choices: [], suggest: true };

describe("the entry the bridge takes", () => {
  it("holds a typed balance with its date, as integer money", () => {
    const { entry } = buildEntry(withBalanceText(draft, account(1), "24 960,00"), nok, today);
    expect(entry.balances).toEqual([{ accountId: account(1), value: kr(24_960), asOf: "2026-11-06" }]);
  });

  it("leaves out an account with nothing typed, so it is not checked", () => {
    expect(buildEntry(draft, nok, today).entry.balances).toEqual([]);
  });

  it("leaves out a balance the app can't use and says why, so a half-typed number never reaches the main process", () => {
    const typed = (text: string, asOf = "2026-11-06") => buildEntry(withBalanceDate(withBalanceText(draft, account(1), text), account(1), asOf), nok, today);
    expect(typed("24 9x").entry.balances).toEqual([]);
    expect(typed("24 9x").problems.get(account(1))).toBe("amount");
    expect(typed("24 960", "").problems.get(account(1))).toBe("date");
    expect(typed("24 960", "2026-02-30").problems.get(account(1))).toBe("date");
    expect(typed("24 960", "2026-11-10").problems.get(account(1))).toBe("future");
    expect(typed("24 960", "2026-11-09").problems.size).toBe(0);
  });

  it("gives the whole amount of a row to the job the family chose for it, in line order", () => {
    const chosen = withChoice(withChoice(draft, { line: 9, jobId: job(2), amount: kr(-449) }), { line: 3, jobId: job(1), amount: kr(-1_980) });
    expect(buildEntry(chosen, nok, today).entry.choices).toEqual([
      { line: 3, treatment: { kind: "split", allocations: [{ jobId: job(1), amount: kr(-1_980) }] } },
      { line: 9, treatment: { kind: "split", allocations: [{ jobId: job(2), amount: kr(-449) }] } },
    ]);
  });

  it("keeps one choice for each line, the latest", () => {
    const twice = withChoice(withChoice(draft, { line: 3, jobId: job(1), amount: kr(-1) }), { line: 3, jobId: job(2), amount: kr(-1) });
    expect(twice.choices).toEqual([{ line: 3, jobId: job(2), amount: kr(-1) }]);
    expect(withoutChoice(twice, 3).choices).toEqual([]);
  });

  it("carries the suggest switch as it stands", () => {
    expect(buildEntry(withSuggest(draft, false), nok, today).entry.suggest).toBe(false);
  });

  it("tells a changed entry from an unchanged one, so a half-typed amount does not ask for a new plan", () => {
    const base = buildEntry(draft, nok, today).entry;
    expect(sameEntry(base, buildEntry(withBalanceText(draft, account(1), "24 9x"), nok, today).entry)).toBe(true);
    expect(sameEntry(base, buildEntry(withBalanceText(draft, account(1), "24 960"), nok, today).entry)).toBe(false);
  });
});

describe("any sequence of edits", () => {
  const edit = fc.oneof(
    fc.record({ kind: fc.constant("text" as const), account: fc.integer({ min: 1, max: 3 }), text: fc.oneof(fc.string(), fc.stringMatching(/^-?\d{1,9}([,.]\d{0,3})?$/)) }),
    fc.record({ kind: fc.constant("date" as const), account: fc.integer({ min: 1, max: 3 }), value: fc.oneof(fc.string(), fc.date({ min: new Date("2000-01-01"), max: new Date("2030-12-31"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10))) }),
    fc.record({ kind: fc.constant("choose" as const), line: fc.integer({ min: 1, max: 40 }), job: fc.integer({ min: 1, max: 5 }), amount: fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }) }),
    fc.record({ kind: fc.constant("unchoose" as const), line: fc.integer({ min: 1, max: 40 }) }),
    fc.record({ kind: fc.constant("suggest" as const), on: fc.boolean() }),
  );
  const start: EntryDraft = { balances: [1, 2, 3].map((n) => ({ accountId: account(n), text: "", asOf: "2026-11-06" })), choices: [], suggest: true };

  it("builds an entry the bridge accepts", () => {
    fc.assert(
      fc.property(fc.array(edit, { maxLength: 40 }), (edits) => {
        let now = start;
        for (const e of edits) {
          switch (e.kind) {
            case "text":
              now = withBalanceText(now, account(e.account), e.text);
              break;
            case "date":
              now = withBalanceDate(now, account(e.account), e.value);
              break;
            case "choose":
              now = withChoice(now, { line: e.line, jobId: job(e.job), amount: money(e.amount) });
              break;
            case "unchoose":
              now = withoutChoice(now, e.line);
              break;
            case "suggest":
              now = withSuggest(now, e.on);
              break;
          }
        }
        const { entry } = buildEntry(now, nok, localDate("2026-11-09"));
        const parsed = channels["holt:import-plan"].args.safeParse(["a-session", entry]);
        return parsed.success;
      }),
      { numRuns: 400 },
    );
  });
});

describe("the entry in a real plan", () => {
  const h = importHousehold();
  const file = statement([
    { account: numbers.everyday, date: "2026-11-02", amount: kr(-120), description: "Kiwi Sentrum", counterparty: "Kiwi" },
    { account: numbers.everyday, date: "2026-11-03", amount: kr(-449), description: "Viaplay", counterparty: "Viaplay" },
  ]);
  const facts: Facts = h.facts();
  const food = h.jobs.food;

  it("moves a row the family chose a job for out of needs you, with them as the reason", () => {
    const before = replan(facts, file, buildEntry({ balances: [], choices: [], suggest: true }, nok, today).entry);
    if (!before.ok) throw new Error("expected a plan");
    expect(before.preview.counts.needsYou).toBe(2);
    const viaplay = before.preview.sample.find((l) => l.description === "Viaplay");
    if (viaplay === undefined) throw new Error("expected the row");
    const chosen = withChoice({ balances: [], choices: [], suggest: true }, { line: viaplay.line, jobId: food, amount: viaplay.amount });
    const after = replan(facts, file, buildEntry(chosen, nok, today).entry);
    if (!after.ok) throw new Error("expected a plan");
    expect(after.preview.counts).toMatchObject({ needsYou: 1, chosen: 1 });
    expect(after.preview.sample.find((l) => l.line === viaplay.line)).toMatchObject({ why: { kind: "chosen" }, treatment: { kind: "split" } });
  });

  it("checks the account against the balance the family typed", () => {
    const typed = withBalanceText({ balances: [{ accountId: h.accounts.everyday, text: "", asOf: "2026-11-09" }], choices: [], suggest: true }, h.accounts.everyday, "9 431");
    const plan = replan(facts, file, buildEntry(typed, nok, today).entry);
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.preview.accounts.find((a) => a.accountId === h.accounts.everyday)?.balance.kind).toBe("matches");
  });
});
