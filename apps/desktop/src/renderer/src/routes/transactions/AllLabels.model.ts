/**
 * The words for a transaction in the list and the detail panel. A model never formats text itself: it picks a
 * message and the values to put in it, so the wording lives in the message file and a test can check that every
 * kind of treatment has words.
 */

import type { AccountId, JobId, Month, Rule, Transaction, TransactionId } from "@holt/core";
import type { MessageId } from "../../i18n/messages.ts";
import { formatMoney } from "../../i18n/money.ts";

export interface Words {
  readonly id: MessageId;
  readonly values?: Readonly<Record<string, string | number>>;
}

/** How to name the things a transaction points at. The page supplies these from the facts and the interface language. */
export interface Names {
  account(id: AccountId): string;
  job(id: JobId): string;
  /** "December". */
  month(month: Month): string;
  transaction(id: TransactionId): Transaction | undefined;
}

/** The counterparty, or the bank's description when the bank gave no name. */
export function titleOf(transaction: Pick<Transaction, "counterparty" | "description">): string {
  const name = transaction.counterparty?.trim();
  return name === undefined || name === "" ? transaction.description : name;
}

/** What became of the transaction, in words: "Electricity", "Split across 2 jobs", "Transfer to Regninger", "Income for December". */
export function treatmentWords(transaction: Transaction, names: Names): Words {
  const { treatment } = transaction;
  switch (treatment.kind) {
    case "needsYou":
      return { id: "browse.treatment.needsYou" };
    case "income":
      return { id: "browse.treatment.income", values: { month: names.month(treatment.fundsMonth) } };
    case "transfer": {
      const partner = treatment.partner === null ? undefined : names.transaction(treatment.partner);
      if (partner === undefined) return { id: "browse.treatment.transferWaiting" };
      return { id: transaction.amount < 0 ? "browse.treatment.transferTo" : "browse.treatment.transferFrom", values: { account: names.account(partner.accountId) } };
    }
    case "split": {
      const [only, ...more] = treatment.allocations;
      if (more.length > 0) return { id: "browse.treatment.split", values: { count: treatment.allocations.length } };
      return { id: only.amount > 0 ? "browse.treatment.refund" : "browse.treatment.job", values: { job: names.job(only.jobId) } };
    }
    case "history":
      return treatment.jobId === null ? { id: "browse.treatment.history" } : { id: "browse.treatment.historyJob", values: { job: names.job(treatment.jobId) } };
  }
}

/** Who decided: the rule that applied, you (or a suggestion you accepted: the log keeps no more than that), or nobody yet. */
export function decidedWords(transaction: Transaction, rule: Rule | undefined): Words {
  if (transaction.ruleId !== undefined) {
    if (rule === undefined) return { id: "browse.decided.ruleGone" };
    const values = { counterparty: rule.match.counterparty };
    switch (rule.origin) {
      case "set":
        return { id: "browse.decided.ruleSet", values };
      case "learned":
        return { id: "browse.decided.ruleLearned", values };
      case "accepted":
        return { id: "browse.decided.ruleAccepted", values };
    }
  }
  switch (transaction.treatment.kind) {
    case "needsYou":
      return { id: "browse.decided.waiting" };
    case "history":
      return { id: "browse.decided.history" };
    case "income":
    case "transfer":
    case "split":
      return { id: "browse.decided.you" };
  }
}

const minusSign = "\u2212";

/** Money out gets the minus sign the mockup uses (U+2212, not a hyphen) and money in a plus sign. */
export function signedMoney(amount: number, currency: string, locale: string): string {
  if (amount === 0) return formatMoney(0, currency, locale);
  const text = formatMoney(Math.abs(amount), currency, locale);
  return amount < 0 ? `${minusSign}${text}` : `+${text}`;
}

/** "December" or "December 2026". Months are calendar months, so no time zone moves them. */
export function monthLabel(month: Month, locale: string, withYear: boolean): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, withYear ? { month: "long", year: "numeric", timeZone: "UTC" } : { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, number - 1, 1)));
}
