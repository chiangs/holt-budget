/**
 * The facts Holt stores (domain model, "Facts and figures"). Everything else is a figure that
 * `computeFigures` works out from these. Facts are plain immutable data, held in one table per kind
 * of row, so a change can be described as a list of rows before and after (see `patch.ts`) and undone.
 *
 * What is not here, on purpose: buckets, unassigned money, estimates, balances and monthly moves at the
 * bank. They are figures. Recurring series arrive with the
 * milestones that need them. Import batches, import rows and rules arrived with Milestone 3, and people,
 * contribution agreements and bucket transfers with Milestone 4.
 */

import type { AccountNumber } from "./account-number.ts";
import type { LocalDate, Month } from "./dates.ts";
import type {
  AccountId,
  AgreementId,
  BucketTransferId,
  EnteredValueId,
  GroupId,
  HouseholdId,
  Id,
  ImportBatchId,
  ImportRowId,
  JobId,
  MoveId,
  PersonId,
  RuleId,
  TransactionId,
} from "./ids.ts";
import { type Currency, type Money, MoneyError } from "./money.ts";

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface Household {
  readonly id: HouseholdId;
  readonly name: string;
  readonly currency: Currency;
  /** The first month Holt plans. Earlier transactions are history (decision 10), except income that funds a month from the plan start on. */
  readonly planStart: Month;
  /** The rounding for evened-out amounts: 50 whole units of the currency by default (decision 6). */
  readonly evenOutStep: Money;
}

export type AccountKind = "everyday" | "bills" | "savings" | "loan";

/** How often the family imports this account (domain model, "Account"). Its "up to date" status follows it. */
export type ImportRhythm = "weekly" | "fortnightly" | "monthly";

export interface Account {
  readonly id: AccountId;
  readonly name: string;
  readonly kind: AccountKind;
  /** Shared accounts are imported and fully tracked. Paid-into accounts (a child's savings) are tracked by deposits. */
  readonly scope: "shared" | "paidInto";
  readonly openingBalance: Money;
  readonly openingDate: LocalDate;
  /** The bank's number, so an imported row finds its account. Absent for an account that isn't imported. */
  readonly number?: AccountNumber;
  /** Absent means monthly. */
  readonly importRhythm?: ImportRhythm;
}

export interface Group {
  readonly id: GroupId;
  readonly name: string;
  readonly order: number;
  readonly countsTowardsSavingsRate: boolean;
}

export type JobStatus = "active" | "paused" | "finished" | "archived";

/** How a spend job is planned (decision 12). */
export type SpendPlan =
  | { readonly mode: "setAmount"; readonly amount: Money }
  | { readonly mode: "followBills" }
  | {
      readonly mode: "evenOut";
      /** The same amount every month once evening out has started. */
      readonly monthly: Money;
      /** Months before this one follow the bills. */
      readonly startMonth: Month;
    };

export type SaveUpTarget =
  | { readonly kind: "amountByMonth"; readonly amount: Money; readonly readyBy: Month }
  | { readonly kind: "monthly"; readonly amount: Money }
  /** The buffer's target follows the plan (buffer months × the monthly total of essential jobs). The family sets what it saves each month. */
  | { readonly kind: "bufferMonths"; readonly monthly: Money };

interface JobBase {
  readonly id: JobId;
  readonly name: string;
  readonly groupId: GroupId;
  readonly status: JobStatus;
  /** The account where the job's money sits. For a spend job, the account its bills are paid from. */
  readonly accountId: AccountId;
  /** Whether the job is needed to keep the household running. Essential jobs set the buffer's target and the runway. */
  readonly essential: boolean;
  /** The bucket's balance at the plan start, from Setup (decision 10). Zero for a job created later. */
  readonly opening: Money;
}

export interface SpendJob extends JobBase {
  readonly kind: "spend";
  /** Whether money left at month end stays with the job. Always true when evened out. */
  readonly keepsMoney: boolean;
  readonly plan: SpendPlan;
  /** Whether the cost follows the seasons. "auto" lets the app detect it from the history, and the family can overrule it. */
  readonly seasonality: "auto" | "seasonal" | "irregular";
}

export interface SaveUpJob extends JobBase {
  readonly kind: "saveUp";
  /** The buffer is a save-up job with a fixed role. There is exactly one per household. */
  readonly role: "buffer" | "ordinary";
  readonly target: SaveUpTarget;
}

export interface PayIntoJob extends JobBase {
  readonly kind: "payInto";
  /** The monthly amount paid into another account, for example a child's savings. */
  readonly monthly: Money;
  readonly payInto: AccountId;
}

export type Job = SpendJob | SaveUpJob | PayIntoJob;

/** A month the family has started or finished assigning. A month with no row is planned, and one before the plan start is history. */
export type BudgetMonthState = "open" | "closed" | "reopened";

export interface BudgetMonth {
  readonly month: Month;
  readonly state: BudgetMonthState;
}

/** The plan for one job in one open, closed or reopened month. */
export interface Assignment {
  readonly month: Month;
  readonly jobId: JobId;
  readonly amount: Money;
}

declare const splitBrand: unique symbol;

/** The share of a transaction that counts against one job. Same sign as the transaction: money out is negative. */
export interface Allocation {
  readonly jobId: JobId;
  readonly amount: Money;
}

/** A split can only be built by `makeSplit`, which checks that the allocations add up to the transaction. */
export interface Split {
  readonly kind: "split";
  readonly allocations: readonly [Allocation, ...Allocation[]];
  readonly [splitBrand]: true;
}

export type IncomeSource = "contribution" | "recurring" | "other";

/** Exactly one treatment per transaction (domain model, "Transaction"). A transfer has no allocations by construction. */
export type Treatment =
  | { readonly kind: "needsYou" }
  /** Income funds one month, usually the next (decision 1). `agreement` names the contribution agreement it pays, and only a contribution has one. */
  | { readonly kind: "income"; readonly fundsMonth: Month; readonly source: IncomeSource; readonly agreement?: AgreementId }
  | { readonly kind: "transfer"; readonly partner: TransactionId | null }
  | Split
  /** Before the plan start. It may carry a job so the estimates can use it. */
  | { readonly kind: "history"; readonly jobId: JobId | null };

export interface Transaction {
  readonly id: TransactionId;
  readonly accountId: AccountId;
  /** The booking date decides which month a transaction counts in. */
  readonly bookingDate: LocalDate;
  /** Negative means money out. */
  readonly amount: Money;
  readonly description: string;
  readonly treatment: Treatment;
  /** The cleaned-up name of the other party (domain model, "Who"). */
  readonly counterparty?: string;
  /** The date of the purchase, when the bank gives one that differs from the booking date. */
  readonly transactionDate?: LocalDate;
  /** The bank's payment reference (KID). It is not unique to one payment, so matching never relies on it alone. */
  readonly reference?: string;
  readonly note?: string;
  /** The rule that gave this transaction its treatment on import, so the screen can say which rule applied. */
  readonly ruleId?: RuleId;
}

export type MoveStatus = "todo" | "done" | "skipped";

/** A one-off transfer the plan needs the family to make at the bank (decision 11). Monthly moves are figures. */
export interface Move {
  readonly id: MoveId;
  readonly from: AccountId;
  readonly to: AccountId;
  readonly amount: Money;
  readonly month: Month;
  readonly reason: string;
  readonly status: MoveStatus;
  /** The imported transfer that completed it, when one did. */
  readonly completedBy: TransactionId | null;
}

export type EnteredValueKind = "reference" | "figure" | "asset" | "accountBalance" | "estimateOverride";
export type EnteredValueUnit = "money" | "months" | "percent" | "count";

/**
 * Reference settings, figures you entered, asset values, balances of accounts the household pays into,
 * and estimate overrides are all stored the same way. A change adds a row, so every past value is kept.
 * What the subject is depends on the kind: a setting's key, an account's ID, an asset's name, or
 * "<job ID>/<month>" for an estimate override.
 */
export interface EnteredValue {
  readonly id: EnteredValueId;
  readonly kind: EnteredValueKind;
  readonly subject: string;
  readonly value: number;
  readonly unit: EnteredValueUnit;
  readonly asOf: LocalDate;
  readonly source: string;
}

/**
 * One imported file (domain model, "Import batch"). The rows it read are `ImportRow`s. Undoing an import
 * marks the batch `undone` and releases its rows; it never deletes them, so the history of imports stays whole.
 */
export interface ImportBatch {
  readonly id: ImportBatchId;
  readonly fileName: string;
  /** SHA-256 of the file's bytes, in hex. A file whose fingerprint matches a live batch adds nothing. */
  readonly fingerprint: string;
  /** The format profile that read the file. Formats are code, so this is an ID such as "bulder-csv". */
  readonly format: string;
  /** ISO datetime, from the caller. */
  readonly importedAt: string;
  /** The first and last booking dates in the file. */
  readonly from: LocalDate;
  readonly to: LocalDate;
  /** What the import did, counted when it ran. */
  readonly rows: number;
  readonly created: number;
  readonly matched: number;
  readonly pending: number;
  readonly undone: boolean;
}

/** One row of an imported file, kept as the file had it (domain model, "Import row"). */
export interface ImportRow {
  readonly id: ImportRowId;
  readonly batchId: ImportBatchId;
  /** The 1-based line in the file. */
  readonly line: number;
  readonly accountId: AccountId;
  readonly bookingDate: LocalDate;
  readonly interestDate?: LocalDate;
  readonly description: string;
  /** Negative means money out of the account. */
  readonly amount: Money;
  /** The other account's number, as 11 digits, when the bank gives one. */
  readonly counterpartAccount?: string;
  readonly counterpartName?: string;
  readonly reference?: string;
  readonly bankType?: string;
  readonly original?: { readonly text: string; readonly currency: string };
  /** What identifies the row for matching: account, amount, booking date and description. Equal rows have equal fingerprints. */
  readonly fingerprint: string;
  /** A pending ("reservert") row backs no transaction until a later file books it. */
  readonly pending: boolean;
  /** The transaction this row backs. A row backs at most one, and several rows can back the same one when files overlap. */
  readonly backs: TransactionId | null;
}

/** What a rule decides: one job, or a split by integer weights, rounded by largest remainder with the first share winning ties. */
export type RuleResult =
  | { readonly kind: "job"; readonly jobId: JobId }
  | { readonly kind: "split"; readonly shares: readonly [RuleShare, ...RuleShare[]] };

export interface RuleShare {
  readonly jobId: JobId;
  /** A positive whole number. Shares of 2 and 1 split an amount two thirds to one third. */
  readonly weight: number;
}

/** When a rule applies (domain model, "Categorisation rule"). Every field present must match. */
export interface RuleMatch {
  /** Compared with the transaction's cleaned counterparty, ignoring case. */
  readonly counterparty: string;
  readonly accountId?: AccountId;
  /** Inclusive bounds on the signed amount, so money out is negative. */
  readonly min?: Money;
  readonly max?: Money;
}

export type RuleOrigin = "set" | "learned" | "accepted";

/** "Always do this". Rules run first and give the same result every time; the highest priority wins. */
export interface Rule {
  readonly id: RuleId;
  readonly match: RuleMatch;
  readonly result: RuleResult;
  readonly origin: RuleOrigin;
  readonly priority: number;
}

export type PersonKind = "adult" | "child";

/** Someone in the household (domain model, "Person"). A child's birth month feeds the children's timeline. */
export interface Person {
  readonly id: PersonId;
  readonly name: string;
  readonly kind: PersonKind;
  readonly birthMonth?: Month;
}

/**
 * What an adult pays into a shared account each month (domain model, "Contribution agreement"). The money
 * is expected on `day` of the month before the month it funds. A change of amount is a new agreement from a
 * later month, so the history stays.
 */
export interface ContributionAgreement {
  readonly id: AgreementId;
  readonly personId: PersonId;
  readonly accountId: AccountId;
  readonly amount: Money;
  /** The day of the month the money usually lands, 1 to 28. */
  readonly day: number;
  /** The first month it funds. */
  readonly from: Month;
  /** The last month it funds. Absent while the agreement runs. */
  readonly to?: Month;
}

/**
 * Money a bucket gives to another bucket in a month (0048). The buckets move by the amount and nothing else
 * does: a transfer is neither spending nor income, so unassigned money and every balance stay as they were.
 */
export interface BucketTransfer {
  readonly id: BucketTransferId;
  readonly month: Month;
  readonly from: JobId;
  readonly to: JobId;
  readonly amount: Money;
  /** Why, in the family's words. Required when the money leaves the buffer. */
  readonly reason: string;
}

// ── Tables ───────────────────────────────────────────────────────────────────

/** An assignment is identified by its month and job together. */
export type AssignmentKey = Id<"assignment">;

export function assignmentKey(m: Month, job: JobId): AssignmentKey {
  return `${m}/${job}` as AssignmentKey;
}

export function overrideSubject(job: JobId, m: Month): string {
  return `${job}/${m}`;
}

/** The kinds of row, with the type of each row and of the key it is stored under. One registry, so a table cannot exist in one place only. */
export interface TableTypes {
  readonly household: { readonly key: HouseholdId; readonly row: Household };
  readonly accounts: { readonly key: AccountId; readonly row: Account };
  readonly groups: { readonly key: GroupId; readonly row: Group };
  readonly jobs: { readonly key: JobId; readonly row: Job };
  readonly budgetMonths: { readonly key: Month; readonly row: BudgetMonth };
  readonly assignments: { readonly key: AssignmentKey; readonly row: Assignment };
  readonly transactions: { readonly key: TransactionId; readonly row: Transaction };
  readonly moves: { readonly key: MoveId; readonly row: Move };
  readonly enteredValues: { readonly key: EnteredValueId; readonly row: EnteredValue };
  readonly importBatches: { readonly key: ImportBatchId; readonly row: ImportBatch };
  readonly importRows: { readonly key: ImportRowId; readonly row: ImportRow };
  readonly rules: { readonly key: RuleId; readonly row: Rule };
  readonly people: { readonly key: PersonId; readonly row: Person };
  readonly contributionAgreements: { readonly key: AgreementId; readonly row: ContributionAgreement };
  readonly bucketTransfers: { readonly key: BucketTransferId; readonly row: BucketTransfer };
}

export type TableName = keyof TableTypes;
export type KeyOf<T extends TableName> = TableTypes[T]["key"];
export type RowOf<T extends TableName> = TableTypes[T]["row"];

export const tableNames = [
  "household",
  "accounts",
  "groups",
  "jobs",
  "budgetMonths",
  "assignments",
  "transactions",
  "moves",
  "enteredValues",
  "importBatches",
  "importRows",
  "rules",
  "people",
  "contributionAgreements",
  "bucketTransfers",
] as const satisfies readonly TableName[];

export type Table<T extends TableName> = ReadonlyMap<KeyOf<T>, RowOf<T>>;

export type Facts = { readonly [T in TableName]: Table<T> };

export function emptyFacts(household: Household): Facts {
  return {
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
}

/** The household row. There is exactly one. */
export function householdOf(facts: Facts): Household {
  for (const row of facts.household.values()) return row;
  throw new Error("Facts hold no household");
}

/** The row's key, so a patch can name it. */
export function keyOfRow<T extends TableName>(table: T, row: RowOf<T>): KeyOf<T> {
  const r = row as RowOf<TableName>;
  switch (table) {
    case "budgetMonths":
      return (r as BudgetMonth).month as KeyOf<T>;
    case "assignments":
      return assignmentKey((r as Assignment).month, (r as Assignment).jobId) as KeyOf<T>;
    default:
      return (r as { id: KeyOf<T> }).id;
  }
}

// ── Splits ───────────────────────────────────────────────────────────────────

/** Build a split. Throws unless there is at least one allocation and they add up to `total` exactly (rule 3). */
export function makeSplit(total: Money, allocations: readonly Allocation[]): Split {
  const [first, ...rest] = allocations;
  if (first === undefined) throw new MoneyError("A split needs at least one allocation");
  const sum = allocations.reduce((s, a) => s + a.amount, 0);
  if (sum !== total) throw new MoneyError(`The allocations add up to ${sum}, not ${total}`);
  return { kind: "split", allocations: [first, ...rest] } as unknown as Split;
}
