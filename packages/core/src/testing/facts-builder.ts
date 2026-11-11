/**
 * Deterministic builders for Facts, for tests only. IDs come from a counter, so the same calls always
 * build the same facts. The household uses NOK and plans from January 2026 unless a test says otherwise.
 * Amounts are signed as in the facts: money out is negative.
 */

import { type LocalDate, localDate, month } from "../dates.ts";
import type {
  Account,
  AccountKind,
  BudgetMonthState,
  EnteredValueKind,
  EnteredValueUnit,
  Facts,
  Group,
  Household,
  IncomeSource,
  JobStatus,
  KeyOf,
  MoveStatus,
  PersonKind,
  RowOf,
  SaveUpTarget,
  SpendJob,
  SpendPlan,
  TableName,
  Transaction,
  Treatment,
} from "../facts.ts";
import { assignmentKey, makeSplit } from "../facts.ts";
import {
  type AccountId,
  type AgreementId,
  type BucketTransferId,
  type EnteredValueId,
  type GroupId,
  type JobId,
  type MoveId,
  type PersonId,
  type TransactionId,
  accountId,
  agreementId,
  bucketTransferId,
  enteredValueId,
  groupId,
  householdId,
  jobId,
  moveId,
  personId,
  transactionId,
} from "../ids.ts";
import { type Money, currency, fromMajor, money } from "../money.ts";

export const NOK = currency("NOK");

/** Whole kroner as minor units. */
export function kr(kroner: number): Money {
  return fromMajor(kroner, NOK);
}

export function setAmount(amount: Money): SpendPlan {
  return { mode: "setAmount", amount };
}

export function followBills(): SpendPlan {
  return { mode: "followBills" };
}

export function evenOut(monthly: Money, startMonth: string): SpendPlan {
  return { mode: "evenOut", monthly, startMonth: month(startMonth) };
}

export function amountByMonth(amount: Money, readyBy: string): SaveUpTarget {
  return { kind: "amountByMonth", amount, readyBy: month(readyBy) };
}

export function monthlySaving(amount: Money): SaveUpTarget {
  return { kind: "monthly", amount };
}

interface JobSpec {
  readonly name?: string;
  readonly groupId?: GroupId;
  readonly accountId?: AccountId;
  readonly status?: JobStatus;
  readonly essential?: boolean;
  readonly opening?: Money;
}

interface TransactionSpec {
  readonly date: string;
  readonly amount: Money;
  readonly accountId?: AccountId;
  readonly description?: string;
}

type MutableTables = { [T in TableName]: Map<KeyOf<T>, RowOf<T>> };

export interface FactsBuilder {
  readonly household: Household;
  /** The first account added, or an everyday account made on first use. Jobs and transactions use it unless told otherwise. */
  defaultAccount(): AccountId;
  account(spec?: {
    readonly name?: string;
    readonly kind?: AccountKind;
    readonly scope?: "shared" | "paidInto";
    readonly openingBalance?: Money;
    readonly openingDate?: string;
  }): AccountId;
  group(spec?: { readonly name?: string; readonly countsTowardsSavingsRate?: boolean }): GroupId;
  spendJob(spec: JobSpec & { readonly plan: SpendPlan; readonly keepsMoney?: boolean; readonly seasonality?: SpendJob["seasonality"] }): JobId;
  saveUpJob(spec: JobSpec & { readonly target: SaveUpTarget }): JobId;
  /** The household's buffer: a save-up job with the buffer role. */
  buffer(spec: JobSpec & { readonly monthly: Money }): JobId;
  payIntoJob(spec: JobSpec & { readonly monthly: Money; readonly payInto: AccountId }): JobId;
  budgetMonth(m: string, state?: BudgetMonthState): void;
  assign(m: string, job: JobId, amount: Money): void;
  /** Income that funds `fundsMonth`. A contribution unless told otherwise, and it names `agreement` only when one is given. */
  income(spec: TransactionSpec & { readonly fundsMonth: string; readonly source?: IncomeSource; readonly agreement?: AgreementId }): TransactionId;
  /** A transaction split to one job. A positive amount is a refund. */
  spend(spec: TransactionSpec & { readonly jobId: JobId }): TransactionId;
  /** A transaction split across jobs. Its amount is the sum of the allocations. */
  split(spec: Omit<TransactionSpec, "amount"> & { readonly allocations: readonly (readonly [JobId, Money])[] }): TransactionId;
  /** Both sides of a transfer between two accounts, money out of `from` and into `to`. */
  transfer(spec: { readonly from: AccountId; readonly to: AccountId; readonly date: string; readonly amount: Money }): readonly [TransactionId, TransactionId];
  /** One side of a transfer whose other side hasn't been imported yet. */
  unmatchedTransfer(spec: TransactionSpec): TransactionId;
  history(spec: TransactionSpec & { readonly jobId?: JobId }): TransactionId;
  needsYou(spec: TransactionSpec): TransactionId;
  move(spec: {
    readonly from: AccountId;
    readonly to: AccountId;
    readonly amount: Money;
    readonly month: string;
    readonly status?: MoveStatus;
    readonly reason?: string;
  }): MoveId;
  /** A member of the household. An adult unless told otherwise. */
  person(spec?: { readonly name?: string; readonly kind?: PersonKind; readonly birthMonth?: string }): PersonId;
  /** An adult's contribution agreement. It uses the first adult (made on first use), the default account, the 15th and the plan start unless told otherwise. */
  agreement(spec: {
    readonly amount: Money;
    readonly person?: PersonId;
    readonly accountId?: AccountId;
    readonly day?: number;
    readonly from?: string;
    readonly to?: string;
  }): AgreementId;
  /** Bucket money moved from one job to another in a month. The reason is "Test move" unless told otherwise. */
  bucketTransfer(spec: { readonly month: string; readonly from: JobId; readonly to: JobId; readonly amount: Money; readonly reason?: string }): BucketTransferId;
  enteredValue(spec: {
    readonly kind: EnteredValueKind;
    readonly subject: string;
    readonly value: number;
    readonly asOf: string;
    readonly unit?: EnteredValueUnit;
    readonly source?: string;
  }): EnteredValueId;
  /** A snapshot of the facts so far. Later calls on the builder don't change it. */
  facts(): Facts;
}

/** A UUIDv7-shaped ID from a counter, so test IDs sort in the order they were made. */
export function testId(n: number): string {
  return `00000000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
}

export function factsBuilder(options: { readonly planStart?: string; readonly evenOutStep?: Money } = {}): FactsBuilder {
  let counter = 0;
  const nextId = (): string => testId(++counter);

  const household: Household = {
    id: householdId(nextId()),
    name: "Test household",
    currency: NOK,
    planStart: month(options.planStart ?? "2026-01"),
    evenOutStep: options.evenOutStep ?? kr(50),
  };
  const tables: MutableTables = {
    household: new Map([[household.id, household]]),
    accounts: new Map(),
    groups: new Map(),
    jobs: new Map(),
    budgetMonths: new Map(),
    assignments: new Map(),
    transactions: new Map(),
    moves: new Map(),
    enteredValues: new Map(),
    importBatches: new Map(),
    importRows: new Map(),
    rules: new Map(),
    people: new Map(),
    contributionAgreements: new Map(),
    bucketTransfers: new Map(),
  };

  let firstAccount: AccountId | undefined;
  let firstGroup: GroupId | undefined;
  let firstAdult: PersonId | undefined;

  const account: FactsBuilder["account"] = (spec = {}) => {
    const row: Account = {
      id: accountId(nextId()),
      name: spec.name ?? `Account ${tables.accounts.size + 1}`,
      kind: spec.kind ?? "everyday",
      scope: spec.scope ?? "shared",
      openingBalance: spec.openingBalance ?? money(0),
      openingDate: localDate(spec.openingDate ?? "2025-12-31"),
    };
    tables.accounts.set(row.id, row);
    firstAccount ??= row.id;
    return row.id;
  };
  const defaultAccount = (): AccountId => firstAccount ?? account({ name: "Everyday" });

  const group: FactsBuilder["group"] = (spec = {}) => {
    const row: Group = {
      id: groupId(nextId()),
      name: spec.name ?? `Group ${tables.groups.size + 1}`,
      order: tables.groups.size,
      countsTowardsSavingsRate: spec.countsTowardsSavingsRate ?? false,
    };
    tables.groups.set(row.id, row);
    firstGroup ??= row.id;
    return row.id;
  };

  const person: FactsBuilder["person"] = (spec = {}) => {
    const kind = spec.kind ?? "adult";
    const id = personId(nextId());
    tables.people.set(id, { id, name: spec.name ?? `Person ${tables.people.size + 1}`, kind, ...(spec.birthMonth === undefined ? {} : { birthMonth: month(spec.birthMonth) }) });
    if (kind === "adult") firstAdult ??= id;
    return id;
  };

  const jobBase = (spec: JobSpec) => ({
    id: jobId(nextId()),
    name: spec.name ?? `Job ${tables.jobs.size + 1}`,
    groupId: spec.groupId ?? firstGroup ?? group({ name: "Living" }),
    status: spec.status ?? "active",
    accountId: spec.accountId ?? defaultAccount(),
    essential: spec.essential ?? false,
    opening: spec.opening ?? money(0),
  });

  const addTransaction = (spec: Omit<TransactionSpec, "amount"> & { readonly amount: Money }, treatment: Treatment): TransactionId => {
    const row: Transaction = {
      id: transactionId(nextId()),
      accountId: spec.accountId ?? defaultAccount(),
      bookingDate: localDate(spec.date),
      amount: spec.amount,
      description: spec.description ?? treatment.kind,
      treatment,
    };
    tables.transactions.set(row.id, row);
    return row.id;
  };

  return {
    household,
    defaultAccount,
    account,
    group,
    spendJob: (spec) => {
      const row: SpendJob = {
        ...jobBase(spec),
        kind: "spend",
        keepsMoney: spec.keepsMoney ?? spec.plan.mode === "evenOut",
        plan: spec.plan,
        seasonality: spec.seasonality ?? "irregular",
      };
      tables.jobs.set(row.id, row);
      return row.id;
    },
    saveUpJob: (spec) => {
      const row = { ...jobBase(spec), kind: "saveUp", role: "ordinary", target: spec.target } as const;
      tables.jobs.set(row.id, row);
      return row.id;
    },
    buffer: (spec) => {
      const row = { ...jobBase({ name: "Buffer", ...spec }), kind: "saveUp", role: "buffer", target: { kind: "bufferMonths", monthly: spec.monthly } } as const;
      tables.jobs.set(row.id, row);
      return row.id;
    },
    payIntoJob: (spec) => {
      const row = { ...jobBase(spec), kind: "payInto", monthly: spec.monthly, payInto: spec.payInto } as const;
      tables.jobs.set(row.id, row);
      return row.id;
    },
    budgetMonth: (m, state = "open") => {
      tables.budgetMonths.set(month(m), { month: month(m), state });
    },
    assign: (m, job, amount) => {
      tables.assignments.set(assignmentKey(month(m), job), { month: month(m), jobId: job, amount });
    },
    income: (spec) =>
      addTransaction(spec, {
        kind: "income",
        fundsMonth: month(spec.fundsMonth),
        source: spec.source ?? "contribution",
        ...(spec.agreement === undefined ? {} : { agreement: spec.agreement }),
      }),
    spend: (spec) => addTransaction(spec, makeSplit(spec.amount, [{ jobId: spec.jobId, amount: spec.amount }])),
    split: (spec) => {
      const allocations = spec.allocations.map(([job, amount]) => ({ jobId: job, amount }));
      const amount = money(allocations.reduce((sum, a) => sum + a.amount, 0));
      return addTransaction({ ...spec, amount }, makeSplit(amount, allocations));
    },
    transfer: (spec) => {
      const outId = transactionId(nextId());
      const inId = transactionId(nextId());
      const date: LocalDate = localDate(spec.date);
      tables.transactions.set(outId, { id: outId, accountId: spec.from, bookingDate: date, amount: money(-spec.amount), description: "transfer", treatment: { kind: "transfer", partner: inId } });
      tables.transactions.set(inId, { id: inId, accountId: spec.to, bookingDate: date, amount: spec.amount, description: "transfer", treatment: { kind: "transfer", partner: outId } });
      return [outId, inId];
    },
    unmatchedTransfer: (spec) => addTransaction(spec, { kind: "transfer", partner: null }),
    history: (spec) => addTransaction(spec, { kind: "history", jobId: spec.jobId ?? null }),
    needsYou: (spec) => addTransaction(spec, { kind: "needsYou" }),
    move: (spec) => {
      const id = moveId(nextId());
      tables.moves.set(id, {
        id,
        from: spec.from,
        to: spec.to,
        amount: spec.amount,
        month: month(spec.month),
        reason: spec.reason ?? "test move",
        status: spec.status ?? "todo",
        completedBy: null,
      });
      return id;
    },
    person,
    agreement: (spec) => {
      const id = agreementId(nextId());
      tables.contributionAgreements.set(id, {
        id,
        personId: spec.person ?? firstAdult ?? person({ name: "Adult" }),
        accountId: spec.accountId ?? defaultAccount(),
        amount: spec.amount,
        day: spec.day ?? 15,
        from: month(spec.from ?? household.planStart),
        ...(spec.to === undefined ? {} : { to: month(spec.to) }),
      });
      return id;
    },
    bucketTransfer: (spec) => {
      const id = bucketTransferId(nextId());
      tables.bucketTransfers.set(id, { id, month: month(spec.month), from: spec.from, to: spec.to, amount: spec.amount, reason: spec.reason ?? "Test move" });
      return id;
    },
    enteredValue: (spec) => {
      const id = enteredValueId(nextId());
      tables.enteredValues.set(id, {
        id,
        kind: spec.kind,
        subject: spec.subject,
        value: spec.value,
        unit: spec.unit ?? "money",
        asOf: localDate(spec.asOf),
        source: spec.source ?? "test",
      });
      return id;
    },
    facts: () => ({
      household: new Map(tables.household),
      accounts: new Map(tables.accounts),
      groups: new Map(tables.groups),
      jobs: new Map(tables.jobs),
      budgetMonths: new Map(tables.budgetMonths),
      assignments: new Map(tables.assignments),
      transactions: new Map(tables.transactions),
      moves: new Map(tables.moves),
      enteredValues: new Map(tables.enteredValues),
      importBatches: new Map(tables.importBatches),
      importRows: new Map(tables.importRows),
      rules: new Map(tables.rules),
      people: new Map(tables.people),
      contributionAgreements: new Map(tables.contributionAgreements),
      bucketTransfers: new Map(tables.bucketTransfers),
    }),
  };
}
