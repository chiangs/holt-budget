/**
 * From a parsed bank file to one change (decision 0047, Part 2, "planImport"). Pure: the caller passes the
 * time, the IDs and the balances the family typed. The result is a preview for the screen and the one
 * `batch` command that does exactly what the preview says, or the reason the file can't be imported.
 */

import type { AccountNumber } from "../account-number.ts";
import { type BatchCommand, type Command, apply } from "../commands/apply.ts";
import { type TreatmentInput, treatmentFor } from "../commands/transactions.ts";
import { type LocalDate, monthOf } from "../dates.ts";
import { type Account, type Facts, type ImportBatch, type ImportRow, type Transaction, type Treatment, householdOf } from "../facts.ts";
import { type AccountId, type EnteredValueId, type ImportBatchId, type ImportRowId, type JobId, type MoveId, type RuleId, type TransactionId, transactionId } from "../ids.ts";
import type { Currency, Money } from "../money.ts";
import { resolveRule, treatmentOfRule } from "../rules/resolve.ts";
import { type BalanceCheck, balanceCheck } from "./balance.ts";
import { compareIds, matchKey, matchRows } from "./matching.ts";
import { nearIndex, oneDayApart } from "./near-matches.ts";
import type { StatementFile, StatementRow } from "./statement.ts";
import { type Hint, historyHints } from "./suggest.ts";
import { type TransferSide, uniquePairs, unpairedSides } from "./transfers.ts";

/** Core makes no IDs, so the caller supplies them. The plan asks in a fixed order, so the same input gives the same plan. */
export interface ImportIds {
  batch(): ImportBatchId;
  /** One per row of a household account, in file order. A row that creates a transaction gives it its ID. */
  row(): ImportRowId;
  /** One per typed balance, in order. */
  enteredValue(): EnteredValueId;
}

/** The balance the family read at the bank for one account, on a date. */
export interface TypedBalance {
  readonly accountId: AccountId;
  readonly value: Money;
  readonly asOf: LocalDate;
}

/** What you chose for the new transaction made from one line of the file. Only a job (a split that adds up) or needs you can be chosen here. */
export interface ImportChoice {
  /** The line of the file, as in `StatementRow.line`. */
  readonly line: number;
  readonly treatment: TreatmentInput;
}

export interface ImportInput {
  readonly fileName: string;
  /** SHA-256 of the file's bytes, in hex. */
  readonly fingerprint: string;
  /** ISO datetime. */
  readonly importedAt: string;
  /** May be empty: an account with no typed balance is not checked. */
  readonly balances: readonly TypedBalance[];
  /** Today. */
  readonly asOf: LocalDate;
  readonly ids: ImportIds;
  /**
   * The treatments the family chose in the preview. A choice wins over a rule and over a suggestion. A choice
   * for a line that makes no transaction, or for a line before the plan start that is not a single job, is ignored
   * and listed in `ignoredChoices`. A choice the app can't give refuses the whole import. Two choices for one line: the later wins.
   */
  readonly choices?: readonly ImportChoice[];
  /** Whether a new transaction from the plan start on with no rule gets the treatment of the last one from the same counterparty. Default true. When false it waits in needs you. */
  readonly suggest?: boolean;
}

/** Rows for an account number the household doesn't have. They are left out, so the family can add the account and import again. */
export interface LeftOutAccount {
  readonly account: AccountNumber;
  readonly accountName?: string;
  readonly rows: number;
}

export type ImportBlock =
  /** A live import has this fingerprint. An undone one doesn't count. */
  | { readonly kind: "duplicateFile"; readonly batchId: ImportBatchId }
  /** The file's currency isn't the household's. The app read no rows. */
  | { readonly kind: "wrongCurrency"; readonly file: Currency; readonly household: Currency }
  | { readonly kind: "noRows" }
  /** Every row belongs to an account number the household doesn't have. */
  | { readonly kind: "noKnownAccounts"; readonly leftOut: readonly LeftOutAccount[] }
  /** The choice for this line can't be given: its split doesn't add up, it names a job the household doesn't have, or it is income, a transfer or history. */
  | { readonly kind: "badChoice"; readonly line: number };

/** Why a new transaction has its treatment, as data. The screen finds the words. */
export type Why =
  /** You chose it. Before the plan start, a single job you chose becomes the history job. */
  | { readonly kind: "chosen" }
  /** A rule you set applied. */
  | { readonly kind: "rule"; readonly ruleId: RuleId }
  /** Same job or split as `from`, the latest earlier transaction from this counterparty. `times` is how many in an unbroken run, latest first, went the same way. */
  | { readonly kind: "sameAsLast"; readonly from: TransactionId; readonly times: number }
  /** As `sameAsLast`, and the amount changed after at least two equal ones. `from` is the earlier amount. */
  | { readonly kind: "priceChange"; readonly from: Money }
  /** Paired with a transaction in another account as the two sides of a transfer. */
  | { readonly kind: "transferMatch"; readonly partner: TransactionId }
  /** It may duplicate a transaction booked a day apart, so it waits in needs you whatever a rule says. */
  | { readonly kind: "nearMatch"; readonly of: TransactionId }
  /** The last two from this counterparty went to different jobs. At most 3, latest first. It waits in needs you. */
  | { readonly kind: "ambiguous"; readonly jobs: readonly JobId[] }
  /** Nothing else of this counterparty is booked before it. It waits in needs you. */
  | { readonly kind: "firstPayment" }
  /** Booked before the plan start. A rule that gives one job gives it that job for the estimates. */
  | { readonly kind: "history" }
  /** Nothing to go on, so it waits in needs you. */
  | { readonly kind: "none" };

export interface NewTransactionLine {
  readonly transactionId: TransactionId;
  readonly line: number;
  readonly accountId: AccountId;
  readonly bookingDate: LocalDate;
  readonly amount: Money;
  readonly description: string;
  readonly counterparty?: string;
  readonly treatment: Treatment;
  readonly why: Why;
}

/** `rows` = `created` + `matched` + `pending` + `leftOut`, and `created` = `history` + `byRule` + `suggested` + `chosen` + `transfers` + `needsYou`. */
export interface ImportCounts {
  /** Every row in the file. */
  readonly rows: number;
  /** Rows that create a transaction. */
  readonly created: number;
  /** Rows that back a transaction already there and create nothing. */
  readonly matched: number;
  /** Pending rows, kept and backing nothing. */
  readonly pending: number;
  readonly leftOut: number;
  /** New transactions booked before the plan start. */
  readonly history: number;
  readonly byRule: number;
  /** New transactions that got the treatment of the last one from the same counterparty. */
  readonly suggested: number;
  /** New transactions you chose a job for, from the plan start on. */
  readonly chosen: number;
  /** New transactions paired as transfers. */
  readonly transfers: number;
  /** New transactions that wait in needs you, near matches and ones you chose to leave there included. */
  readonly needsYou: number;
}

export interface ImportAccountLine {
  readonly accountId: AccountId;
  readonly rows: number;
  readonly created: number;
  readonly matched: number;
  readonly pending: number;
  readonly balance: BalanceCheck;
}

export interface ImportNearMatch {
  readonly transactionId: TransactionId;
  readonly line: number;
  readonly of: TransactionId;
}

export interface ImportTransfer {
  /** The side money left. */
  readonly outgoing: TransactionId;
  readonly incoming: TransactionId;
  /** The move at the bank this pair marks done. */
  readonly completesMove: MoveId | null;
}

export const previewSampleSize = 50;

/** Plain data only, because it crosses the bridge. */
export interface ImportPreview {
  readonly batchId: ImportBatchId;
  readonly fileName: string;
  readonly format: string;
  /** The first and last booking dates among the rows of household accounts. */
  readonly from: LocalDate;
  readonly to: LocalDate;
  readonly counts: ImportCounts;
  /** Each account the file has rows for, in the order the file first names it, then any other account with a typed balance. */
  readonly accounts: readonly ImportAccountLine[];
  readonly leftOut: readonly LeftOutAccount[];
  readonly nearMatches: readonly ImportNearMatch[];
  readonly transfers: readonly ImportTransfer[];
  readonly completedMoves: readonly MoveId[];
  /** Lines of `choices` that gave no transaction its treatment, in line order. */
  readonly ignoredChoices: readonly number[];
  /** At most `previewSampleSize` new transactions: those that need attention first (needs you, near matches, first payments, price changes), then the rest, each group by booking date. */
  readonly sample: readonly NewTransactionLine[];
}

export type ImportPlan =
  | { readonly ok: true; readonly preview: ImportPreview; readonly command: BatchCommand }
  | { readonly ok: false; readonly blocked: ImportBlock };

type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

function defined<T extends object>(fields: T): Defined<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Defined<T>;
}

interface Fresh {
  readonly row: StatementRow;
  readonly account: Account;
  readonly transaction: Transaction;
}

interface NewTransaction extends Fresh {
  readonly why: Why;
}

interface AccountTally {
  rows: number;
  created: number;
  matched: number;
  pending: number;
}

function leftOutList(rows: readonly StatementRow[]): LeftOutAccount[] {
  const byNumber = new Map<AccountNumber, { account: AccountNumber; accountName?: string; rows: number }>();
  for (const row of rows) {
    const entry = byNumber.get(row.account) ?? { account: row.account, rows: 0 };
    entry.rows += 1;
    if (entry.accountName === undefined && row.accountName !== undefined) entry.accountName = row.accountName;
    byNumber.set(row.account, entry);
  }
  return [...byNumber.values()];
}

/** What a choice gives a transaction, or null when the app can't give it. */
function chosenTreatment(facts: Facts, input: TreatmentInput, amount: Money): Treatment | null {
  if (input.kind === "needsYou") return { kind: "needsYou" };
  if (input.kind !== "split" || input.allocations.some((a) => !facts.jobs.has(a.jobId))) return null;
  return treatmentFor(input, amount);
}

/** The one job a choice names, for a transaction from before the plan start. */
function singleJob(treatment: Treatment): JobId | null {
  if (treatment.kind !== "split") return null;
  const [only, ...more] = treatment.allocations;
  return more.length === 0 ? only.jobId : null;
}

type Decision = { readonly ok: true; readonly decided: NewTransaction[]; readonly ignoredChoices: number[] } | { readonly ok: false; readonly line: number };

/**
 * Before the plan start a transaction is history, with the job you chose if that is one job, else the job
 * of a rule that gives one. From the plan start on, in order: what you chose; a near match, which waits in
 * needs you so you see the possible duplicate; the best rule; the treatment of the last transaction from the
 * same counterparty (unless `suggest` is off); and else needs you.
 */
function decide(facts: Facts, created: readonly Fresh[], backedHere: ReadonlySet<TransactionId>, choices: ReadonlyMap<number, ImportChoice>, suggest: boolean): Decision {
  const { planStart } = householdOf(facts);
  const near = nearIndex(facts.transactions.values());
  const rules = [...facts.rules.values()];
  const hintFor = historyHints(facts.transactions, created.map((entry) => entry.transaction));
  const used = new Set<number>();
  const decided: NewTransaction[] = [];
  for (const entry of created) {
    const { row, account, transaction } = entry;
    const choice = choices.get(row.line);
    const chosen = choice === undefined ? null : chosenTreatment(facts, choice.treatment, row.amount);
    if (choice !== undefined && chosen === null) return { ok: false, line: row.line };
    const rule = resolveRule(rules, { accountId: account.id, counterparty: row.counterparty, amount: row.amount });
    if (monthOf(row.bookingDate) < planStart) {
      const chosenJob = chosen === null ? null : singleJob(chosen);
      if (chosenJob !== null) {
        used.add(row.line);
        decided.push({ ...entry, transaction: { ...transaction, treatment: { kind: "history", jobId: chosenJob } }, why: { kind: "chosen" } });
      } else if (rule?.result.kind === "job") {
        decided.push({ ...entry, transaction: { ...transaction, treatment: { kind: "history", jobId: rule.result.jobId }, ruleId: rule.id }, why: { kind: "history" } });
      } else decided.push({ ...entry, transaction: { ...transaction, treatment: { kind: "history", jobId: null } }, why: { kind: "history" } });
      continue;
    }
    if (chosen !== null) {
      used.add(row.line);
      decided.push({ ...entry, transaction: { ...transaction, treatment: chosen }, why: { kind: "chosen" } });
      continue;
    }
    const [of] = oneDayApart(near, transaction)
      .filter((t) => !backedHere.has(t.id))
      .map((t) => t.id)
      .sort(compareIds);
    if (of !== undefined) {
      decided.push({ ...entry, why: { kind: "nearMatch", of } });
      continue;
    }
    const ruled = rule === null ? null : treatmentFor(treatmentOfRule(rule, row.amount), row.amount);
    if (rule !== null && ruled !== null) {
      decided.push({ ...entry, transaction: { ...transaction, treatment: ruled, ruleId: rule.id }, why: { kind: "rule", ruleId: rule.id } });
      continue;
    }
    decided.push(viaHistory(entry, hintFor(transaction), suggest));
  }
  const ignoredChoices = [...choices.keys()].filter((line) => !used.has(line)).sort((a, b) => a - b);
  return { ok: true, decided, ignoredChoices };
}

/** A row with no choice, near match or rule takes what its counterparty's history gives, or waits. */
function viaHistory(entry: Fresh, hint: Hint, suggest: boolean): NewTransaction {
  const { transaction } = entry;
  switch (hint.kind) {
    case "last": {
      const treatment = suggest ? treatmentFor(hint.treatment, transaction.amount) : null;
      if (treatment === null) return { ...entry, why: { kind: "none" } };
      const why: Why = hint.earlierAmount === null ? { kind: "sameAsLast", from: hint.from, times: hint.times } : { kind: "priceChange", from: hint.earlierAmount };
      return { ...entry, transaction: { ...transaction, treatment }, why };
    }
    case "ambiguous":
      return { ...entry, why: { kind: "ambiguous", jobs: hint.jobs } };
    case "first":
      return { ...entry, why: { kind: "firstPayment" } };
    case "none":
      return { ...entry, why: { kind: "none" } };
  }
}

/** Waiting for you with nothing said about it, so import may pair it as a transfer. A near match or a row you chose to leave waiting never pairs itself. */
function waitsUnasked(entry: NewTransaction): boolean {
  return entry.transaction.treatment.kind === "needsYou" && (entry.why.kind === "none" || entry.why.kind === "ambiguous" || entry.why.kind === "firstPayment");
}

/**
 * New transactions waiting in needs you pair with a side in another shared account when each has exactly
 * one candidate. A near match, or a row you chose to leave waiting, makes others ambiguous but never pairs
 * itself. A pair that matches a move at the bank still to do (same accounts, same amount) completes the
 * earliest such move.
 */
function pairNewTransfers(facts: Facts, decided: readonly NewTransaction[]): { readonly transfers: ImportTransfer[]; readonly partners: Map<TransactionId, TransactionId> } {
  const existingSides = unpairedSides(facts);
  const waiting = decided.filter((entry) => entry.transaction.treatment.kind === "needsYou" && entry.account.scope === "shared");
  const firstSides = waiting.filter(waitsUnasked).map((entry) => entry.transaction.id);
  const pool = [...existingSides, ...waiting.map((entry) => entry.transaction)];
  const pairable = new Set([...existingSides.map((t) => t.id), ...firstSides]);
  const sides = new Map<TransactionId, TransferSide>(pool.map((side) => [side.id, side]));
  const partners = new Map<TransactionId, TransactionId>();
  const claimed = new Set<MoveId>();
  const transfers: ImportTransfer[] = [];
  for (const [a, b] of uniquePairs(pool, firstSides, pairable)) {
    const self = sides.get(a);
    const other = sides.get(b);
    if (self === undefined || other === undefined) continue;
    const [outgoing, incoming] = self.amount < 0 ? [self, other] : [other, self];
    const move = [...facts.moves.values()]
      .filter((m) => m.status === "todo" && !claimed.has(m.id) && m.from === outgoing.accountId && m.to === incoming.accountId && m.amount === incoming.amount)
      .sort((x, y) => (x.month < y.month ? -1 : x.month > y.month ? 1 : compareIds(x.id, y.id)))[0];
    if (move !== undefined) claimed.add(move.id);
    transfers.push({ outgoing: outgoing.id, incoming: incoming.id, completesMove: move?.id ?? null });
    partners.set(a, b).set(b, a);
  }
  return { transfers, partners };
}

/** Lower comes first in the preview's sample: what needs you, then near matches, first payments and price changes. */
const attention: Record<Why["kind"], number> = {
  none: 0,
  ambiguous: 0,
  nearMatch: 1,
  firstPayment: 2,
  priceChange: 3,
  chosen: 4,
  rule: 4,
  sameAsLast: 4,
  transferMatch: 4,
  history: 4,
};

function byAttention(a: NewTransaction, b: NewTransaction): number {
  return attention[a.why.kind] - attention[b.why.kind] || compareIds(a.row.bookingDate, b.row.bookingDate) || a.row.line - b.row.line;
}

export function planImport(facts: Facts, file: StatementFile, input: ImportInput): ImportPlan {
  const household = householdOf(facts);
  for (const batch of facts.importBatches.values()) {
    if (!batch.undone && batch.fingerprint === input.fingerprint) return { ok: false, blocked: { kind: "duplicateFile", batchId: batch.id } };
  }
  if (file.accountCurrency !== household.currency) return { ok: false, blocked: { kind: "wrongCurrency", file: file.accountCurrency, household: household.currency } };
  if (file.rows.length === 0) return { ok: false, blocked: { kind: "noRows" } };

  const byNumber = new Map<AccountNumber, Account>();
  for (const account of facts.accounts.values()) if (account.number !== undefined) byNumber.set(account.number, account);
  const known: { readonly row: StatementRow; readonly account: Account }[] = [];
  const unknown: StatementRow[] = [];
  for (const row of file.rows) {
    const account = byNumber.get(row.account);
    if (account === undefined) unknown.push(row);
    else known.push({ row, account });
  }
  const leftOut = leftOutList(unknown);
  const [first] = known;
  if (first === undefined) return { ok: false, blocked: { kind: "noKnownAccounts", leftOut } };

  const batchId = input.ids.batch();
  const matched = matchRows(
    facts.transactions.values(),
    known.map(({ row, account }) => ({ row, account, accountId: account.id, amount: row.amount, bookingDate: row.bookingDate, description: row.description, pending: row.pending })),
  );
  const backedHere = new Set(matched.flatMap(({ outcome }) => (outcome.kind === "backs" ? [outcome.transactionId] : [])));
  const tallies = new Map<AccountId, AccountTally>();
  const tallyFor = (accountId: AccountId): AccountTally => {
    let tally = tallies.get(accountId);
    if (tally === undefined) {
      tally = { rows: 0, created: 0, matched: 0, pending: 0 };
      tallies.set(accountId, tally);
    }
    return tally;
  };
  let from = first.row.bookingDate;
  let to = first.row.bookingDate;
  const rows: ImportRow[] = [];
  const created: Fresh[] = [];
  for (const { row: entry, outcome } of matched) {
    const { row, account } = entry;
    const id = input.ids.row();
    const tally = tallyFor(account.id);
    tally.rows += 1;
    if (row.bookingDate < from) from = row.bookingDate;
    if (row.bookingDate > to) to = row.bookingDate;
    let backs: TransactionId | null = null;
    if (outcome.kind === "pending") tally.pending += 1;
    else if (outcome.kind === "backs") {
      tally.matched += 1;
      backs = outcome.transactionId;
    } else {
      tally.created += 1;
      backs = transactionId(id);
      created.push({
        row,
        account,
        transaction: {
          id: backs,
          accountId: account.id,
          bookingDate: row.bookingDate,
          amount: row.amount,
          description: row.description,
          treatment: { kind: "needsYou" },
          ...defined({ counterparty: row.counterparty, reference: row.reference }),
        },
      });
    }
    rows.push({
      id,
      batchId,
      line: row.line,
      accountId: account.id,
      bookingDate: row.bookingDate,
      description: row.description,
      amount: row.amount,
      fingerprint: matchKey({ accountId: account.id, amount: row.amount, bookingDate: row.bookingDate, description: row.description }),
      pending: row.pending,
      backs,
      ...defined({
        interestDate: row.interestDate,
        counterpartAccount: row.counterpartAccount,
        counterpartName: row.counterpartName,
        reference: row.reference,
        bankType: row.bankType,
        original: row.original,
      }),
    });
  }

  const decision = decide(facts, created, backedHere, new Map((input.choices ?? []).map((choice) => [choice.line, choice])), input.suggest ?? true);
  if (!decision.ok) return { ok: false, blocked: { kind: "badChoice", line: decision.line } };
  const { decided, ignoredChoices } = decision;
  const { transfers, partners } = pairNewTransfers(facts, decided);
  const final = decided.map((entry): NewTransaction => {
    const partner = partners.get(entry.transaction.id);
    return partner === undefined ? entry : { ...entry, why: { kind: "transferMatch", partner } };
  });

  const pendingCount = rows.filter((r) => r.pending).length;
  const batch: ImportBatch = {
    id: batchId,
    fileName: input.fileName,
    fingerprint: input.fingerprint,
    format: file.format,
    importedAt: input.importedAt,
    from,
    to,
    rows: rows.length,
    created: decided.length,
    matched: rows.length - decided.length - pendingCount,
    pending: pendingCount,
    undone: false,
  };

  const importing: Command[] = [
    { kind: "importFile", batch, rows, transactions: decided.map((entry) => entry.transaction) },
    ...(transfers.length === 0
      ? []
      : [{ kind: "pairTransfers", pairs: transfers.map((t) => ({ a: t.outgoing, b: t.incoming, ...(t.completesMove === null ? {} : { completesMove: t.completesMove }) })) } satisfies Command]),
  ];
  const entering: Command[] = input.balances.map((b) => ({
    kind: "enterValue",
    value: { id: input.ids.enteredValue(), kind: "accountBalance", subject: b.accountId, value: b.value, unit: "money", asOf: b.asOf, source: "entered by you" },
  }));
  const imported = apply(facts, { kind: "batch", commands: importing }, { asOf: input.asOf });
  if (!imported.ok) throw new Error(`planImport built a change the app refuses: ${imported.refusal.code}`);

  const typed = new Map<AccountId, TypedBalance>();
  for (const b of input.balances) {
    const before = typed.get(b.accountId);
    if (before === undefined || b.asOf >= before.asOf) typed.set(b.accountId, b);
    if (facts.accounts.has(b.accountId)) tallyFor(b.accountId);
  }

  const finalTreatment = (entry: NewTransaction): Treatment => (entry.why.kind === "transferMatch" ? { kind: "transfer", partner: entry.why.partner } : entry.transaction.treatment);
  const count = (test: (entry: NewTransaction) => boolean) => final.filter(test).length;
  const whyIs = (...kinds: Why["kind"][]) => (entry: NewTransaction) => kinds.includes(entry.why.kind);
  const preview: ImportPreview = {
    batchId,
    fileName: input.fileName,
    format: file.format,
    from,
    to,
    counts: {
      rows: file.rows.length,
      created: decided.length,
      matched: batch.matched,
      pending: pendingCount,
      leftOut: unknown.length,
      history: count((entry) => entry.transaction.treatment.kind === "history"),
      byRule: count(whyIs("rule")),
      suggested: count(whyIs("sameAsLast", "priceChange")),
      chosen: count((entry) => entry.why.kind === "chosen" && entry.transaction.treatment.kind === "split"),
      transfers: count(whyIs("transferMatch")),
      needsYou: count((entry) => entry.why.kind !== "transferMatch" && entry.transaction.treatment.kind === "needsYou"),
    },
    accounts: [...tallies].map(([accountId, tally]) => ({ accountId, ...tally, balance: balanceCheck(imported.facts, accountId, typed.get(accountId)) })),
    leftOut,
    nearMatches: final.flatMap((entry) => (entry.why.kind === "nearMatch" ? [{ transactionId: entry.transaction.id, line: entry.row.line, of: entry.why.of }] : [])),
    transfers,
    completedMoves: transfers.flatMap((t) => (t.completesMove === null ? [] : [t.completesMove])),
    ignoredChoices,
    sample: [...final].sort(byAttention).slice(0, previewSampleSize).map((entry) => ({
      transactionId: entry.transaction.id,
      line: entry.row.line,
      accountId: entry.account.id,
      bookingDate: entry.row.bookingDate,
      amount: entry.row.amount,
      description: entry.row.description,
      ...defined({ counterparty: entry.row.counterparty }),
      treatment: finalTreatment(entry),
      why: entry.why,
    })),
  };
  return { ok: true, preview, command: { kind: "batch", commands: [...importing, ...entering] } };
}
