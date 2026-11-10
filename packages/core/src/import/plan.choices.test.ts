import { describe, expect, it } from "vitest";
import type { TreatmentInput } from "../commands/transactions.ts";
import { localDate } from "../dates.ts";
import { needsYouItems } from "../figures/needs-you.ts";
import { type Facts, type Rule, type Transaction, makeSplit } from "../facts.ts";
import { type JobId, type TransactionId, jobId, ruleId, transactionId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { kr, setAmount, testId } from "../testing/facts-builder.ts";
import { type RowSpec, commitPlan, importHousehold, importInput, numbers, statement } from "../testing/synthetic-statement.ts";
import { type ImportInput, type ImportPlan, type ImportPreview, type NewTransactionLine, planImport } from "./plan.ts";

function preview(plan: ImportPlan): ImportPreview {
  if (!plan.ok) throw new Error(`Blocked: ${plan.blocked.kind}`);
  return plan.preview;
}

function lineAt(plan: ImportPlan, line: number): NewTransactionLine {
  const found = preview(plan).sample.find((s) => s.line === line);
  if (found === undefined) throw new Error(`No line ${line} in the sample`);
  return found;
}

type Household = ReturnType<typeof importHousehold>;

/** An earlier transaction the family already split to jobs. Its amount is the sum of the parts. */
interface Earlier {
  readonly n: number;
  readonly date: string;
  readonly counterparty: string;
  readonly to: readonly (readonly [JobId, Money])[];
}

const earlierId = (n: number): TransactionId => transactionId(testId(60_000 + n));

function withTransactions(facts: Facts, added: readonly Transaction[]): Facts {
  return { ...facts, transactions: new Map([...facts.transactions, ...added.map((t): [TransactionId, Transaction] => [t.id, t])]) };
}

function withEarlier(h: Household, earlier: readonly Earlier[]): Facts {
  return withTransactions(
    h.facts(),
    earlier.map((e): Transaction => {
      const allocations = e.to.map(([job, amount]) => ({ jobId: job, amount }));
      const amount = money(allocations.reduce((sum, a) => sum + a.amount, 0));
      return { id: earlierId(e.n), accountId: h.accounts.everyday, bookingDate: localDate(e.date), amount, description: e.counterparty, counterparty: e.counterparty, treatment: makeSplit(amount, allocations) };
    }),
  );
}

function withRules(facts: Facts, ...rules: Rule[]): Facts {
  return { ...facts, rules: new Map(rules.map((r) => [r.id, r])) };
}

const row = (counterparty: string, date: string, amount = kr(-399), description = `${counterparty} betaling`): RowSpec => ({ account: numbers.everyday, date, amount, description, counterparty });

const input = (extra: Partial<ImportInput> = {}): ImportInput => ({ ...importInput("file", 10_000), ...extra });

const rule = (n: number, counterparty: string, job: JobId): Rule => ({ id: ruleId(testId(70_000 + n)), match: { counterparty }, result: { kind: "job", jobId: job }, origin: "set", priority: 1 });

const oneJob = (job: JobId, amount: Money): TreatmentInput => ({ kind: "split", allocations: [{ jobId: job, amount }] });

describe("planImport suggests the treatment of the last transaction from the same counterparty", () => {
  it("applies it when you press Add, with the earlier transaction and how many times it ran", () => {
    const h = importHousehold();
    const facts = withEarlier(h, [
      { n: 1, date: "2026-10-01", counterparty: "Telia", to: [[h.jobs.electricity, kr(-399)]] },
      { n: 2, date: "2026-10-08", counterparty: "Telia", to: [[h.jobs.food, kr(-420)]] },
      { n: 3, date: "2026-10-15", counterparty: "Telia", to: [[h.jobs.food, kr(-380)]] },
    ]);
    const plan = planImport(facts, statement([row("Telia", "2026-11-05", kr(-400))]), input());
    const line = lineAt(plan, 2);
    expect(line.treatment).toEqual({ kind: "split", allocations: [{ jobId: h.jobs.food, amount: kr(-400) }] });
    expect(line.why).toEqual({ kind: "sameAsLast", from: earlierId(3), times: 2 });
    expect(preview(plan).counts).toMatchObject({ created: 1, suggested: 1, needsYou: 0, chosen: 0, byRule: 0 });

    const made = commitPlan(facts, plan).transactions.get(line.transactionId);
    expect(made?.treatment).toEqual(line.treatment);
    expect(made?.ruleId).toBeUndefined();
  });

  it("scales a split to the new amount by the same shares", () => {
    const h = importHousehold();
    const facts = withEarlier(h, [{ n: 1, date: "2026-10-01", counterparty: "Fremtind", to: [[h.jobs.food, kr(-600)], [h.jobs.electricity, kr(-400)]] }]);
    const line = lineAt(planImport(facts, statement([row("Fremtind", "2026-11-05", kr(-500))]), input()), 2);
    expect(line.treatment).toEqual({ kind: "split", allocations: [{ jobId: h.jobs.food, amount: kr(-300) }, { jobId: h.jobs.electricity, amount: kr(-200) }] });
    expect(line.why).toEqual({ kind: "sameAsLast", from: earlierId(1), times: 1 });
  });

  it("matches the counterparty by name, ignoring case and spaces around it", () => {
    const h = importHousehold();
    const facts = withEarlier(h, [{ n: 1, date: "2026-10-01", counterparty: "Telia ", to: [[h.jobs.food, kr(-399)]] }]);
    expect(lineAt(planImport(facts, statement([row("telia", "2026-11-05")]), input()), 2).why.kind).toBe("sameAsLast");
  });

  it("leaves the row in needs you when you turn suggestions off, and Space still offers it there afterwards", () => {
    const h = importHousehold();
    const facts = withEarlier(h, [{ n: 1, date: "2026-10-01", counterparty: "Telia", to: [[h.jobs.food, kr(-399)]] }]);
    const plan = planImport(facts, statement([row("Telia", "2026-11-05")]), input({ suggest: false }));
    const line = lineAt(plan, 2);
    expect([line.treatment, line.why]).toEqual([{ kind: "needsYou" }, { kind: "none" }]);
    expect(preview(plan).counts).toMatchObject({ suggested: 0, needsYou: 1 });
    const [item] = needsYouItems(commitPlan(facts, plan));
    expect(item?.suggestion).toMatchObject({ kind: "sameAsLast", from: earlierId(1) });
  });

  it("lets a rule win over the last transaction, and records the rule", () => {
    const h = importHousehold();
    const telia = rule(1, "Telia", h.jobs.electricity);
    const facts = withRules(withEarlier(h, [{ n: 1, date: "2026-10-01", counterparty: "Telia", to: [[h.jobs.food, kr(-399)]] }]), telia);
    const plan = planImport(facts, statement([row("Telia", "2026-11-05")]), input());
    const line = lineAt(plan, 2);
    expect([line.treatment, line.why]).toEqual([oneJob(h.jobs.electricity, kr(-399)), { kind: "rule", ruleId: telia.id }]);
    expect(commitPlan(facts, plan).transactions.get(line.transactionId)?.ruleId).toBe(telia.id);
  });

  it("never suggests for a row from before the plan start, and uses no transaction booked after the row", () => {
    const h = importHousehold();
    const facts = withEarlier(h, [
      { n: 1, date: "2026-10-01", counterparty: "Telia", to: [[h.jobs.food, kr(-399)]] },
      { n: 2, date: "2026-11-20", counterparty: "Vipps", to: [[h.jobs.food, kr(-100)]] },
    ]);
    const plan = planImport(facts, statement([row("Telia", "2026-09-05"), row("Vipps", "2026-11-05", kr(-100))]), input());
    expect(lineAt(plan, 2).why).toEqual({ kind: "history" });
    expect(lineAt(plan, 3).why).toEqual({ kind: "firstPayment" });
  });

  it("does not let one row of the file decide another, whatever you choose for it", () => {
    const h = importHousehold();
    const file = statement([row("Telia", "2026-11-05"), row("Telia", "2026-11-06", kr(-399), "Telia igjen")]);
    const plan = planImport(h.facts(), file, input({ choices: [{ line: 2, treatment: oneJob(h.jobs.food, kr(-399)) }] }));
    expect(lineAt(plan, 3).why).toEqual({ kind: "none" });
  });
});

describe("planImport says when a payee's jobs disagree", () => {
  it("leaves the row in needs you and names the jobs, latest first, when the last two went to different jobs", () => {
    const h = importHousehold();
    const facts = withEarlier(h, [
      { n: 1, date: "2026-10-01", counterparty: "Stavanger kommune", to: [[h.jobs.food, kr(-1_980)]] },
      { n: 2, date: "2026-10-10", counterparty: "Stavanger kommune", to: [[h.jobs.electricity, kr(-1_200)]] },
    ]);
    const plan = planImport(facts, statement([row("Stavanger kommune", "2026-11-05", kr(-1_500))]), input());
    expect([lineAt(plan, 2).treatment, lineAt(plan, 2).why]).toEqual([{ kind: "needsYou" }, { kind: "ambiguous", jobs: [h.jobs.electricity, h.jobs.food] }]);
    expect(preview(plan).counts).toMatchObject({ needsYou: 1, suggested: 0 });
  });

  it("names at most three jobs", () => {
    const h = importHousehold();
    const eatingOut = h.builder.spendJob({ name: "Eating out", plan: setAmount(kr(500)) });
    const gifts = h.builder.spendJob({ name: "Gifts", plan: setAmount(kr(500)) });
    const facts = withEarlier(h, [
      { n: 1, date: "2026-10-01", counterparty: "Vipps", to: [[h.jobs.food, kr(-100)]] },
      { n: 2, date: "2026-10-02", counterparty: "Vipps", to: [[h.jobs.electricity, kr(-100)]] },
      { n: 3, date: "2026-10-03", counterparty: "Vipps", to: [[eatingOut, kr(-100)]] },
      { n: 4, date: "2026-10-04", counterparty: "Vipps", to: [[gifts, kr(-100)]] },
    ]);
    expect(lineAt(planImport(facts, statement([row("Vipps", "2026-11-05", kr(-100))]), input()), 2).why).toEqual({ kind: "ambiguous", jobs: [gifts, eatingOut, h.jobs.electricity] });
  });

  it("suggests when the last two agree, even if an older one went elsewhere", () => {
    const h = importHousehold();
    const facts = withEarlier(h, [
      { n: 1, date: "2026-10-01", counterparty: "Vipps", to: [[h.jobs.electricity, kr(-100)]] },
      { n: 2, date: "2026-10-02", counterparty: "Vipps", to: [[h.jobs.food, kr(-110)]] },
      { n: 3, date: "2026-10-03", counterparty: "Vipps", to: [[h.jobs.food, kr(-120)]] },
    ]);
    expect(lineAt(planImport(facts, statement([row("Vipps", "2026-11-05", kr(-130))]), input()), 2).why).toEqual({ kind: "sameAsLast", from: earlierId(3), times: 2 });
  });

  it("calls a split across the same jobs the same, whatever the shares", () => {
    const h = importHousehold();
    const facts = withEarlier(h, [
      { n: 1, date: "2026-10-01", counterparty: "Fremtind", to: [[h.jobs.food, kr(-600)], [h.jobs.electricity, kr(-400)]] },
      { n: 2, date: "2026-10-02", counterparty: "Fremtind", to: [[h.jobs.electricity, kr(-100)], [h.jobs.food, kr(-900)]] },
    ]);
    expect(lineAt(planImport(facts, statement([row("Fremtind", "2026-11-05", kr(-1_000))]), input()), 2).why).toEqual({ kind: "sameAsLast", from: earlierId(2), times: 2 });
  });
});

describe("planImport says when there is nothing to go on", () => {
  it("calls the first transaction from a counterparty a first payment, and the rest of that file no suggestion", () => {
    const h = importHousehold();
    const plan = planImport(h.facts(), statement([row("Vipps *Hinna Fotball", "2026-11-03", kr(-1_200)), row("Vipps *Hinna Fotball", "2026-11-10", kr(-1_200), "Vipps igjen")]), input());
    expect([lineAt(plan, 2).why, lineAt(plan, 3).why]).toEqual([{ kind: "firstPayment" }, { kind: "none" }]);
  });

  it("is no first payment when the counterparty is already in the facts, decided or not", () => {
    const h = importHousehold();
    const other = (treatment: Transaction["treatment"], date: string): Transaction => ({
      id: earlierId(1),
      accountId: h.accounts.everyday,
      bookingDate: localDate(date),
      amount: kr(-10),
      description: "Lading",
      counterparty: "Ladestasjon",
      treatment,
    });
    for (const earlier of [other({ kind: "needsYou" }, "2026-10-04"), other({ kind: "history", jobId: null }, "2026-09-04")]) {
      const plan = planImport(withTransactions(h.facts(), [earlier]), statement([row("Ladestasjon", "2026-11-05")]), input());
      expect(lineAt(plan, 2).why).toEqual({ kind: "none" });
    }
  });

  it("gives a row with no counterparty no suggestion", () => {
    const h = importHousehold();
    const bare: RowSpec = { account: numbers.everyday, date: "2026-11-05", amount: kr(-399), description: "Betaling" };
    expect(lineAt(planImport(h.facts(), statement([bare]), input()), 2).why).toEqual({ kind: "none" });
  });
});

describe("planImport flags a changed amount", () => {
  const fixed = (h: Household): Earlier[] => [
    { n: 1, date: "2026-10-01", counterparty: "Viaplay", to: [[h.jobs.food, kr(-399)]] },
    { n: 2, date: "2026-10-08", counterparty: "Viaplay", to: [[h.jobs.food, kr(-399)]] },
  ];

  it("when the last two were equal and this one differs, still giving the same job", () => {
    const h = importHousehold();
    const plan = planImport(withEarlier(h, fixed(h)), statement([row("Viaplay", "2026-11-01", kr(-449))]), input());
    expect(lineAt(plan, 2).why).toEqual({ kind: "priceChange", from: kr(-399) });
    expect(lineAt(plan, 2).treatment).toEqual(oneJob(h.jobs.food, kr(-449)));
    expect(preview(plan).counts).toMatchObject({ suggested: 1 });
  });

  it("not when this one is the same amount", () => {
    const h = importHousehold();
    expect(lineAt(planImport(withEarlier(h, fixed(h)), statement([row("Viaplay", "2026-11-01", kr(-399))]), input()), 2).why).toMatchObject({ kind: "sameAsLast", times: 2 });
  });

  it("not for a bill that varies, or when only one earlier amount is known", () => {
    const h = importHousehold();
    const facts = withEarlier(h, [
      { n: 1, date: "2026-10-01", counterparty: "Lyse", to: [[h.jobs.electricity, kr(-2_700)]] },
      { n: 2, date: "2026-10-08", counterparty: "Lyse", to: [[h.jobs.electricity, kr(-2_800)]] },
      { n: 3, date: "2026-10-15", counterparty: "Lyse", to: [[h.jobs.electricity, kr(-2_900)]] },
      { n: 4, date: "2026-10-23", counterparty: "Once", to: [[h.jobs.food, kr(-399)]] },
    ]);
    const plan = planImport(facts, statement([row("Lyse", "2026-11-05", kr(-2_846)), row("Once", "2026-11-06", kr(-449))]), input());
    expect([lineAt(plan, 2).why.kind, lineAt(plan, 3).why.kind]).toEqual(["sameAsLast", "sameAsLast"]);
  });

  it("not when the equal amounts went to different jobs", () => {
    const h = importHousehold();
    const facts = withEarlier(h, [
      { n: 1, date: "2026-10-01", counterparty: "Viaplay", to: [[h.jobs.electricity, kr(-399)]] },
      { n: 2, date: "2026-10-08", counterparty: "Viaplay", to: [[h.jobs.food, kr(-399)]] },
    ]);
    expect(lineAt(planImport(facts, statement([row("Viaplay", "2026-11-01", kr(-449))]), input()), 2).why.kind).toBe("ambiguous");
  });
});

describe("planImport applies your choices", () => {
  it("lets a choice win over a rule, a suggestion and a near match", () => {
    const h = importHousehold();
    h.builder.needsYou({ date: "2026-11-05", amount: kr(-90), description: "Bakeri betaling" });
    const kiwi = rule(1, "Kiwi", h.jobs.food);
    const facts = withRules(withEarlier(h, [{ n: 1, date: "2026-10-01", counterparty: "Telia", to: [[h.jobs.electricity, kr(-399)]] }]), kiwi);
    const file = statement([row("Kiwi", "2026-11-05", kr(-120)), row("Telia", "2026-11-05"), row("Bakeri", "2026-11-04", kr(-90))]);
    const unchosen = planImport(facts, file, input());
    expect(unchosen.ok && unchosen.preview.sample.map((s) => s.why.kind).sort()).toEqual(["nearMatch", "rule", "sameAsLast"]);

    const choices = [
      { line: 2, treatment: oneJob(h.jobs.buffer, kr(-120)) },
      { line: 3, treatment: oneJob(h.jobs.buffer, kr(-399)) },
      { line: 4, treatment: oneJob(h.jobs.buffer, kr(-90)) },
    ];
    const plan = planImport(facts, file, input({ choices }));
    for (const line of [2, 3, 4]) {
      expect(lineAt(plan, line).why).toEqual({ kind: "chosen" });
      expect(lineAt(plan, line).treatment).toMatchObject({ kind: "split", allocations: [{ jobId: h.jobs.buffer }] });
    }
    expect(preview(plan)).toMatchObject({ nearMatches: [], ignoredChoices: [], counts: { chosen: 3, byRule: 0, suggested: 0, needsYou: 0 } });
    expect(commitPlan(facts, plan).transactions.get(lineAt(plan, 2).transactionId)?.ruleId).toBeUndefined();
  });

  it("accepts a split across jobs that adds up", () => {
    const h = importHousehold();
    const choice: TreatmentInput = { kind: "split", allocations: [{ jobId: h.jobs.food, amount: kr(-70) }, { jobId: h.jobs.electricity, amount: kr(-50) }] };
    const plan = planImport(h.facts(), statement([row("Kiwi", "2026-11-05", kr(-120))]), input({ choices: [{ line: 2, treatment: choice }] }));
    expect(lineAt(plan, 2).treatment).toEqual(choice);
  });

  it("keeps a row you chose to leave in needs you there, and never pairs it as a transfer", () => {
    const h = importHousehold();
    const sides: RowSpec[] = [
      { account: numbers.everyday, date: "2026-11-02", amount: kr(-2_000), description: "Overføring" },
      { account: numbers.savings, date: "2026-11-02", amount: kr(2_000), description: "Overføring" },
    ];
    expect(preview(planImport(h.facts(), statement(sides), input())).transfers).toHaveLength(1);
    const plan = planImport(h.facts(), statement(sides), input({ choices: [{ line: 2, treatment: { kind: "needsYou" } }] }));
    expect(preview(plan).transfers).toEqual([]);
    expect(lineAt(plan, 2)).toMatchObject({ treatment: { kind: "needsYou" }, why: { kind: "chosen" } });
    expect(preview(plan).counts).toMatchObject({ needsYou: 2, chosen: 0, transfers: 0 });
  });

  it("lets the later of two choices for one line win", () => {
    const h = importHousehold();
    const choices = [
      { line: 2, treatment: oneJob(h.jobs.food, kr(-120)) },
      { line: 2, treatment: oneJob(h.jobs.electricity, kr(-120)) },
    ];
    const plan = planImport(h.facts(), statement([row("Kiwi", "2026-11-05", kr(-120))]), input({ choices }));
    expect(lineAt(plan, 2).treatment).toMatchObject({ allocations: [{ jobId: h.jobs.electricity }] });
  });

  describe("refuses a choice the app can't give", () => {
    const badChoice = { ok: false, blocked: { kind: "badChoice", line: 3 } };
    const chooseForLine3 = (treatment: TreatmentInput, date = "2026-11-05") => {
      const h = importHousehold();
      return planImport(h.facts(), statement([row("Kiwi", "2026-11-04", kr(-90)), row("Kiwi", date, kr(-120))]), input({ choices: [{ line: 3, treatment }] }));
    };

    it("when a split does not add up to the amount", () => {
      expect(chooseForLine3(oneJob(importHousehold().jobs.food, kr(-119)))).toEqual(badChoice);
    });

    it("when it names a job the household doesn't have", () => {
      expect(chooseForLine3(oneJob(jobId(testId(1)), kr(-120)))).toEqual(badChoice);
    });

    it("when it is income, a transfer or history", () => {
      for (const treatment of [{ kind: "income", fundsMonth: "2026-12", source: "other" }, { kind: "transfer", partner: null }, { kind: "history", jobId: null }] as unknown as TreatmentInput[]) {
        expect(chooseForLine3(treatment)).toEqual(badChoice);
      }
    });

    it("when the line is from before the plan start and the split still does not add up", () => {
      expect(chooseForLine3(oneJob(importHousehold().jobs.food, kr(-119)), "2026-09-05")).toEqual(badChoice);
    });

    it("naming the first bad line in the file, and importing once the choices are mended", () => {
      const h = importHousehold();
      const file = statement([row("Kiwi", "2026-11-04", kr(-90)), row("Kiwi", "2026-11-05", kr(-120)), row("Kiwi", "2026-11-06", kr(-130))]);
      const choose = (line: number, amount: Money) => ({ line, treatment: oneJob(h.jobs.food, amount) });
      expect(planImport(h.facts(), file, input({ choices: [choose(4, kr(-1)), choose(3, kr(-2))] }))).toEqual(badChoice);
      expect(planImport(h.facts(), file, input({ choices: [choose(4, kr(-130)), choose(3, kr(-120))] })).ok).toBe(true);
    });
  });

  describe("ignores a choice that has nothing to apply to", () => {
    it("for a line that matches an existing transaction, even when the choice would be bad", () => {
      const h = importHousehold();
      const existing = h.builder.needsYou({ date: "2026-11-02", amount: kr(-120), description: "Kiwi betaling" });
      const facts = h.facts();
      const choices = [
        { line: 2, treatment: oneJob(h.jobs.food, kr(-1)) },
        { line: 3, treatment: oneJob(h.jobs.food, kr(-50)) },
      ];
      const plan = planImport(facts, statement([row("Kiwi", "2026-11-02", kr(-120)), row("Kiwi", "2026-11-03", kr(-50))]), input({ choices }));
      expect(preview(plan).ignoredChoices).toEqual([2]);
      expect(preview(plan).counts).toMatchObject({ matched: 1, created: 1, chosen: 1 });
      expect(commitPlan(facts, plan).transactions.get(existing)?.treatment).toEqual({ kind: "needsYou" });
    });

    it("for a pending line, a line of an account the household doesn't have, and a line not in the file", () => {
      const h = importHousehold();
      const file = statement([{ ...row("Kiwi", "2026-11-02"), pending: true }, { ...row("Kiwi", "2026-11-02"), account: numbers.stranger }, row("Rema", "2026-11-03")]);
      const choices = [4, 99, 2, 3].map((line) => ({ line, treatment: oneJob(h.jobs.food, kr(-399)) }));
      const plan = planImport(h.facts(), file, input({ choices }));
      expect(preview(plan).ignoredChoices).toEqual([2, 3, 99]);
      expect(lineAt(plan, 4).why.kind).toBe("chosen");
    });

    it("for a needs you choice or a split across jobs on a line from before the plan start", () => {
      const h = importHousehold();
      const two: TreatmentInput = { kind: "split", allocations: [{ jobId: h.jobs.food, amount: kr(-60) }, { jobId: h.jobs.electricity, amount: kr(-60) }] };
      const file = statement([row("Kiwi", "2026-09-05", kr(-120)), row("Rema", "2026-09-06", kr(-120))]);
      const plan = planImport(h.facts(), file, input({ choices: [{ line: 2, treatment: { kind: "needsYou" } }, { line: 3, treatment: two }] }));
      expect(preview(plan).ignoredChoices).toEqual([2, 3]);
      expect(preview(plan).sample.map((s) => s.treatment)).toEqual([{ kind: "history", jobId: null }, { kind: "history", jobId: null }]);
    });
  });

  describe("from before the plan start", () => {
    it("gives a single job as the history job, over a rule's", () => {
      const h = importHousehold();
      const facts = withRules(h.facts(), rule(1, "Kiwi", h.jobs.food));
      const file = statement([row("Kiwi", "2026-09-05", kr(-120)), row("Kiwi", "2026-09-06", kr(-130))]);
      const plan = planImport(facts, file, input({ choices: [{ line: 2, treatment: oneJob(h.jobs.electricity, kr(-120)) }] }));
      expect([lineAt(plan, 2).treatment, lineAt(plan, 2).why]).toEqual([{ kind: "history", jobId: h.jobs.electricity }, { kind: "chosen" }]);
      expect([lineAt(plan, 3).treatment, lineAt(plan, 3).why]).toEqual([{ kind: "history", jobId: h.jobs.food }, { kind: "history" }]);
      expect(preview(plan).counts).toMatchObject({ history: 2, chosen: 0 });
      expect(preview(plan).ignoredChoices).toEqual([]);
    });
  });
});

describe("planImport lists what needs you first", () => {
  it("puts needs you, near matches, first payments and price changes before the rest, each by date", () => {
    const h = importHousehold();
    h.builder.needsYou({ date: "2026-11-10", amount: kr(-90), description: "Bakeri betaling" });
    const facts = withRules(
      withEarlier(h, [
        { n: 1, date: "2026-10-01", counterparty: "Telia", to: [[h.jobs.food, kr(-399)]] },
        { n: 2, date: "2026-10-08", counterparty: "Viaplay", to: [[h.jobs.food, kr(-399)]] },
        { n: 3, date: "2026-10-15", counterparty: "Viaplay", to: [[h.jobs.food, kr(-399)]] },
      ]),
      rule(1, "Kiwi", h.jobs.food),
    );
    const bare: RowSpec = { account: numbers.everyday, date: "2026-11-13", amount: kr(-10), description: "Betaling" };
    const file = statement([
      row("Kiwi", "2026-11-01", kr(-120)),
      row("Telia", "2026-11-02"),
      row("Viaplay", "2026-11-03", kr(-449)),
      row("Hinna Fotball", "2026-11-04", kr(-1_200)),
      row("Bakeri", "2026-11-09", kr(-90)),
      row("Telia", "2026-11-12", kr(-380)),
      bare,
      row("Kiwi", "2026-11-02", kr(-130)),
    ]);
    expect(preview(planImport(facts, file, input())).sample.map((s) => [s.line, s.why.kind])).toEqual([
      [8, "none"],
      [6, "nearMatch"],
      [5, "firstPayment"],
      [4, "priceChange"],
      [2, "rule"],
      [3, "sameAsLast"],
      [9, "rule"],
      [7, "sameAsLast"],
    ]);
  });
});
