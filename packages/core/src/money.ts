/**
 * Money in Holt is always a whole number of minor units (rule 1 in the domain
 * model): øre for NOK, cents for EUR and USD, whole yen for JPY.
 *
 * A household has exactly one currency, so a `Money` value carries none and
 * nothing here converts between currencies. Never use floating point for
 * amounts. Convert only at the edges: parsing imports, and formatting for
 * display (which belongs to the renderer's message layer, not to core).
 */

declare const moneyBrand: unique symbol;
declare const currencyBrand: unique symbol;

/** An amount in whole minor units of the household's currency. Negative means money out. */
export type Money = number & { readonly [moneyBrand]: true };

/** An ISO 4217 currency code, such as "NOK", checked against the runtime's list. */
export type Currency = string & { readonly [currencyBrand]: true };

export class MoneyError extends Error {
  override name = "MoneyError";
}

/** Wrap an integer as money. Throws if it isn't a safe integer. */
export function money(value: number): Money {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Not a whole number of minor units: ${value}`);
  }
  return value as Money;
}

/** Check a currency code. Throws unless it is an ISO 4217 code that the runtime knows. */
export function currency(code: string): Currency {
  if (!/^[A-Z]{3}$/.test(code) || !Intl.supportedValuesOf("currency").includes(code)) {
    throw new MoneyError(`Not a currency code: "${code}"`);
  }
  return code as Currency;
}

const digitsByCurrency = new Map<Currency, number>();

/** How many digits follow the decimal separator in the currency: 2 for NOK, 0 for JPY, 3 for KWD. */
export function minorUnitDigits(code: Currency): number {
  const known = digitsByCurrency.get(code);
  if (known !== undefined) return known;
  const digits = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits;
  if (digits === undefined) throw new MoneyError(`The runtime has no minor units for ${code}`);
  digitsByCurrency.set(code, digits);
  return digits;
}

/** Whole major units (kroner, euros, yen) to minor units. Use for amounts the family types as whole numbers. */
export function fromMajor(major: number, code: Currency): Money {
  if (!Number.isSafeInteger(major)) {
    throw new MoneyError(`Use parseMoney for amounts with minor units: ${major}`);
  }
  return money(major * 10 ** minorUnitDigits(code));
}

/**
 * Parse a bank-style amount string to minor units without floating point.
 * Accepts "1 234,56", "1234.56", "-2 846,00", "−449" (Unicode minus), "+28 000".
 * The caller (a format profile) says which character is the decimal separator.
 * A currency with no minor units (JPY) accepts no decimal part.
 */
export function parseMoney(text: string, code: Currency, decimalSeparator: "," | "." = ","): Money {
  const digits = minorUnitDigits(code);
  const cleaned = text
    .trim()
    .replace(/−/g, "-") // Unicode minus sign
    .replace(/[\s\u00a0\u202f]/g, ""); // spaces, non-breaking and narrow spaces
  const thousands = decimalSeparator === "," ? "." : ",";
  const normalised = cleaned.split(thousands).join("");
  const separator = decimalSeparator === "," ? "," : "\\.";
  const fraction = digits === 0 ? "" : `(?:${separator}(\\d{1,${digits}}))?`;
  const parts = new RegExp(`^([+-]?)(\\d+)${fraction}$`).exec(normalised);
  if (!parts) {
    throw new MoneyError(`Not an amount in ${code}: "${text}"`);
  }
  const sign = parts[1] === "-" ? -1 : 1;
  const whole = Number(parts[2]);
  const minor = Number((parts[3] ?? "").padEnd(digits, "0"));
  return money(sign * (whole * 10 ** digits + minor));
}

export function add(...amounts: Money[]): Money {
  return money(amounts.reduce<number>((sum, a) => sum + a, 0));
}

export function subtract(a: Money, b: Money): Money {
  return money(a - b);
}

/** Round up to the nearest step, for example the household's even-out step (decision 6). */
export function roundUpTo(amount: Money, step: Money): Money {
  if (step <= 0) throw new MoneyError("Step must be positive");
  return money(Math.ceil(amount / step) * step);
}

/** Divide into a whole number of minor units per part, rounding up so the parts cover the total. */
export function divideUp(total: Money, parts: number): Money {
  if (!Number.isInteger(parts) || parts <= 0) throw new MoneyError("Parts must be a positive integer");
  if (total < 0) throw new MoneyError("Total must not be negative");
  return money(Math.ceil(total / parts));
}
