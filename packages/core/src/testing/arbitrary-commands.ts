/**
 * Random command scripts for property tests. A script starts from a sound household that commands built
 * (shared accounts and a paid-into one, groups, the buffer, jobs of every kind and history before the plan
 * start) and people, then runs random steps of every command kind. Each step is a recipe read against the facts as
 * they stand, so later commands refer to rows that earlier ones made, and some are refused, as in real use.
 */

import fc from "fast-check";
import { type ApplyContext, type Command, apply } from "../commands/apply.ts";
import type { JobChanges } from "../commands/jobs.ts";
import { nextMonthToOpen } from "../commands/months.ts";
import { keepsMoney } from "../figures/jobs.ts";
import { type LocalDate, type Month, addMonths, localDate, month, monthOf } from "../dates.ts";
import {
  type AccountKind,
  type Facts,
  type Household,
  type Job,
  type JobStatus,
  type SaveUpTarget,
  type SpendPlan,
  type Treatment,
  emptyFacts,
  householdOf,
  makeSplit,
  overrideSubject,
} from "../facts.ts";
import { accountId, agreementId, bucketTransferId, enteredValueId, groupId, householdId, jobId, moveId, personId, transactionId } from "../ids.ts";
import { type Money, currency, money } from "../money.ts";
import { NOK, testId } from "./facts-builder.ts";

export const scriptPlanStart = month("2026-03");
const monthAt = (index: number): Month => addMonths(scriptPlanStart, index);

const amountUpTo = (maxKroner: number): fc.Arbitrary<Money> => fc.integer({ min: 0, max: maxKroner * 100 }).map(money);
const signedAmount = (maxKroner: number): fc.Arbitrary<Money> => fc.integer({ min: -maxKroner * 100, max: maxKroner * 100 }).map(money);
const dayIn = (firstIndex: number, lastIndex: number): fc.Arbitrary<LocalDate> =>
  fc
    .record({ index: fc.integer({ min: firstIndex, max: lastIndex }), day: fc.integer({ min: 1, max: 28 }) })
    .map(({ index, day }) => localDate(`${monthAt(index)}-${String(day).padStart(2, "0")}`));
const maybe = <T>(arbitrary: fc.Arbitrary<T>): fc.Arbitrary<T | null> => fc.option(arbitrary, { nil: null });
const accountKind = fc.constantFrom<AccountKind>("everyday", "bills", "savings", "loan");
const jobStatus = fc.constantFrom<JobStatus>("active", "active", "active", "paused", "finished", "archived");

/** `{ [key]: value }`, or nothing when the value is null, for optional fields under exactOptionalPropertyTypes. */
function optional<K extends string, V>(key: K, value: V | null): { [P in K]?: V } {
  return (value === null ? {} : { [key]: value }) as { [P in K]?: V };
}

function at<T>(list: readonly T[], n: number): T | undefined {
  return list.length === 0 ? undefined : list[n % list.length];
}

const planRecipe = fc.record({
  kind: fc.constantFrom("setAmount", "followBills", "evenOut", "carryOver", "amountByMonth", "monthly", "payInto"),
  amount: amountUpTo(20_000),
  monthIndex: fc.integer({ min: -2, max: 9 }),
  account: fc.nat(),
});
type PlanRecipe = typeof planRecipe extends fc.Arbitrary<infer R> ? R : never;

const jobRecipe = fc.record({
  plan: planRecipe,
  group: fc.nat(),
  status: jobStatus,
  essential: fc.boolean(),
  opening: fc.oneof(fc.constant(money(0)), amountUpTo(10_000)),
  seasonality: fc.constantFrom("auto", "seasonal", "irregular" as const),
});
type JobRecipe = typeof jobRecipe extends fc.Arbitrary<infer R> ? R : never;

const treatmentRecipe = fc.record({
  kind: fc.constantFrom("income", "split", "transfer", "needsYou", "history"),
  fundsOffset: fc.integer({ min: 0, max: 1 }),
  jobs: fc.array(fc.record({ job: fc.nat(), amount: signedAmount(5_000) }), { minLength: 1, maxLength: 3 }),
  partner: maybe(fc.nat()),
  /** Mostly fit the treatment to the plan start (rule 3), so most transactions are accepted. */
  fitPlanStart: fc.constantFrom(true, true, true, true, false),
});
type TreatmentRecipe = typeof treatmentRecipe extends fc.Arbitrary<infer R> ? R : never;

const stepRecipe = fc.oneof(
  fc.record({ kind: fc.constant("addAccount"), name: fc.constantFrom("Bills", "Savings", "Holiday", "Car", ""), accountKind, scope: fc.constantFrom("shared", "paidInto" as const), openingBalance: signedAmount(20_000) }),
  fc.record({ kind: fc.constant("changeAccount"), pick: fc.nat(), name: maybe(fc.constantFrom("Renamed", "Joint", "")), accountKind: maybe(accountKind) }),
  fc.record({ kind: fc.constant("addGroup"), name: fc.constantFrom("Saving", "Fixed costs", "Living", "") }),
  fc.record({ kind: fc.constant("changeGroup"), pick: fc.nat(), name: maybe(fc.constantFrom("Living", "Bills", "")), order: maybe(fc.nat(5)), counts: maybe(fc.boolean()) }),
  fc.record({ kind: fc.constant("addJob"), job: jobRecipe, buffer: fc.constantFrom(false, false, false, false, true) }),
  fc.record({
    kind: fc.constant("changeJob"),
    pick: fc.nat(),
    name: maybe(fc.constantFrom("Renamed", "Food", "")),
    essential: maybe(fc.boolean()),
    status: maybe(jobStatus),
    group: maybe(fc.nat()),
    plan: maybe(planRecipe),
    keepsMoney: maybe(fc.boolean()),
    /** Mostly change the fields of the job's own kind, so most changes are accepted. */
    sameKind: fc.constantFrom(true, true, true, false),
  }),
  fc.record({ kind: fc.constant("deleteJob"), pick: fc.nat() }),
  { weight: 3, arbitrary: fc.record({ kind: fc.constant("openMonth"), next: fc.constantFrom(true, true, true, false), monthIndex: fc.integer({ min: -1, max: 9 }) }) },
  fc.record({ kind: fc.constant("closeMonth"), pick: fc.nat() }),
  fc.record({ kind: fc.constant("reopenMonth"), pick: fc.nat(), closed: fc.constantFrom(true, true, false) }),
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("assign"), month: fc.nat(), job: fc.nat(), amount: fc.oneof(fc.constant(money(0)), amountUpTo(10_000), signedAmount(100)) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant("moveAssignment"), month: fc.nat(), from: fc.nat(), to: fc.nat(), percent: fc.integer({ min: 0, max: 120 }) }) },
  fc.record({ kind: fc.constant("addMove"), from: fc.nat(), to: fc.nat(), amount: amountUpTo(5_000), monthIndex: fc.integer({ min: 0, max: 8 }) }),
  fc.record({ kind: fc.constant("setMoveStatus"), pick: fc.nat(), toDo: fc.constantFrom(true, true, false), done: fc.boolean(), completedBy: maybe(fc.nat()) }),
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("enterValue"), what: fc.constantFrom("bufferMonths", "override", "balance", "figure"), pick: fc.nat(), monthIndex: fc.integer({ min: 0, max: 9 }), value: fc.integer({ min: 0, max: 600_000 }), date: dayIn(-3, 8) }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("recordTransaction"), account: fc.nat(), date: dayIn(-4, 8), amount: signedAmount(20_000), treatment: treatmentRecipe }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("setTreatment"), pick: fc.nat(), treatment: treatmentRecipe }) },
  fc.record({ kind: fc.constant("addPerson"), name: fc.constantFrom("Alex", "Sam", "Robin", "  "), child: fc.boolean(), birthMonth: maybe(fc.integer({ min: -200, max: 8 })) }),
  fc.record({ kind: fc.constant("changePerson"), pick: fc.nat(), name: maybe(fc.constantFrom("Renamed", "Sam", "")), birthMonth: maybe(fc.integer({ min: -200, max: 8 })), clearBirthMonth: fc.boolean() }),
  fc.record({ kind: fc.constant("deletePerson"), pick: fc.nat() }),
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("addAgreement"),
      person: fc.nat(),
      account: fc.nat(),
      amount: fc.oneof({ weight: 1, arbitrary: fc.constant(money(0)) }, { weight: 6, arbitrary: amountUpTo(30_000) }),
      day: fc.integer({ min: 0, max: 30 }),
      fromIndex: fc.integer({ min: 0, max: 6 }),
      lastOffset: maybe(fc.integer({ min: -2, max: 6 })),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("changeAgreement"),
      pick: fc.nat(),
      amount: maybe(fc.oneof({ weight: 1, arbitrary: fc.constant(money(0)) }, { weight: 6, arbitrary: amountUpTo(30_000) })),
      day: maybe(fc.integer({ min: 0, max: 30 })),
      account: maybe(fc.nat()),
      lastOffset: maybe(fc.integer({ min: -2, max: 6 })),
      clearEnd: fc.boolean(),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("moveBucket"),
      month: fc.nat(),
      from: fc.nat(),
      to: fc.nat(),
      /** Mostly small, so the bucket holds it. */
      amount: fc.oneof({ weight: 1, arbitrary: fc.constant(money(0)) }, { weight: 6, arbitrary: fc.integer({ min: 1, max: 50_000 }).map(money) }, { weight: 2, arbitrary: fc.integer({ min: 1, max: 600_000 }).map(money) }),
      reason: fc.constantFrom("Seed the bucket", "Seed the bucket", ""),
    }),
  },
  fc.record({ kind: fc.constant("changeHousehold"), name: maybe(fc.constantFrom("Renamed", "Home", "")), step: maybe(fc.constantFrom(0, 2_500, 10_000, 20_000)), currency: maybe(fc.constantFrom("NOK", "EUR")), planStart: maybe(fc.integer({ min: -2, max: 2 })) }),
);
type StepRecipe = typeof stepRecipe extends fc.Arbitrary<infer R> ? R : never;

const setupRecipe = fc.record({
  people: fc.array(fc.boolean(), { minLength: 1, maxLength: 3 }),
  shared: fc.array(fc.record({ kind: accountKind, openingBalance: signedAmount(50_000) }), { minLength: 1, maxLength: 3 }),
  groups: fc.integer({ min: 1, max: 3 }),
  buffer: fc.record({ monthly: amountUpTo(5_000), opening: amountUpTo(60_000), account: fc.nat() }),
  jobs: fc.array(jobRecipe, { maxLength: 6 }),
  history: fc.array(fc.record({ account: fc.nat(), date: dayIn(-4, -1), amount: signedAmount(5_000), job: maybe(fc.nat()) }), { maxLength: 8 }),
});

const keys = <K>(table: ReadonlyMap<K, unknown>): K[] => [...table.keys()];
const sharedAccounts = (facts: Facts) => [...facts.accounts.values()].filter((a) => a.scope === "shared").map((a) => a.id);
const paidIntoAccounts = (facts: Facts) => [...facts.accounts.values()].filter((a) => a.scope === "paidInto").map((a) => a.id);

function spendPlan(recipe: PlanRecipe): SpendPlan {
  switch (recipe.kind) {
    case "followBills":
      return { mode: "followBills" };
    case "evenOut":
      return { mode: "evenOut", monthly: recipe.amount, startMonth: monthAt(recipe.monthIndex) };
    default:
      return { mode: "setAmount", amount: recipe.amount };
  }
}

function saveUpTarget(recipe: PlanRecipe): SaveUpTarget {
  return recipe.kind === "amountByMonth" ? { kind: "amountByMonth", amount: recipe.amount, readyBy: monthAt(recipe.monthIndex) } : { kind: "monthly", amount: recipe.amount };
}

const kindOfPlan: Record<PlanRecipe["kind"], Job["kind"]> = {
  setAmount: "spend",
  followBills: "spend",
  evenOut: "spend",
  carryOver: "spend",
  amountByMonth: "saveUp",
  monthly: "saveUp",
  payInto: "payInto",
};

function kindChanges(kind: Job["kind"], recipe: PlanRecipe, target: Job, keepsMoney: boolean | null): NonNullable<JobChanges["ofKind"]> {
  switch (kind) {
    case "spend":
      return { kind, plan: spendPlan(recipe), ...optional("keepsMoney", keepsMoney) };
    case "saveUp":
      return { kind, target: target.kind === "saveUp" && target.role === "buffer" ? { kind: "bufferMonths", monthly: recipe.amount } : saveUpTarget(recipe) };
    case "payInto":
      return { kind, monthly: recipe.amount };
  }
}

function jobFrom(facts: Facts, recipe: JobRecipe, id: string): Job {
  const base = {
    id: jobId(id),
    name: `Job ${id.slice(-4)}`,
    groupId: at(keys(facts.groups), recipe.group) ?? groupId(testId(1)),
    status: recipe.status,
    accountId: at(sharedAccounts(facts), recipe.plan.account) ?? accountId(testId(1)),
    essential: recipe.essential,
    opening: recipe.opening,
  };
  switch (recipe.plan.kind) {
    case "setAmount":
    case "followBills":
    case "evenOut":
    case "carryOver":
      return { ...base, kind: "spend", plan: spendPlan(recipe.plan), keepsMoney: recipe.plan.kind === "carryOver", seasonality: recipe.seasonality };
    case "amountByMonth":
    case "monthly":
      return { ...base, kind: "saveUp", role: "ordinary", target: saveUpTarget(recipe.plan) };
    case "payInto":
      return { ...base, kind: "payInto", monthly: recipe.plan.amount, payInto: at(paidIntoAccounts(facts), recipe.plan.account) ?? accountId(testId(2)) };
  }
}

function treatmentFor(facts: Facts, recipe: TreatmentRecipe, date: LocalDate, amount: Money): { readonly amount: Money; readonly treatment: Treatment } {
  const jobs = keys(facts.jobs);
  const before = monthOf(date) < householdOf(facts).planStart;
  let kind = recipe.kind;
  if (recipe.fitPlanStart) kind = before ? "history" : kind === "history" ? "needsYou" : kind;
  switch (kind) {
    case "income":
      return { amount, treatment: { kind: "income", fundsMonth: addMonths(monthOf(date), recipe.fundsOffset), source: "contribution" } };
    case "split": {
      const picked = recipe.jobs.flatMap(({ job, amount: share }) => {
        const id = at(jobs, job);
        return id === undefined ? [] : [{ jobId: id, amount: share }];
      });
      const [first, ...rest] = picked;
      if (first === undefined) return { amount, treatment: { kind: "needsYou" } };
      // The first allocation takes what the others leave, so the split adds up to the amount (rule 3).
      const remainder = money(amount - rest.reduce((sum, a) => sum + a.amount, 0));
      const allocations = [{ ...first, amount: remainder }, ...rest];
      return { amount, treatment: makeSplit(amount, allocations) };
    }
    case "transfer":
      return { amount, treatment: { kind: "transfer", partner: recipe.partner === null ? null : (at(keys(facts.transactions), recipe.partner) ?? null) } };
    case "history":
      return { amount, treatment: { kind: "history", jobId: at(jobs, recipe.jobs[0]?.job ?? 0) ?? null } };
    case "needsYou":
      return { amount, treatment: { kind: "needsYou" } };
  }
}

function openMonths(facts: Facts): Month[] {
  const open = [...facts.budgetMonths.values()].filter((b) => b.state !== "closed").map((b) => b.month);
  return open.length > 0 ? open : keys(facts.budgetMonths);
}

function commandFrom(facts: Facts, step: StepRecipe, id: string): Command {
  const jobs = keys(facts.jobs);
  const accounts = keys(facts.accounts);
  const anyJob = (n: number) => at(jobs, n) ?? jobId(id);
  const anyAccount = (n: number) => at(accounts, n) ?? accountId(id);
  switch (step.kind) {
    case "addAccount":
      return { kind: "addAccount", account: { id: accountId(id), name: step.name, kind: step.accountKind, scope: step.scope, openingBalance: step.openingBalance, openingDate: localDate("2026-02-28") } };
    case "changeAccount":
      return { kind: "changeAccount", accountId: anyAccount(step.pick), changes: { ...optional("name", step.name), ...optional("kind", step.accountKind) } };
    case "addGroup":
      return { kind: "addGroup", group: { id: groupId(id), name: step.name, order: facts.groups.size, countsTowardsSavingsRate: false } };
    case "changeGroup":
      return {
        kind: "changeGroup",
        groupId: at(keys(facts.groups), step.pick) ?? groupId(id),
        changes: { ...optional("name", step.name), ...optional("order", step.order), ...optional("countsTowardsSavingsRate", step.counts) },
      };
    case "addJob": {
      const job = jobFrom(facts, step.job, id);
      const { id: jobId, name, groupId: group, status, accountId: account, essential, opening } = job;
      const buffer: Job = { id: jobId, name, groupId: group, status, accountId: account, essential, opening, kind: "saveUp", role: "buffer", target: { kind: "bufferMonths", monthly: step.job.plan.amount } };
      return { kind: "addJob", job: step.buffer ? buffer : job };
    }
    case "changeJob": {
      const target = facts.jobs.get(anyJob(step.pick));
      const ofKind = step.plan === null || target === undefined ? null : kindChanges(step.sameKind ? target.kind : kindOfPlan[step.plan.kind], step.plan, target, step.keepsMoney);
      return {
        kind: "changeJob",
        jobId: anyJob(step.pick),
        changes: {
          ...optional("name", step.name),
          ...optional("essential", step.essential),
          ...optional("status", step.status),
          ...optional("groupId", step.group === null ? null : (at(keys(facts.groups), step.group) ?? null)),
          ...optional("ofKind", ofKind),
        },
      };
    }
    case "deleteJob":
      return { kind: "deleteJob", jobId: anyJob(step.pick) };
    case "openMonth":
      return { kind: "openMonth", month: step.next ? nextMonthToOpen(facts) : monthAt(step.monthIndex) };
    case "closeMonth":
      return { kind: "closeMonth", month: at(openMonths(facts), step.pick) ?? scriptPlanStart };
    case "reopenMonth": {
      const closed = [...facts.budgetMonths.values()].filter((b) => b.state === "closed").map((b) => b.month);
      return { kind: "reopenMonth", month: at(step.closed && closed.length > 0 ? closed : keys(facts.budgetMonths), step.pick) ?? scriptPlanStart };
    }
    case "assign":
      return { kind: "assign", month: at(openMonths(facts), step.month) ?? scriptPlanStart, jobId: anyJob(step.job), amount: step.amount };
    case "moveAssignment": {
      const m = at(openMonths(facts), step.month) ?? scriptPlanStart;
      const funded = [...facts.assignments.values()].filter((a) => a.month === m);
      const from = at(funded, step.from);
      const amount = money(Math.floor(((from?.amount ?? 0) * step.percent) / 100));
      return { kind: "moveAssignment", month: m, from: from?.jobId ?? anyJob(step.from), to: anyJob(step.to), amount };
    }
    case "addMove":
      return { kind: "addMove", move: { id: moveId(id), from: anyAccount(step.from), to: anyAccount(step.to), amount: step.amount, month: monthAt(step.monthIndex), reason: "Seed a bucket" } };
    case "setMoveStatus": {
      const toDo = [...facts.moves.values()].filter((m) => m.status === "todo").map((m) => m.id);
      const chosen = at(step.toDo && toDo.length > 0 ? toDo : keys(facts.moves), step.pick) ?? moveId(id);
      if (!step.done) return { kind: "setMoveStatus", moveId: chosen, status: "skipped" };
      return { kind: "setMoveStatus", moveId: chosen, status: "done", completedBy: step.completedBy === null ? null : (at(keys(facts.transactions), step.completedBy) ?? null) };
    }
    case "enterValue": {
      const common = { id: enteredValueId(id), asOf: step.date, source: "entered by you" };
      switch (step.what) {
        case "bufferMonths":
          return { kind: "enterValue", value: { ...common, kind: "reference", subject: "buffer-months", value: step.value % 7, unit: "months" } };
        case "override":
          return { kind: "enterValue", value: { ...common, kind: "estimateOverride", subject: overrideSubject(anyJob(step.pick), monthAt(step.monthIndex)), value: step.value, unit: "money" } };
        case "balance":
          return { kind: "enterValue", value: { ...common, kind: "accountBalance", subject: anyAccount(step.pick), value: step.value, unit: "money" } };
        case "figure":
          return { kind: "enterValue", value: { ...common, kind: "figure", subject: "gross-income", value: step.value * 10, unit: "money" } };
      }
    }
    case "recordTransaction": {
      const { amount, treatment } = treatmentFor(facts, step.treatment, step.date, step.amount);
      return { kind: "recordTransaction", transaction: { id: transactionId(id), accountId: anyAccount(step.account), bookingDate: step.date, amount, description: "Card payment", treatment } };
    }
    case "setTreatment": {
      const transaction = at([...facts.transactions.values()], step.pick);
      if (transaction === undefined) return { kind: "setTreatment", transactionId: transactionId(id), treatment: { kind: "needsYou" } };
      return { kind: "setTreatment", transactionId: transaction.id, treatment: treatmentFor(facts, step.treatment, transaction.bookingDate, transaction.amount).treatment };
    }
    case "addPerson":
      return { kind: "addPerson", person: { id: personId(id), name: step.name, kind: step.child ? "child" : "adult", ...optional("birthMonth", step.birthMonth === null ? null : monthAt(step.birthMonth)) } };
    case "changePerson":
      return {
        kind: "changePerson",
        personId: at(keys(facts.people), step.pick) ?? personId(id),
        changes: { ...optional("name", step.name), ...(step.clearBirthMonth ? { birthMonth: null } : optional("birthMonth", step.birthMonth === null ? null : monthAt(step.birthMonth))) },
      };
    case "deletePerson":
      return { kind: "deletePerson", personId: at(keys(facts.people), step.pick) ?? personId(id) };
    case "addAgreement": {
      const adults = [...facts.people.values()].filter((p) => p.kind === "adult").map((p) => p.id);
      const from = monthAt(step.fromIndex);
      return {
        kind: "addAgreement",
        agreement: {
          id: agreementId(id),
          personId: at(adults, step.person) ?? personId(id),
          accountId: at(sharedAccounts(facts), step.account) ?? accountId(id),
          amount: step.amount,
          day: step.day,
          from,
          ...optional("to", step.lastOffset === null ? null : addMonths(from, step.lastOffset)),
        },
      };
    }
    case "changeAgreement": {
      const agreement = at(keys(facts.contributionAgreements), step.pick) ?? agreementId(id);
      const from = facts.contributionAgreements.get(agreement)?.from ?? scriptPlanStart;
      return {
        kind: "changeAgreement",
        agreementId: agreement,
        changes: {
          ...optional("amount", step.amount),
          ...optional("day", step.day),
          ...optional("accountId", step.account === null ? null : (at(sharedAccounts(facts), step.account) ?? null)),
          ...(step.clearEnd ? { to: null } : optional("to", step.lastOffset === null ? null : addMonths(from, step.lastOffset))),
        },
      };
    }
    case "moveBucket": {
      const months = [...facts.budgetMonths.keys()];
      // Mostly between two different jobs that keep their money, since a transfer only fits those.
      const keeping = [...facts.jobs.values()].filter(keepsMoney).map((job) => job.id);
      const from = at(keeping, step.from) ?? anyJob(step.from);
      const to = at(
        keeping.filter((job) => job !== from),
        step.to,
      ) ?? anyJob(step.to);
      return { kind: "moveBucket", transfer: { id: bucketTransferId(id), month: at(months, step.month) ?? scriptPlanStart, from, to, amount: step.amount, reason: step.reason } };
    }
    case "changeHousehold":
      return {
        kind: "changeHousehold",
        changes: {
          ...optional("name", step.name),
          ...optional("evenOutStep", step.step === null ? null : money(step.step)),
          ...optional("currency", step.currency === null ? null : currency(step.currency)),
          ...optional("planStart", step.planStart === null ? null : monthAt(step.planStart)),
        },
      };
  }
}

export interface CommandScript {
  readonly asOf: LocalDate;
  /** A sound household, built by commands that were all accepted. */
  readonly start: Facts;
  /** The script's commands, each worked out against the facts `read` returns when its turn comes. */
  commands(read: () => Facts): Generator<Command>;
}

function startingHousehold(setup: typeof setupRecipe extends fc.Arbitrary<infer R> ? R : never, asOf: LocalDate): Facts {
  let counter = 0;
  const nextId = () => testId(++counter);
  const household: Household = { id: householdId(nextId()), name: "Test household", currency: NOK, planStart: scriptPlanStart, evenOutStep: money(5_000) };
  let facts = emptyFacts(household);
  const context: ApplyContext = { asOf };
  const run = (command: Command): void => {
    const result = apply(facts, command, context);
    if (!result.ok) throw new Error(`The script's setup was refused: ${command.kind}: ${result.refusal.message}`);
    facts = result.facts;
  };

  setup.people.forEach((child, i) => run({ kind: "addPerson", person: { id: personId(nextId()), name: `Person ${i + 1}`, kind: child ? "child" : "adult" } }));
  setup.shared.forEach((a, i) => run({ kind: "addAccount", account: { id: accountId(nextId()), name: `Shared ${i + 1}`, kind: a.kind, scope: "shared", openingBalance: a.openingBalance, openingDate: localDate("2026-02-28") } }));
  run({ kind: "addAccount", account: { id: accountId(nextId()), name: "Child", kind: "savings", scope: "paidInto", openingBalance: money(100_000), openingDate: localDate("2026-02-28") } });
  for (let i = 0; i < setup.groups; i++) run({ kind: "addGroup", group: { id: groupId(nextId()), name: `Group ${i + 1}`, order: i, countsTowardsSavingsRate: i === 0 } });
  const firstGroup = keys(facts.groups)[0] ?? groupId(testId(1));
  run({
    kind: "addJob",
    job: {
      id: jobId(nextId()),
      name: "Buffer",
      groupId: firstGroup,
      status: "active",
      accountId: at(sharedAccounts(facts), setup.buffer.account) ?? accountId(testId(1)),
      essential: false,
      opening: setup.buffer.opening,
      kind: "saveUp",
      role: "buffer",
      target: { kind: "bufferMonths", monthly: setup.buffer.monthly },
    },
  });
  for (const job of setup.jobs) run({ kind: "addJob", job: jobFrom(facts, job, nextId()) });
  for (const h of setup.history) {
    const job = h.job === null ? null : (at(keys(facts.jobs), h.job) ?? null);
    run({ kind: "recordTransaction", transaction: { id: transactionId(nextId()), accountId: at(sharedAccounts(facts), h.account) ?? accountId(testId(1)), bookingDate: h.date, amount: h.amount, description: "Earlier bill", treatment: { kind: "history", jobId: job } } });
  }
  return facts;
}

/** A script of `minSteps` (5) to `maxSteps` (40) random steps after the setup, spread over the whole range rather than kept small. */
export function arbitraryScript(options: { readonly minSteps?: number; readonly maxSteps?: number } = {}): fc.Arbitrary<CommandScript> {
  return fc
    .record({ setup: setupRecipe, steps: fc.array(stepRecipe, { minLength: options.minSteps ?? 5, maxLength: options.maxSteps ?? 40, size: "max" }), asOf: dayIn(0, 7) })
    .map(({ setup, steps, asOf }) => ({
      asOf,
      start: startingHousehold(setup, asOf),
      *commands(read: () => Facts) {
        for (const [i, step] of steps.entries()) yield commandFrom(read(), step, testId(100_000 + i));
      },
      toString: () => `script(${steps.length} steps as of ${asOf})`,
    }));
}

/** Run a script, keeping the commands the app accepted, with the facts after each. */
export function playScript(script: CommandScript): { readonly accepted: readonly { readonly command: Command; readonly facts: Facts }[]; readonly refused: number } {
  let facts = script.start;
  const accepted: { command: Command; facts: Facts }[] = [];
  let refused = 0;
  for (const command of script.commands(() => facts)) {
    const result = apply(facts, command, { asOf: script.asOf });
    if (result.ok) {
      facts = result.facts;
      accepted.push({ command, facts });
    } else refused += 1;
  }
  return { accepted, refused };
}
