import { type Facts, type Transaction, type TransactionId, money } from "@holt/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbitraryFacts } from "../../../../../../../packages/core/src/testing/arbitrary-facts.ts";
import { type AllFilter, amountDigits, buildBrowseIndex, compareTransactions, everything, filterIndex, jobsInGroupOrder, jobsOf, sortTransactions, treatmentKinds } from "./AllFilter.model.ts";
import { splitTo, transaction, withTransactions, world } from "./AllTestWorld.ts";

const digits = 2;
const ids = (list: readonly Transaction[]): string[] => list.map((t) => t.id);
const lower = (text: string): string => text.toLocaleLowerCase("nb");

/** The filter written the slow way: every transaction checked on its own, with no index and no shared text. */
function naiveFilter(facts: Facts, filter: AllFilter): Transaction[] {
  const query = filter.search.trim();
  const numeric = /^[-−+]?\s*\d[\d\s.,  ]*$/.test(query);
  const wanted = query.replace(/^[-−+]\s*/, "").replace(/[\s  ]/g, "").replace(/\./g, ",");
  return [...facts.transactions.values()]
    .filter((t) => {
      if (filter.account !== null && t.accountId !== filter.account) return false;
      if (filter.treatment !== null && t.treatment.kind !== filter.treatment) return false;
      if (filter.month !== null && !t.bookingDate.startsWith(`${filter.month}-`)) return false;
      if (filter.rule === "applied" && t.ruleId === undefined) return false;
      if (filter.rule === "none" && t.ruleId !== undefined) return false;
      if (filter.job !== null && !jobsOf(t).includes(filter.job)) return false;
      if (query === "") return true;
      const inText = [t.description, t.counterparty ?? "", t.note ?? ""].some((field) => lower(field).includes(lower(query)));
      const asKroner = (Math.abs(t.amount) / 100).toFixed(2).replace(".", ",").replace(/,00$/, "");
      return inText || (numeric && asKroner.includes(wanted));
    })
    .sort(compareTransactions);
}

const searchFrom = (facts: Facts): fc.Arbitrary<string> => {
  const found: string[] = [];
  for (const t of facts.transactions.values()) {
    for (const field of [t.description, t.counterparty, t.note]) {
      if (field !== undefined && field.length > 0) found.push(field.slice(0, 3), field.toUpperCase().slice(1, 4), field.trim());
    }
    found.push(amountDigits(t.amount, digits), amountDigits(t.amount, digits).slice(0, 2), ` ${Math.abs(t.amount)} `);
  }
  return fc.oneof(fc.constant(""), fc.constantFrom("", ...found), fc.string({ maxLength: 3, unit: "grapheme-ascii" }).filter((s) => !s.includes("\n")));
};

const filterFor = (facts: Facts): fc.Arbitrary<AllFilter> => {
  const accounts = [...facts.accounts.keys()];
  const jobs = [...facts.jobs.keys()];
  const months = [...new Set([...facts.transactions.values()].map((t) => t.bookingDate.slice(0, 7)))];
  const maybe = <T>(values: readonly T[]): fc.Arbitrary<T | null> => (values.length === 0 ? fc.constant(null) : fc.option(fc.constantFrom(...values), { nil: null }));
  return fc.record({
    search: searchFrom(facts),
    account: maybe(accounts),
    job: maybe(jobs),
    treatment: maybe(treatmentKinds),
    month: maybe(months),
    rule: fc.constantFrom("any", "applied", "none"),
  }) as unknown as fc.Arbitrary<AllFilter>;
};

describe("the All tab filter", () => {
  it("returns exactly the transactions a slow, one-by-one filter returns (property)", () => {
    fc.assert(
      fc.property(
        arbitraryFacts().chain((facts) => fc.tuple(fc.constant(facts), filterFor(facts))),
        ([facts, filter]) => {
          const index = buildBrowseIndex(facts.transactions.values(), digits);
          expect(ids(filterIndex(index, filter))).toEqual(ids(naiveFilter(facts, filter)));
        },
      ),
      { numRuns: 400 },
    );
  });

  it("lists everything, newest first, when nothing is filtered", () => {
    const w = world();
    const a = transaction({ accountId: w.accounts.everyday, date: "2026-10-02", amount: -100 });
    const b = transaction({ accountId: w.accounts.everyday, date: "2026-10-09", amount: -200 });
    const c = transaction({ accountId: w.accounts.bills, date: "2026-09-30", amount: -300 });
    const index = buildBrowseIndex(withTransactions(w.facts, a, b, c).transactions.values(), digits);
    expect(ids(filterIndex(index, everything))).toEqual([b.id, a.id, c.id]);
  });

  describe("search", () => {
    const w = world();
    const lyse = transaction({ accountId: w.accounts.bills, date: "2026-10-19", amount: -284_600, counterparty: "Lyse Energi AS", description: "Avtalegiro Lyse Energi 0123", treatment: splitTo(-284_600, w.jobs.electricity) });
    const kaffe = transaction({ accountId: w.accounts.everyday, date: "2026-10-20", amount: -4_950, counterparty: "Kaffebaren Torget", description: "Kortkjøp 1020", note: "Birthday coffee for Mari" });
    const refund = transaction({ accountId: w.accounts.everyday, date: "2026-10-21", amount: 129_050, description: "Retur Elkjøp" });
    const index = buildBrowseIndex(withTransactions(w.facts, lyse, kaffe, refund).transactions.values(), digits);
    const search = (text: string) => ids(filterIndex(index, { ...everything, search: text }));

    it("finds the counterparty, the bank's description and the note, ignoring case", () => {
      expect(search("lyse")).toEqual([lyse.id]);
      expect(search("AVTALEGIRO")).toEqual([lyse.id]);
      expect(search("birthday")).toEqual([kaffe.id]);
      expect(search("kortkjøp")).toEqual([kaffe.id]);
    });

    it("finds an amount typed as kroner, with or without spaces, a comma or a point", () => {
      expect(search("2846")).toEqual([lyse.id]);
      expect(search("2 846")).toEqual([lyse.id]);
      expect(search("49,50")).toEqual([kaffe.id]);
      expect(search("49.50")).toEqual([kaffe.id]);
      expect(search("-2846")).toEqual([lyse.id]);
      expect(search("1290,5")).toEqual([refund.id]);
    });

    it("does not match across the description, the name and the note", () => {
      expect(search("0123 lyse")).toEqual([]);
      expect(search("coffee for mari kortkjøp")).toEqual([]);
    });

    it("treats a search of only spaces as no search", () => {
      expect(search("   ")).toHaveLength(3);
    });
  });

  describe("filters", () => {
    const w = world();
    const food = transaction({ accountId: w.accounts.everyday, date: "2026-10-02", amount: -50_000, counterparty: "Fjordmat", treatment: splitTo(-50_000, w.jobs.food) });
    const bill = transaction({ accountId: w.accounts.bills, date: "2026-10-19", amount: -100_000, treatment: splitTo(-100_000, w.jobs.electricity), ruleId: undefined });
    const waiting = transaction({ accountId: w.accounts.everyday, date: "2026-11-01", amount: -1_000 });
    const pay = transaction({ accountId: w.accounts.everyday, date: "2026-11-02", amount: 3_000_000, treatment: { kind: "income", fundsMonth: "2026-12" as never, source: "contribution" } });
    const facts = withTransactions(w.facts, food, bill, waiting, pay);
    const index = buildBrowseIndex(facts.transactions.values(), digits);
    const only = (change: Partial<AllFilter>) => ids(filterIndex(index, { ...everything, ...change }));

    it("narrows to one account", () => {
      expect(only({ account: w.accounts.bills })).toEqual([bill.id]);
      expect(only({ account: w.accounts.everyday })).toEqual([pay.id, waiting.id, food.id]);
    });

    it("narrows to one kind, one job and one month", () => {
      expect(only({ treatment: "needsYou" })).toEqual([waiting.id]);
      expect(only({ treatment: "income" })).toEqual([pay.id]);
      expect(only({ job: w.jobs.electricity })).toEqual([bill.id]);
      expect(only({ month: "2026-11" as never })).toEqual([pay.id, waiting.id]);
    });

    it("combines every part", () => {
      expect(only({ account: w.accounts.everyday, treatment: "split", search: "fjord" })).toEqual([food.id]);
      expect(only({ account: w.accounts.bills, search: "fjord" })).toEqual([]);
    });

    it("lists the months that hold a transaction, newest first", () => {
      expect(index.months).toEqual(["2026-11", "2026-10"]);
    });
  });
});

describe("the order of the list", () => {
  it("puts the newest booking date first and breaks a tie by ID", () => {
    const w = world();
    const same1 = transaction({ id: "00000000-0000-7000-8000-00000000000b" as TransactionId, accountId: w.accounts.everyday, date: "2026-10-05", amount: -1 });
    const same2 = transaction({ id: "00000000-0000-7000-8000-00000000000a" as TransactionId, accountId: w.accounts.bills, date: "2026-10-05", amount: -2 });
    const newer = transaction({ id: "00000000-0000-7000-8000-00000000000c" as TransactionId, accountId: w.accounts.bills, date: "2026-10-06", amount: -3 });
    expect(ids(sortTransactions([same1, same2, newer]))).toEqual([newer.id, same2.id, same1.id]);
    expect(ids(sortTransactions([newer, same2, same1]))).toEqual([newer.id, same2.id, same1.id]);
  });

  it("is the same whatever order the transactions arrive in, and sorted pair by pair (property)", () => {
    fc.assert(
      fc.property(
        arbitraryFacts().chain((facts) => fc.tuple(fc.constant([...facts.transactions.values()]), fc.shuffledSubarray([...facts.transactions.values()], { minLength: facts.transactions.size, maxLength: facts.transactions.size }))),
        ([original, shuffled]) => {
          const sorted = sortTransactions(shuffled);
          expect(ids(sorted)).toEqual(ids(sortTransactions(original)));
          for (let i = 1; i < sorted.length; i += 1) expect(compareTransactions(sorted[i - 1]!, sorted[i]!)).toBeLessThan(0);
        },
      ),
    );
  });
});

describe("jobs for the job filter", () => {
  it("lists every job, by group order and name", () => {
    const w = world();
    const names = jobsInGroupOrder(w.facts, () => true).map((job) => `${job.groupName}/${job.name}`);
    expect(names).toEqual(["Fixed costs/Electricity", "Fixed costs/Insurance", "Living/Buffer", "Living/Food", "Living/Old hobby", "Living/Union fees"]);
  });
});

describe("amount digits", () => {
  it("writes kroner, then a comma and the øre only when they are not zero", () => {
    expect(amountDigits(money(139_000), 2)).toBe("1390");
    expect(amountDigits(money(-139_050), 2)).toBe("1390,50");
    expect(amountDigits(money(5), 2)).toBe("0,05");
    expect(amountDigits(money(1_000), 0)).toBe("1000");
  });
});
