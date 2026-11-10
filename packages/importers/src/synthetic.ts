/**
 * Synthetic bank exports for an invented household, in each bank's exact format. Tests and the development seed call
 * `syntheticStatements`; `scripts/make-synthetic.ts` writes the same text to fixtures/synthetic/. Every name, account
 * number and amount is made up, and the same options always give the same text.
 */
import { type AccountNumber, type LocalDate, addDays, localDate } from "@holt/core";
import { dotted, syntheticAccounts } from "./synthetic-accounts.ts";

export { dotted, syntheticAccounts, type SyntheticAccount } from "./synthetic-accounts.ts";

export interface SyntheticOptions {
  /** The first day any file covers. */
  readonly from: LocalDate;
  /** The last day any file covers. */
  readonly to: LocalDate;
  /** The same seed gives the same shops and amounts. */
  readonly seed: number;
}

/** The range and seed of the committed fixtures in fixtures/synthetic/. */
export const syntheticFixtureOptions: SyntheticOptions = { from: localDate("2026-01-01"), to: localDate("2026-11-09"), seed: 20261109 };

export interface SyntheticFile {
  readonly name: string;
  readonly bank: "bulder" | "sparebank1" | "ofx";
  readonly text: string;
}

export interface SyntheticStatements {
  readonly files: readonly SyntheticFile[];
  readonly accounts: typeof syntheticAccounts;
}

/** A small seeded generator (mulberry32), so the files are the same on every run and every machine. */
function generator(seed: number) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    pick: <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!,
    between: (low: number, high: number) => low + Math.floor(random() * (high - low + 1)),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (year: number, month: number, day: number) => localDate(`${year}-${pad(month)}-${pad(day)}`);

/** The year and month of every calendar month from the first day to the last. */
function monthsBetween(from: LocalDate, to: LocalDate): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  while (isoDay(year, month, 1) <= to) {
    months.push({ year, month });
    [year, month] = month === 12 ? [year + 1, 1] : [year, month + 1];
  }
  return months;
}

/** One generator per month, so a month's rows don't change when the range around it does. */
const monthGenerator = (seed: number, year: number, month: number) => generator(Math.imul(seed ^ (year * 12 + month), 2654435761));

/** Øre to the banks' "1234,56". */
const kroner = (ore: number) => `${ore < 0 ? "-" : ""}${Math.floor(Math.abs(ore) / 100)},${pad(Math.abs(ore) % 100)}`;
const norwegianDate = (date: LocalDate) => `${date.slice(8)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

interface Party {
  readonly name: string;
  readonly number: string;
}

interface BulderRow {
  readonly date: LocalDate;
  readonly amount: number;
  readonly original?: { readonly amount: number; readonly currency: string };
  readonly to?: Party;
  readonly from?: Party;
  readonly type: string;
  readonly text: string;
  readonly kid?: string;
  readonly category?: readonly [string, string];
}

const own = ({ name, number }: { name: string; number: AccountNumber }): Party => ({ name, number: dotted(number) });
const outside = ({ number }: { number: AccountNumber }): Party => ({ name: "", number: dotted(number) });
const shop = (name: string): Party => ({ name: "", number: name });

const { bulder: bulderAccounts, sparebank1: sr, outside: others } = syntheticAccounts;
const shops = ["Nærbutikken Fjord", "Kaffebaren Torget", "Bokhandel Strand", "Byggvare Nord", "Apoteket Sentrum", "Torgkafeen - Vipps", "FJORDMAT 1132"];
const bills = [
  { payee: others.energy, kid: "0012345678903", type: "Avtalegiro" },
  { payee: others.broadband, kid: "0098765432105", type: "Efaktura" },
];

function bulderMonth(seed: number, year: number, month: number): BulderRow[] {
  const { pick, between } = monthGenerator(seed, year, month);
  const day = (d: number) => isoDay(year, month, d);
  const rows: BulderRow[] = [];

  rows.push({ date: day(20), amount: 4_250_000, to: own(bulderAccounts.everyday), from: outside(others.employer), type: "Inntekt", text: "Lønn Eksempel AS", category: ["Inntekter", "Lønn"] });
  for (const { payee, kid, type } of bills) {
    rows.push({ date: day(15), amount: -between(40_000, 180_000), to: outside(payee), from: own(bulderAccounts.bills), type, text: payee.name, kid, category: ["Bolig", "Strøm"] });
  }
  // A transfer between two of the household's Bulder accounts: one row on each account.
  const move = between(500_000, 900_000);
  for (const amount of [-move, move]) {
    rows.push({ date: day(21), amount, to: own(bulderAccounts.food), from: own(bulderAccounts.everyday), type: "Overføring", text: "Overførsel" });
  }
  for (let i = 0; i < 6; i++) {
    const name = pick(shops);
    rows.push({ date: day(between(1, 28)), amount: -between(2_500, 95_000), to: shop(name), from: own(bulderAccounts.food), type: "Betaling", text: name, category: ["Mat", "Dagligvarer"] });
  }
  // Identical small savings transfers on the same day are real repeats, not duplicates.
  for (let copy = 0; copy < 2; copy++) {
    for (const amount of [-2_000, 2_000]) {
      rows.push({ date: day(3), amount, to: own(bulderAccounts.holiday), from: own(bulderAccounts.everyday), type: "Overføring", text: "Mikrospar til Ferie" });
    }
  }
  // Three identical card purchases on one day.
  for (let copy = 0; copy < 3; copy++) {
    rows.push({ date: day(9), amount: -4_500, to: shop("Kaffebaren Torget"), from: own(bulderAccounts.food), type: "Betaling", text: "Kaffebaren Torget", category: ["Mat", "Kafé"] });
  }
  // An e-invoice for nothing has no sign.
  rows.push({ date: day(16), amount: 0, to: outside(others.housing), from: own(bulderAccounts.everyday), type: "Efaktura", text: "Eksempel Borettslag" });
  // The monthly loan payment, to the household's SpareBank 1 account.
  rows.push({ date: day(20), amount: -941_200, to: outside(sr.loanPayments), from: own(bulderAccounts.bills), type: "Betaling", text: dotted(sr.loanPayments.number) });
  // Money between two people through Vipps.
  rows.push({ date: day(12), amount: 25_000, to: own(bulderAccounts.everyday), type: "Betaling", text: `Fra: Eksempel Venn Betalt: 12.${pad(month)}.${String(year).slice(2)}` });
  rows.push({ date: day(14), amount: -18_000, from: own(bulderAccounts.everyday), to: shop("Eksempel Venn - Vipps"), type: "Betaling", text: "Eksempel Venn - Vipps" });

  if (month === 1) {
    rows.push({ date: day(1), amount: 100, to: own(bulderAccounts.everyday), type: "Renter", text: "KREDITRENTER", category: ["Inntekter", "Renter"] });
  }
  if (month === 3) {
    rows.push({ date: day(5), amount: -39_900, to: shop("NO7712345600099"), from: own(bulderAccounts.bills), type: "Betaling", text: "Eksempel Inkasso" });
  }
  // Purchases abroad: the amount is in kroner; the original amount and currency are information.
  if (month === 7) {
    rows.push({ date: day(9), amount: -16_460, original: { amount: -1_511, currency: "USD" }, to: shop("Example Store"), from: own(bulderAccounts.everyday), type: "Betaling", text: "Example Store" });
    rows.push({ date: day(11), amount: -5_166, original: { amount: -440, currency: "EUR" }, to: shop("Café Exemple"), from: own(bulderAccounts.everyday), type: "Betaling", text: "Café Exemple" });
  }
  return rows;
}

const bulderHeader = "Dato;Beløp;Originalt Beløp;Original Valuta;Til konto;Til kontonummer;Fra konto;Fra kontonummer;Type;Tekst;KID;Hovedkategori;Underkategori";

function bulderCsv(rows: readonly BulderRow[]): string {
  const lines = rows.map((r) =>
    [
      r.date,
      kroner(r.amount),
      kroner(r.original?.amount ?? r.amount),
      r.original?.currency ?? "NOK",
      r.to?.name ?? "",
      r.to?.number ?? "",
      r.from?.name ?? "",
      r.from?.number ?? "",
      r.type,
      r.text,
      r.kid ?? "",
      r.category?.[0] ?? "",
      r.category?.[1] ?? "",
    ].join(";"),
  );
  return [bulderHeader, ...lines].join("\n") + "\n";
}

interface SrRow {
  readonly date: LocalDate;
  readonly text: string;
  readonly interestDate?: LocalDate;
  readonly amount: number;
  readonly to: AccountNumber;
  readonly from?: AccountNumber;
}

const quote = (s: string) => `"${s}"`;

// SpareBank 1: one file per account, newest first, a byte-order mark, every field quoted, and a trailing semicolon.
function sparebank1Csv(rows: readonly SrRow[]): string {
  const newestFirst = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const lines = newestFirst.map((r) =>
    [
      quote(norwegianDate(r.date)),
      quote(r.text),
      r.interestDate ? quote(norwegianDate(r.interestDate)) : "",
      r.amount > 0 ? quote(kroner(r.amount)) : "",
      r.amount <= 0 ? quote(kroner(r.amount)) : "",
      quote(r.to),
      r.from ? quote(r.from) : "",
    ].join(";") + ";",
  );
  return "\uFEFFDato;Beskrivelse;Rentedato;Inn;Ut;Til konto;Fra konto;\n" + lines.join("\n") + "\n";
}

/**
 * The household's exports as the two banks write them. Bulder gives one file for every account. It comes as an older
 * file and a newer one, and the two overlap by two weeks, so importing both has to match the repeated rows by count.
 * SpareBank 1 gives one file per account. A range under six weeks leaves the older file empty.
 */
export function syntheticStatements({ from, to, seed }: SyntheticOptions): SyntheticStatements {
  const inRange = (date: LocalDate) => date >= from && date <= to;
  const months = monthsBetween(from, to);

  const bulderRows = months
    .flatMap(({ year, month }) => bulderMonth(seed, year, month))
    .filter((row) => inRange(row.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const olderEnd = addDays(to, -28);
  const newerStart = addDays(olderEnd, -13);

  const interestFrom = addDays(to, -75);
  const loanPayments: SrRow[] = months.flatMap(({ year, month }) => {
    const paid = isoDay(year, month, 22);
    const received = isoDay(year, month, 20);
    return [
      { date: paid, text: `Til :${sr.houseLoan.number}`, ...(paid >= interestFrom ? { interestDate: paid } : {}), amount: -941_200, to: sr.houseLoan.number, from: sr.loanPayments.number },
      { date: received, text: "Eksempel Person", ...(received >= interestFrom ? { interestDate: received } : {}), amount: 941_200, to: sr.loanPayments.number, from: bulderAccounts.bills.number },
    ].filter((row) => inRange(row.date));
  });
  const deposit: SrRow[] = months.flatMap(({ year, month }) => {
    const { between } = monthGenerator(seed + 1, year, month);
    const rows: SrRow[] = [];
    if (month % 3 === 1) rows.push({ date: isoDay(year, month, 3), text: "Eksempel Person", amount: between(1_000_000, 3_500_000), to: sr.deposit.number, from: others.employer.number });
    if (month === 12) rows.push({ date: isoDay(year, 12, 31), text: "KREDITRENTER", amount: between(20_000, 90_000), to: sr.deposit.number });
    return rows.filter((row) => inRange(row.date));
  });

  return {
    accounts: syntheticAccounts,
    files: [
      { name: "bulder.csv", bank: "bulder", text: bulderCsv(bulderRows.filter((row) => row.date <= olderEnd)) },
      { name: "bulder-later.csv", bank: "bulder", text: bulderCsv(bulderRows.filter((row) => row.date >= newerStart)) },
      { name: "sparebank1-loan-payments.csv", bank: "sparebank1", text: sparebank1Csv(loanPayments) },
      { name: "sparebank1-deposit.csv", bank: "sparebank1", text: sparebank1Csv(deposit) },
    ],
  };
}

type OfxNode = readonly [name: string, content: string | readonly OfxNode[]];

const ofxEscape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Writes OFX elements as 1.x SGML (a leaf has no closing tag) or as 2.x XML (every element closes). */
function ofxElements(nodes: readonly OfxNode[], xml: boolean): string {
  return nodes
    .map(([name, content]) =>
      typeof content === "string"
        ? xml
          ? `<${name}>${ofxEscape(content)}</${name}>`
          : `<${name}>${ofxEscape(content)}`
        : `<${name}>\n${ofxElements(content, xml)}\n</${name}>`,
    )
    .join("\n");
}

const ofxDay = (date: LocalDate) => `${date.slice(0, 4)}${date.slice(5, 7)}${date.slice(8)}120000`;
const ofxAmount = (ore: number) => `${ore < 0 ? "-" : ""}${Math.floor(Math.abs(ore) / 100)}.${pad(Math.abs(ore) % 100)}`;

interface OfxRow {
  readonly date: LocalDate;
  readonly type: string;
  readonly amount: number;
  readonly name: string;
  readonly memo?: string;
}

function ofxMonth(seed: number, year: number, month: number): OfxRow[] {
  const { between } = monthGenerator(seed + 2, year, month);
  const day = (d: number) => isoDay(year, month, d);
  return [
    { date: day(5), type: "POS", amount: -between(5_000, 80_000), name: "KAFFEBAREN TORGET", memo: `Kortkjøp 05.${pad(month)}` },
    { date: day(20), type: "DIRECTDEP", amount: 4_250_000, name: "Eksempel AS", memo: "Lønn" },
    { date: day(25), type: "SRVCHG", amount: -2_900, name: "Kontogebyr" },
  ];
}

/**
 * One account's statement as OFX, once as 1.x (SGML) and once as 2.x (XML), for the same account, rows and balance.
 * It has a pending purchase (STMTTRNP) and a ledger balance. No real bank of the household's offers OFX.
 */
export function syntheticOfx({ from, to, seed }: SyntheticOptions): readonly SyntheticFile[] {
  const rows = monthsBetween(from, to)
    .flatMap(({ year, month }) => ofxMonth(seed, year, month))
    .filter((row) => row.date >= from && row.date <= to);
  const opening = 1_500_000;
  const balance = rows.reduce((sum, row) => sum + row.amount, opening);

  const statement: OfxNode = [
    "STMTRS",
    [
      ["CURDEF", "NOK"],
      ["BANKACCTFROM", [["BANKID", "9760"], ["ACCTID", syntheticAccounts.ofx.number], ["ACCTTYPE", "CHECKING"]]],
      [
        "BANKTRANLIST",
        [
          ["DTSTART", ofxDay(from)],
          ["DTEND", ofxDay(to)],
          ...rows.map((row, i): OfxNode => [
            "STMTTRN",
            [
              ["TRNTYPE", row.type],
              ["DTPOSTED", ofxDay(row.date)],
              ["TRNAMT", ofxAmount(row.amount)],
              ["FITID", `${row.date.replaceAll("-", "")}${pad(i % 100)}`],
              ["NAME", row.name],
              ...(row.memo ? [["MEMO", row.memo] as const] : []),
            ],
          ]),
        ],
      ],
      [
        "BANKTRANLISTP",
        [
          ["DTASOF", ofxDay(to)],
          ["STMTTRNP", [["TRNTYPE", "POS"], ["DTTRAN", ofxDay(to)], ["TRNAMT", ofxAmount(-4_900)], ["NAME", "Nærbutikken Fjord"]]],
        ],
      ],
      ["LEDGERBAL", [["BALAMT", ofxAmount(balance)], ["DTASOF", ofxDay(to)]]],
    ],
  ];
  const response: readonly OfxNode[] = [
    ["SIGNONMSGSRSV1", [["SONRS", [["STATUS", [["CODE", "0"], ["SEVERITY", "INFO"]]], ["DTSERVER", ofxDay(to)], ["LANGUAGE", "NOR"]]]]],
    ["BANKMSGSRSV1", [["STMTTRNRS", [["TRNUID", "1"], ["STATUS", [["CODE", "0"], ["SEVERITY", "INFO"]]], statement]]]],
  ];

  const body = (xml: boolean) => `<OFX>\n${ofxElements(response, xml)}\n</OFX>\n`;
  return [
    {
      name: "statement-1x.ofx",
      bank: "ofx",
      text: `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n${body(false)}`,
    },
    {
      name: "statement-2x.ofx",
      bank: "ofx",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>\n${body(true)}`,
    },
  ];
}
