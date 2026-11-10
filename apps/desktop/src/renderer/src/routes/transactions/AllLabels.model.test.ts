import { type Rule, type RuleId, type Treatment, money, ruleId } from "@holt/core";
import { testId } from "@holt/core/testing";
import { createIntl } from "react-intl";
import { describe, expect, it } from "vitest";
import { locale, messages } from "../../i18n/messages.ts";
import { treatmentKinds } from "./AllFilter.model.ts";
import { type Names, decidedWords, monthLabel, signedMoney, titleOf, treatmentWords } from "./AllLabels.model.ts";
import { splitTo, transaction, withTransactions, world } from "./AllTestWorld.ts";

const intl = createIntl({ locale, messages });
const say = (words: { readonly id: string; readonly values?: Readonly<Record<string, string | number>> }): string => intl.formatMessage({ id: words.id }, words.values);

const w = world();
const out = transaction({ accountId: w.accounts.everyday, date: "2026-10-05", amount: -50_000 });
const names = (extra: ReturnType<typeof withTransactions> = w.facts): Names => ({
  account: (id) => extra.accounts.get(id)?.name ?? "?",
  job: (id) => extra.jobs.get(id)?.name ?? "?",
  month: (m) => monthLabel(m, locale, false),
  transaction: (id) => extra.transactions.get(id),
});

describe("the words for what became of a transaction", () => {
  it("has words for every kind of treatment, with no placeholder left unfilled", () => {
    const partner = transaction({ accountId: w.accounts.bills, date: "2026-10-05", amount: 50_000 });
    const facts = withTransactions(w.facts, partner);
    const treatments: Record<(typeof treatmentKinds)[number], Treatment> = {
      needsYou: { kind: "needsYou" },
      income: { kind: "income", fundsMonth: "2026-12" as never, source: "contribution" },
      transfer: { kind: "transfer", partner: partner.id },
      split: splitTo(-50_000, w.jobs.food),
      history: { kind: "history", jobId: null },
    };
    expect(Object.keys(treatments).sort()).toEqual([...treatmentKinds].sort());
    for (const kind of treatmentKinds) {
      const words = say(treatmentWords({ ...out, treatment: treatments[kind] }, names(facts)));
      expect(words.length).toBeGreaterThan(0);
      expect(words).not.toMatch(/[{}]/);
    }
  });

  it("says each treatment the way the interface copy does", () => {
    const partner = transaction({ accountId: w.accounts.bills, date: "2026-10-05", amount: 50_000 });
    const facts = withTransactions(w.facts, partner);
    const say1 = (treatment: Treatment, amount = -50_000) => say(treatmentWords({ ...out, amount: money(amount), treatment }, names(facts)));
    expect(say1({ kind: "needsYou" })).toBe("Needs you");
    expect(say1({ kind: "income", fundsMonth: "2026-12" as never, source: "other" }, 300_000)).toBe("Income for December");
    expect(say1({ kind: "transfer", partner: partner.id })).toBe("Transfer to Bills");
    expect(say1({ kind: "transfer", partner: partner.id }, 50_000)).toBe("Transfer from Bills");
    expect(say1({ kind: "transfer", partner: null })).toBe("Transfer, other side not imported yet");
    expect(say1(splitTo(-50_000, w.jobs.electricity))).toBe("Electricity");
    expect(say1(splitTo(25_000, w.jobs.electricity), 25_000)).toBe("Refund against Electricity");
    expect(say1({ kind: "history", jobId: null })).toBe("History");
    expect(say1({ kind: "history", jobId: w.jobs.food })).toBe("History, Food");
  });

  it("says a split across several jobs by how many", () => {
    const two = transaction({
      accountId: w.accounts.bills,
      date: "2026-10-05",
      amount: -270_300,
      treatment: { kind: "split", allocations: [{ jobId: w.jobs.insurance, amount: money(-200_000) }, { jobId: w.jobs.electricity, amount: money(-70_300) }] } as unknown as Treatment,
    });
    expect(say(treatmentWords(two, names()))).toBe("Split across 2 jobs");
  });
});

describe("who decided", () => {
  const rule = (origin: Rule["origin"]): Rule => ({ id: ruleId(testId(5)), match: { counterparty: "Fjordmat" }, result: { kind: "job", jobId: w.jobs.food }, origin, priority: 0 });
  const ruled = (id: RuleId | undefined) => ({ ...out, treatment: splitTo(-50_000, w.jobs.food), ...(id === undefined ? {} : { ruleId: id }) });

  it("names the rule that applied, and how the family made it", () => {
    expect(say(decidedWords(ruled(rule("set").id), rule("set")))).toBe("A rule you set for Fjordmat decided this.");
    expect(say(decidedWords(ruled(rule("learned").id), rule("learned")))).toContain("learned from your corrections");
    expect(say(decidedWords(ruled(rule("accepted").id), rule("accepted")))).toContain("suggestion you accepted");
  });

  it("says nobody has decided a transaction that waits, and the family decided one with no rule", () => {
    expect(say(decidedWords(out, undefined))).toBe("Nobody has decided this yet. It waits for you.");
    expect(say(decidedWords(ruled(undefined), undefined))).toBe("You decided this, or you accepted a suggestion for it.");
  });
});

describe("amounts and names", () => {
  it("writes money out with a minus sign and money in with a plus sign, as the mockup does", () => {
    expect(signedMoney(-284_600, "NOK", "en-GB")).toBe("\u22122,846 kr");
    expect(signedMoney(2_800_000, "NOK", "en-GB")).toBe("+28,000 kr");
    expect(signedMoney(0, "NOK", "en-GB")).toBe("0 kr");
    expect(signedMoney(-4_950, "NOK", "nb-NO")).toContain("49,50");
  });

  it("names a transaction by its counterparty, or by the bank's description when there is none", () => {
    expect(titleOf({ counterparty: "Lyse Energi AS", description: "Avtalegiro 1" })).toBe("Lyse Energi AS");
    expect(titleOf({ description: "Avtalegiro 1" })).toBe("Avtalegiro 1");
    expect(titleOf({ counterparty: "  ", description: "Avtalegiro 1" })).toBe("Avtalegiro 1");
  });

  it("names a month, with the year when asked", () => {
    expect(monthLabel("2026-12" as never, "en-GB", false)).toBe("December");
    expect(monthLabel("2026-12" as never, "en-GB", true)).toBe("December 2026");
    expect(monthLabel("2026-01" as never, "en-GB", true)).toBe("January 2026");
  });
});
