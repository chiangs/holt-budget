/**
 * Money in Holt is always a whole number of øre (rule 1 in the domain model).
 * Never use floating-point kroner for amounts. Convert only at the edges:
 * parsing imports, and formatting for display.
 */

declare const oreBrand: unique symbol;

/** An amount in whole øre. 100 øre = 1 krone. Negative means money out. */
export type Ore = number & { readonly [oreBrand]: true };

export class MoneyError extends Error {
  override name = "MoneyError";
}

/** Wrap an integer as øre. Throws if it isn't a safe integer. */
export function ore(value: number): Ore {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Not a whole number of øre: ${value}`);
  }
  return value as Ore;
}

/** Whole kroner to øre. Use for amounts the family types as kroner. */
export function fromKroner(kroner: number): Ore {
  if (!Number.isSafeInteger(kroner)) {
    throw new MoneyError(`Use parseKroner for amounts with øre: ${kroner}`);
  }
  return ore(kroner * 100);
}

/**
 * Parse a bank-style amount string to øre without floating point.
 * Accepts "1 234,56", "1234.56", "-2 846,00", "−449" (Unicode minus), "+28 000".
 * The caller (a format profile) says which character is the decimal separator.
 */
export function parseKroner(text: string, decimalSeparator: "," | "." = ","): Ore {
  const cleaned = text
    .trim()
    .replace(/−/g, "-") // Unicode minus sign
    .replace(/[\s  ]/g, ""); // spaces, non-breaking and narrow spaces
  const thousands = decimalSeparator === "," ? "." : ",";
  const normalised = cleaned.split(thousands).join("");
  const pattern = decimalSeparator === "," ? /^([+-]?)(\d+)(?:,(\d{1,2}))?$/ : /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/;
  const parts = pattern.exec(normalised);
  if (!parts) {
    throw new MoneyError(`Not an amount: "${text}"`);
  }
  const sign = parts[1] === "-" ? -1 : 1;
  const whole = Number(parts[2]);
  const fraction = Number((parts[3] ?? "").padEnd(2, "0"));
  return ore(sign * (whole * 100 + fraction));
}

export function add(...amounts: Ore[]): Ore {
  return ore(amounts.reduce<number>((sum, a) => sum + a, 0));
}

export function subtract(a: Ore, b: Ore): Ore {
  return ore(a - b);
}

/** Round up to the nearest step, for example 50 kr when evening out (decision 6). */
export function roundUpTo(amount: Ore, step: Ore): Ore {
  if (step <= 0) throw new MoneyError("Step must be positive");
  return ore(Math.ceil(amount / step) * step);
}

/** Divide into a whole number of øre per part, rounding up so the parts cover the total. */
export function divideUp(total: Ore, parts: number): Ore {
  if (!Number.isInteger(parts) || parts <= 0) throw new MoneyError("Parts must be a positive integer");
  return ore(Math.ceil(total / parts));
}

const formatter = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const formatterWithOre = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Format for display: "68,048 kr". Øre are shown only when they matter
 * (writing conventions in the IA document). Uses a real minus sign.
 */
export function formatKroner(amount: Ore, options: { showOre?: boolean } = {}): string {
  const showOre = options.showOre ?? amount % 100 !== 0;
  const text = (showOre ? formatterWithOre : formatter).format(Math.abs(amount) / 100);
  return `${amount < 0 ? "−" : ""}${text} kr`;
}
