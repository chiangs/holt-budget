import { formatMoney } from "../../i18n/money.ts";

/** An amount as the list shows it: money out with a true minus sign, money in with a plus, in the household's currency. */
export function amountText(minorUnits: number, currency: string, locale: string): string {
  const text = formatMoney(minorUnits, currency, locale);
  return minorUnits > 0 ? `+${text}` : text.replace(/^-/, "−");
}
