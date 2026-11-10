import { type ImportCounts, type NewTransactionLine, accountId, localDate, transactionId } from "@holt/core";
import { kr, testId } from "@holt/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addWords, bankWords, chipsOf, dottedAccountNumber, leftOutNotice, nearMatchNotice, unprovenNotice, pickableJobs, readAsWords, rowViews, shownWords, stableOrder } from "./ImportPreview.model.ts";
import { english, importHousehold, noEntry, numbers, previewOf, replan, statement } from "./ImportTestKit.ts";

const counts: ImportCounts = { rows: 23, created: 21, matched: 2, pending: 0, leftOut: 0, history: 0, byRule: 0, suggested: 0, chosen: 0, transfers: 0, needsYou: 2 };

describe("the counts above the table", () => {
  it("shows the mockup's chips: rows, new, skipped duplicates and what needs you", () => {
    const chips = chipsOf(counts, 0);
    expect(chips.map((c) => [c.key, english(c.words), c.tone])).toEqual([
      ["rows", "23 rows", "plain"],
      ["created", "21 new", "plain"],
      ["matched", "The app skipped 2 duplicates", "plain"],
      ["needsYou", "2 need you", "attention"],
    ]);
  });

  it("adds a chip for pending rows kept aside, paired transfers and moves at the bank completed, only when there are some", () => {
    const chips = chipsOf({ ...counts, pending: 3, transfers: 2, needsYou: 0 }, 1);
    expect(chips.map((c) => english(c.words))).toEqual([
      "23 rows",
      "21 new",
      "The app skipped 2 duplicates",
      "Nothing needs you",
      "3 pending rows kept aside",
      "2 transfers paired",
      "1 move at the bank completed",
    ]);
    expect(chips.find((c) => c.key === "needsYou")?.tone).toBe("plain");
  });
});

describe("notices", () => {
  const h = importHousehold();
  it("warns that a format that has never read a real bank file is unproven, and says nothing for the banks' own CSV", () => {
    const plan = replan(h.facts(), statement([{ account: numbers.everyday, date: "2026-11-02", amount: kr(-120), description: "Kiwi" }]), noEntry, "unproven");
    const preview = previewOf(plan);
    expect(unprovenNotice({ ...preview, format: "ofx" })).toEqual({ id: "import.notice.unproven" });
    expect(unprovenNotice({ ...preview, format: "bulder-csv" })).toBeNull();
    expect(unprovenNotice({ ...preview, format: "sparebank1-csv" })).toBeNull();
  });

  it("calls out rows for accounts the household doesn't have, and rows that may duplicate one it has", () => {
    const first = replan(h.facts(), statement([{ account: numbers.everyday, date: "2026-11-02", amount: kr(-120), description: "Kiwi" }]), noEntry, "one");
    expect(nearMatchNotice(previewOf(first))).toBeNull();
    expect(leftOutNotice(previewOf(first))).toBeNull();
    const file = statement([
      { account: numbers.everyday, date: "2026-11-02", amount: kr(-120), description: "Kiwi" },
      { account: numbers.stranger, date: "2026-11-02", amount: kr(-50), description: "Annet", accountName: "Ferie" },
    ]);
    const preview = previewOf(replan(h.facts(), file, noEntry, "two"));
    const notice = leftOutNotice(preview);
    expect(notice && english(notice.words)).toBe("The app left out 1 row for an account that Holt doesn't have. Add it, then import the file again.");
    expect(notice?.accounts).toHaveLength(1);
  });

  it("says how many new rows may be the same as one the household already has", () => {
    expect(english(nearMatchNotice({ nearMatches: [{}, {}] } as never)!)).toBe(
      "2 new rows may each be the same as one you already have. They wait in Needs you, so you can check them.",
    );
  });
});

const line = (n: number): NewTransactionLine => ({
  transactionId: transactionId(testId(n)),
  line: n,
  accountId: accountId(testId(900)),
  bookingDate: localDate("2026-11-02"),
  amount: kr(-100),
  description: `Row ${n}`,
  treatment: { kind: "needsYou" },
  why: { kind: "none" },
});

describe("the order of the rows", () => {
  it("keeps every row where it first appeared and puts new ones after", () => {
    expect(stableOrder([5, 3, 9], [line(9), line(1), line(5), line(7)])).toEqual([5, 9, 1, 7]);
  });

  it("holds for any sequence of plans: a row already on show never moves, and every planned row appears once", () => {
    const sample = fc.uniqueArray(fc.integer({ min: 1, max: 60 }), { maxLength: 30 }).chain((lines) => fc.shuffledSubarray(lines));
    fc.assert(
      fc.property(fc.array(sample, { minLength: 1, maxLength: 6 }), (plans) => {
        let order: number[] = [];
        for (const lines of plans) {
          const next = stableOrder(order, lines.map(line));
          const kept = order.filter((l) => lines.includes(l));
          if (JSON.stringify(next.slice(0, kept.length)) !== JSON.stringify(kept)) return false;
          if (new Set(next).size !== next.length || next.length !== lines.length) return false;
          order = next;
        }
        return true;
      }),
    );
  });
});

describe("the rows", () => {
  const h = importHousehold();
  const file = statement([
    { account: numbers.everyday, date: "2026-11-02", amount: kr(-120), description: "Kiwi Sentrum", counterparty: "Kiwi" },
    { account: numbers.bills, date: "2026-11-05", amount: kr(-1_980), description: "Stavanger kommune", counterparty: "Stavanger kommune" },
  ]);
  const facts = h.facts();
  const preview = previewOf(replan(facts, file, noEntry));
  const context = { jobName: (id: never) => facts.jobs.get(id)?.name ?? "", transaction: (id: never) => facts.transactions.get(id) };

  it("shows each row with a prompt to choose a job and the reason it waits", () => {
    const views = rowViews(preview.sample.map((l) => l.line), preview.sample, context);
    expect(views.map((v) => [v.description, v.job.kind, english(v.why), v.needsYou])).toEqual([
      ["Kiwi Sentrum", "choose", "First payment to this payee", true],
      ["Stavanger kommune", "choose", "First payment to this payee", true],
    ]);
  });

  it("leaves out a line that the sample no longer holds", () => {
    expect(rowViews([999], preview.sample, context)).toEqual([]);
  });

  it("says how many of the new rows are on show and that the app suggested the jobs", () => {
    expect(english(shownWords({ counts: { created: 21 }, sample: new Array(8).fill(0) } as never, true))).toBe(
      "Showing 8 of 21 new rows. The app suggested the jobs. Change any of them now or later.",
    );
    expect(english(shownWords({ counts: { created: 8 }, sample: new Array(8).fill(0) } as never, true))).toBe("Showing all 8 new rows. The app suggested the jobs. Change any of them now or later.");
    expect(english(shownWords({ counts: { created: 1 }, sample: [0] } as never, false))).toBe(
      "Showing the one new row. The app didn't suggest jobs from earlier transactions. Choose the jobs now or later.",
    );
  });

  it("labels Add with the number of transactions it adds", () => {
    expect(english(addWords({ counts: { created: 21 } } as never))).toBe("Add 21 transactions");
    expect(english(addWords({ counts: { created: 1 } } as never))).toBe("Add 1 transaction");
    expect(english(addWords({ counts: { created: 0 } } as never))).toBe("Add the file");
  });
});

describe("account numbers", () => {
  it("are written the way the banks write them", () => {
    expect(dottedAccountNumber("97101110003")).toBe("9710.11.10003");
    expect(dottedAccountNumber("not a number")).toBe("not a number");
  });
});

describe("the bank", () => {
  it("names the bank behind each format the app reads, and says what it read the file as", () => {
    expect(english(bankWords("sparebank1-csv"))).toBe("SpareBank 1 SR-Bank");
    expect(english(bankWords("bulder-csv"))).toBe("Bulder");
    expect(english(readAsWords("sparebank1-csv"))).toBe("the app read it as a SpareBank 1 SR-Bank export");
    expect(english(readAsWords("ofx"))).toBe("the app read it as an OFX file");
    expect(english(readAsWords("some-new-format"))).toBe("the app read it in a format it knows");
  });
});

describe("the jobs a family can pick", () => {
  it("leaves out archived jobs and lists the rest by group order and name", () => {
    const h = importHousehold();
    const other = h.builder.group({ name: "Saving" });
    h.builder.spendJob({ name: "Zebra", plan: { mode: "setAmount", amount: kr(1) } });
    h.builder.spendJob({ name: "Old", plan: { mode: "setAmount", amount: kr(1) }, status: "archived" });
    h.builder.spendJob({ name: "Alpha", plan: { mode: "setAmount", amount: kr(1) }, groupId: other });
    const names = pickableJobs(h.facts()).map((j) => `${j.groupName}: ${j.name}`);
    expect(names).not.toContain("Living: Old");
    expect(names.indexOf("Living: Zebra")).toBeLessThan(names.indexOf("Saving: Alpha"));
  });
});
