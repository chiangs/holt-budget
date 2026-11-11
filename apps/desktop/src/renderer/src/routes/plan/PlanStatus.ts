import type { Currency, Money } from "@holt/core";
import type { IntlShape } from "react-intl";
import { formatDay } from "../../i18n/dates.ts";
import { formatMoney } from "../../i18n/money.ts";
import { shortMonthAndYear } from "./PlanFormat.ts";
import type { StatusLine } from "./PlanTable.model.ts";

/** An amount as the table shows it: the household's currency, in the interface language's style, with a true minus sign for money below zero. */
export function moneyText(intl: IntlShape, amount: Money, currency: Currency): string {
  return formatMoney(amount, currency, intl.locale).replace(/^-/, "\u2212");
}

function assertNever(value: never): never {
  throw new Error(`Plan has no words for ${JSON.stringify(value)}`);
}

/** The one plain line the table's Status column shows, in the interface language. Every kind of line has its words here, so a new kind fails to compile until it does. */
export function statusText(intl: IntlShape, line: StatusLine, currency: Currency): string {
  const money = (amount: Money) => moneyText(intl, amount, currency);
  switch (line.kind) {
    case "inactive":
      return line.bucket === null
        ? intl.formatMessage({ id: "plan.status.inactive" }, { status: line.status })
        : intl.formatMessage({ id: "plan.status.inactiveBucket" }, { status: line.status, balance: money(line.bucket) });
    case "left":
      return intl.formatMessage({ id: "plan.status.left" }, { amount: money(line.left) });
    case "over":
      return intl.formatMessage({ id: "plan.status.over" }, { amount: money(line.over) });
    case "returned":
      return intl.formatMessage({ id: "plan.status.returned" }, { amount: money(line.amount) });
    case "bucket":
      if (line.target === null) return intl.formatMessage({ id: "plan.status.bucket" }, { balance: money(line.balance) });
      if (line.readyBy === null) return intl.formatMessage({ id: "plan.status.bucketOf" }, { balance: money(line.balance), target: money(line.target) });
      return intl.formatMessage({ id: "plan.status.bucketOfBy" }, { balance: money(line.balance), target: money(line.target), by: shortMonthAndYear(line.readyBy, intl.locale) });
    case "bucketShort":
      return intl.formatMessage({ id: "plan.status.short" }, { amount: money(line.short) });
    case "bufferGoal":
      return intl.formatMessage({ id: "plan.status.buffer" }, { balance: money(line.balance), target: money(line.target), months: line.months });
    case "payInto": {
      if (line.paid.kind === "notYet") return intl.formatMessage({ id: "plan.status.payIntoNotYet" }, { account: line.accountName });
      if (line.paid.on === null) return intl.formatMessage({ id: "plan.status.payIntoPaid" }, { account: line.accountName });
      return intl.formatMessage({ id: "plan.status.payIntoPaidOn" }, { account: line.accountName, date: formatDay(line.paid.on, intl.locale) });
    }
    default:
      return assertNever(line);
  }
}

/** Whether the line is one that needs the family's eye, so the table marks it with an icon and a border as well as colour. */
export function needsAttention(line: StatusLine): boolean {
  return line.kind === "over" || line.kind === "bucketShort";
}
