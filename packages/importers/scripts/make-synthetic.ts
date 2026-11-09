// Writes synthetic bank exports in each bank's exact format to fixtures/synthetic/.
// Every name, account number and amount is invented; nothing here comes from a real export.
// Run: node packages/importers/scripts/make-synthetic.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(import.meta.dirname, "..", "fixtures", "synthetic");

// A small seeded generator, so the files are the same on every run.
let seed = 20261109;
function random(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));

/** Øre to the banks' "1234,56". */
const kroner = (ore: number) => `${ore < 0 ? "-" : ""}${Math.floor(Math.abs(ore) / 100)},${String(Math.abs(ore) % 100).padStart(2, "0")}`;
const iso = (month: number, day: number) => `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const norwegian = (month: number, day: number) => `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.2026`;

// Invented accounts. Bulder writes 1234.56.78901; SpareBank 1 writes 12345678901.
const bulderAccounts = {
  everyday: { name: "BRUKSKONTO", number: "9710.11.10001" },
  bills: { name: "Regninger", number: "9710.11.10002" },
  food: { name: "Mat", number: "9710.11.10003" },
  holiday: { name: "Ferie ", number: "9710.11.10004" },
};
const sr = { loanPayments: "97200020001", deposit: "97200020002", houseLoan: "97200020003" };
const employer = "97300030001";
const shops = ["Nærbutikken Fjord", "Kaffebaren Torget", "Bokhandel Strand", "Byggvare Nord", "Apoteket Sentrum"];
const bills = [
  { name: "Fjordstrøm Energi", number: "9740.40.40001", kid: "0012345678903", type: "Avtalegiro" },
  { name: "Nettbredd Bredbånd", number: "9740.40.40002", kid: "0098765432105", type: "Efaktura" },
];

type BulderRow = {
  date: string;
  amount: number;
  original?: { amount: number; currency: string };
  to?: { name: string; number: string };
  from?: { name: string; number: string };
  type: string;
  text: string;
  kid?: string;
  category?: [string, string];
};
const bulderRows: BulderRow[] = [];

for (let month = 1; month <= 10; month++) {
  bulderRows.push({ date: iso(month, 20), amount: 4_250_000, to: bulderAccounts.everyday, from: { name: "", number: "9730.00.30001" }, type: "Inntekt", text: "Lønn Eksempel AS", category: ["Inntekter", "Lønn"] });
  for (const bill of bills) {
    const amount = -between(40_000, 180_000);
    bulderRows.push({ date: iso(month, 15), amount, to: { name: "", number: bill.number }, from: bulderAccounts.bills, type: bill.type, text: bill.name, kid: bill.kid, category: ["Bolig", "Strøm"] });
  }
  // A transfer between two of the household's Bulder accounts: one row on each account.
  const move = between(500_000, 900_000);
  for (const amount of [-move, move]) {
    bulderRows.push({ date: iso(month, 21), amount, to: bulderAccounts.food, from: bulderAccounts.everyday, type: "Overføring", text: "Overførsel" });
  }
  for (let i = 0; i < 6; i++) {
    const shop = pick(shops);
    bulderRows.push({ date: iso(month, between(1, 28)), amount: -between(2_500, 95_000), to: { name: "", number: shop }, from: bulderAccounts.food, type: "Betaling", text: shop, category: ["Mat", "Dagligvarer"] });
  }
  // Two identical small savings transfers on the same day: real repeats, not duplicates.
  for (let copy = 0; copy < 2; copy++) {
    for (const amount of [-2_000, 2_000]) {
      bulderRows.push({ date: iso(month, 3), amount, to: bulderAccounts.holiday, from: bulderAccounts.everyday, type: "Overføring", text: "Mikrospar til Ferie" });
    }
  }
  // An e-invoice for nothing.
  bulderRows.push({ date: iso(month, 16), amount: 0, to: { name: "", number: "9750.50.50001" }, from: bulderAccounts.everyday, type: "Efaktura", text: "Eksempel Borettslag" });
  // The monthly loan payment, to the household's SpareBank 1 account.
  bulderRows.push({ date: iso(month, 20), amount: -941_200, to: { name: "", number: "9720.00.20001" }, from: bulderAccounts.bills, type: "Betaling", text: "9720.00.20001" });
}
// Purchases abroad: the amount is in kroner; the original amount and currency are information.
bulderRows.push({ date: iso(7, 9), amount: -16_460, original: { amount: -1_511, currency: "USD" }, to: { name: "", number: "Example Store" }, from: bulderAccounts.everyday, type: "Betaling", text: "Example Store" });
bulderRows.push({ date: iso(7, 11), amount: -5_166, original: { amount: -440, currency: "EUR" }, to: { name: "", number: "Café Exemple" }, from: bulderAccounts.everyday, type: "Betaling", text: "Café Exemple" });
bulderRows.push({ date: iso(1, 1), amount: 100, to: bulderAccounts.everyday, type: "Renter", text: "KREDITRENTER", category: ["Inntekter", "Renter"] });
bulderRows.sort((a, b) => a.date.localeCompare(b.date));

const bulderHeader = "Dato;Beløp;Originalt Beløp;Original Valuta;Til konto;Til kontonummer;Fra konto;Fra kontonummer;Type;Tekst;KID;Hovedkategori;Underkategori";
const bulderCsv = [
  bulderHeader,
  ...bulderRows.map((r) =>
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
  ),
].join("\n");

// SpareBank 1: one file per account, newest first, a byte-order mark, every field quoted, and a trailing semicolon.
type SrRow = { date: string; text: string; interestDate?: string; amount: number; to: string; from: string };
const quote = (s: string) => `"${s}"`;
function sparebank1Csv(rows: SrRow[]): string {
  const lines = rows.map((r) =>
    [
      quote(r.date),
      quote(r.text),
      r.interestDate ? quote(r.interestDate) : "",
      r.amount > 0 ? quote(kroner(r.amount)) : "",
      r.amount <= 0 ? quote(kroner(r.amount)) : "",
      quote(r.to),
      r.from ? quote(r.from) : "",
    ].join(";") + ";",
  );
  return "﻿Dato;Beskrivelse;Rentedato;Inn;Ut;Til konto;Fra konto;\n" + lines.join("\n") + "\n";
}

const loanPayments: SrRow[] = [];
for (let month = 10; month >= 1; month--) {
  const interestDate = month >= 9 ? norwegian(month, 22) : undefined;
  loanPayments.push({ date: norwegian(month, 22), text: `Til :${sr.houseLoan}`, ...(interestDate ? { interestDate } : {}), amount: -941_200, to: sr.houseLoan, from: sr.loanPayments });
  loanPayments.push({ date: norwegian(month, 20), text: "Eksempel Person", ...(interestDate ? { interestDate: norwegian(month, 20) } : {}), amount: 941_200, to: sr.loanPayments, from: "97100010002" });
}
const deposit: SrRow[] = [
  { date: "31.12.2025", text: "KREDITRENTER", amount: 61_700, to: sr.deposit, from: "" },
  { date: "03.01.2025", text: "Eksempel Person", amount: 3_150_000, to: sr.deposit, from: employer },
];

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "bulder.csv"), bulderCsv + "\n");
writeFileSync(join(out, "sparebank1-loan-payments.csv"), sparebank1Csv(loanPayments));
writeFileSync(join(out, "sparebank1-deposit.csv"), sparebank1Csv(deposit));
console.log(`Wrote ${bulderRows.length} Bulder rows and ${loanPayments.length + deposit.length} SpareBank 1 rows to ${out}`);
