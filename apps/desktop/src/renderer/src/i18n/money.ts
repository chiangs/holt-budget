/**
 * Formats an amount held as integer minor units (øre, cents, yen). This is the only place an
 * amount becomes text. The decimal digits come from the currency through Intl, so JPY has none and
 * NOK has two. Whole amounts drop their decimals ("68,048 kr"), other amounts keep all of them.
 * Kroner are written "amount kr" in every language (technical-decisions.md §3).
 */
export function formatMoney(minorUnits: number, currency: string, locale: string): string {
  if (!Number.isSafeInteger(minorUnits)) {
    throw new RangeError(`Amounts are integer minor units, got ${minorUnits}`);
  }
  const digits = new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 0;
  const scale = 10n ** BigInt(digits);
  const absolute = BigInt(Math.abs(minorUnits));
  const whole = absolute / scale;
  const fraction = absolute % scale;
  const decimal = `${minorUnits < 0 ? "-" : ""}${whole}${fraction === 0n ? "" : `.${fraction.toString().padStart(digits, "0")}`}` as `${number}`;
  const fractionDigits = fraction === 0n ? 0 : digits;
  const options = { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits };

  if (currency === "NOK") {
    return `${new Intl.NumberFormat(locale, options).format(decimal)} kr`;
  }
  return new Intl.NumberFormat(locale, { style: "currency", currency, ...options }).format(decimal);
}
