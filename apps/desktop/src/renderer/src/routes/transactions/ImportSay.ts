import type { LocalDate, Month, Refusal } from "@holt/core";
import type { IntlShape } from "react-intl";
import { formatDay, formatFullDay } from "../../i18n/dates.ts";
import type { MessageId } from "../../i18n/messages.ts";
import { formatMoney } from "../../i18n/money.ts";
import { refusalText } from "./refusal.ts";

/** A piece of a message that the page formats only when it shows it, so the models hold plain data and stay testable. */
export type Value =
  | string
  | number
  | Words
  | { readonly money: number }
  | { readonly day: LocalDate }
  | { readonly fullDay: LocalDate }
  | { readonly month: Month }
  | { readonly refusal: Refusal }
  | { readonly list: readonly Value[]; readonly type: "conjunction" | "disjunction" };

/** A message and the values it needs. The ID is checked against the message files at compile time. */
export interface Words {
  readonly id: MessageId;
  readonly values?: Readonly<Record<string, Value>>;
}

function render(intl: IntlShape, currency: string, value: Value): string | number {
  if (typeof value === "string" || typeof value === "number") return value;
  if ("id" in value) return say(intl, currency, value);
  if ("money" in value) return formatMoney(value.money, currency, intl.locale);
  if ("day" in value) return formatDay(value.day, intl.locale);
  if ("fullDay" in value) return formatFullDay(value.fullDay, intl.locale);
  if ("month" in value) return new Intl.DateTimeFormat(intl.locale, { month: "long", timeZone: "UTC" }).format(new Date(`${value.month}-01T00:00:00Z`));
  if ("refusal" in value) return refusalText(intl, value.refusal);
  return intl.formatList(
    value.list.map((item) => String(render(intl, currency, item))),
    { type: value.type },
  );
}

/** The one place a message becomes text: money, dates, months and lists are formatted here, at the edge. */
export function say(intl: IntlShape, currency: string, words: Words): string {
  const values: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(words.values ?? {})) values[name] = render(intl, currency, value);
  return intl.formatMessage({ id: words.id }, values);
}
