/** What `cleanCounterparty` reads from a row: the bank's description, and the other party's name when the bank gave one. */
export interface CounterpartyInput {
  readonly description: string;
  readonly counterpartName?: string | undefined;
}

const notWordBefore = "(?<![\\p{L}\\p{N}])";
const notWordAfter = "(?![\\p{L}\\p{N}])";
const processors = "vipps|zettle|izettle|sumup|paypal|nyx|loomis[- ]?pay";
const currencies = "NOK|SEK|DKK|EUR|USD|GBP|CHF|PLN|ISK|CAD|AUD|JPY|CNY|THB|TRY|HUF|CZK";
const legalForms = new Set(["AS", "ASA", "AB", "ANS", "DA", "NUF", "SA", "BV", "NV", "SE", "AG", "KS", "OY", "OYJ", "LTD", "LLC", "INC", "PLC"]);

// The words a bank puts in front of the payee to say how the money moved. A direction word that follows ("Nettgiro til:") goes with it.
const methodWords = "kortkjøp|varekjøp|utlandskjøp|debetkort|kreditkort|bankkort|nettgiro|avtalegiro|e-?faktura|giro|overføring|overførsel|nettbank|mobilbank|lønn|betaling|utland";
const leading: readonly RegExp[] = [
  new RegExp(`^(?:${methodWords})${notWordAfter}(?:\\s*[:*])?(?:\\s+(?:til|fra)${notWordAfter}\\s*:?)?\\s*`, "iu"),
  new RegExp(`^(?:visa|mastercard)\\s+(?:nr\\.?\\s*)?[*•xX]*\\d{4}${notWordAfter}\\s*`, "iu"),
  new RegExp(`^(?:${processors}|loomisp|svea|klarna|sq)\\s*\\*\\s*`, "iu"),
  /^(?:til|fra)\s*:\s*/iu,
];

// Each pattern takes one kind of bookkeeping out of the middle or end of a description. The last two only match at the end.
const noise: readonly RegExp[] = [
  new RegExp(`${notWordBefore}betalt:?\\s*\\d{1,2}\\.\\d{1,2}(?:\\.\\d{2,4})?${notWordAfter}`, "giu"), // Betalt: 12.03.26
  new RegExp(`${notWordBefore}\\d{4}-\\d{2}-\\d{2}${notWordAfter}`, "gu"), // 2026-03-12
  new RegExp(`${notWordBefore}\\d{1,2}/\\d{1,2}/\\d{2,4}${notWordAfter}`, "gu"), // 12/03/2026, but not "24/7"
  /(?<![\p{L}\p{N}.])(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])(?:\.(?:\d{4}|\d{2}))?(?![\p{L}\p{N}.])/gu, // 12.03 and 12.03.26
  new RegExp(`${notWordBefore}\\d{1,2}:\\d{2}(?::\\d{2})?${notWordAfter}`, "gu"), // 12:45
  new RegExp(`${notWordBefore}(?:${currencies})\\s+-?\\d+(?:[.,]\\d+)?${notWordAfter}`, "gu"), // USD 15,50
  new RegExp(`${notWordBefore}-?\\d+[.,]\\d{1,2}\\s+(?:${currencies})${notWordAfter}`, "gu"), // 15,50 USD
  new RegExp(`${notWordBefore}(?:valuta)?kurs\\s*:?\\s*\\d+(?:[.,]\\d+)?`, "giu"), // Kurs: 10,5000
  /\d{4}\s[*•xX]{4}\s[*•xX]{4}\s\d{4}/gu, // 4571 **** **** 1234
  new RegExp(`(?:\\*+|•+|[xX]{2,})\\s?\\d{4}${notWordAfter}`, "gu"), // *1234
  new RegExp(`${notWordBefore}(?:f\\.?\\s?nr|fakturanr|fakturanummer|faktura|refnr|ref|referanse|kid)\\.?\\s*:?\\s*\\p{L}*\\d[\\p{L}\\p{N}-]*`, "giu"), // KID 0012345, f.nr:123
  /\d{4}\.\d{2}\.\d{5}/gu, // an account number such as 9720.00.20001
  new RegExp(`\\s+[-\\u2013]\\s+(?:${processors})$`, "iu"), // - Vipps
  /\s+(?:(?:nr|no)\.?\s*\d+|#\s*\d+|\d{3,})$/iu, // Nr 103, NO 10, #7 and a store number of three or more digits; "Studio 54" stays
];

const isReference = (token: string) => /^\d{6,}$/u.test(token) || /^(?=(?:.*\d){2})[\p{L}\p{N}]{10,}$/u.test(token);

function strip(text: string): string {
  let rest = text;
  for (const pattern of leading) rest = rest.replace(pattern, "");
  for (const pattern of noise) rest = rest.replace(pattern, " ");
  rest = rest
    .split(/\s+/)
    .filter((token) => !isReference(token))
    .join(" ");
  return rest.replace(/^[\s\-\u2013:;,.*/#]+|[\s\-\u2013:;,*/#]+$/gu, "");
}

function titleCase(word: string): string {
  if (legalForms.has(word)) return word;
  return word.replace(/\p{L}+/gu, (letters) => letters.charAt(0) + letters.slice(1).toLowerCase());
}

function clean(source: string | undefined): string | undefined {
  if (source === undefined) return undefined;
  let text = source.normalize("NFC").replace(/\s+/g, " ").trim();
  for (let next = strip(text); next !== text; next = strip(text)) text = next;
  // A bank that writes the payee in capitals isn't marking it as shouting: "KIWI" and "Kiwi" are one shop.
  if (!/\p{Ll}/u.test(text)) text = text.split(" ").map(titleCase).join(" ");
  return /\p{L}/u.test(text) ? text : undefined;
}

/**
 * The other party's name, in the bank's own words with the bookkeeping taken off: the payment method ("Kortkjøp",
 * "Nettgiro til:"), dates, card number fragments, foreign-currency amounts and rates, payment-processor tags
 * ("- Vipps"), reference numbers, and a trailing store number of three or more digits ("Kiwi 505").
 * A name the bank writes in capitals gets capital-first words. Returns undefined when nothing is left,
 * for example for a transfer whose description is only the other account's number.
 */
export function cleanCounterparty(row: CounterpartyInput): string | undefined {
  return clean(row.counterpartName) ?? clean(row.description);
}
