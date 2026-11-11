import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type StatementRow, daysBetween, localDate } from "@holt/core";
import { describe, expect, it } from "vitest";
import { type ParsedStatement, recogniseFormat } from "./index.ts";
import {
  dotted,
  syntheticAccounts,
  syntheticChildSaving,
  syntheticContributions,
  syntheticElectricityBills,
  syntheticFixtureOptions,
  syntheticOfx,
  syntheticStatements,
} from "./synthetic.ts";

const fixtures = join(import.meta.dirname, "..", "fixtures", "synthetic");
const options = syntheticFixtureOptions;
const statements = syntheticStatements(options);

function parse(text: string): ParsedStatement {
  const format = recogniseFormat(text);
  if (format === null) throw new Error("No format recognised the file.");
  return format.parse(text);
}
const file = (name: string) => {
  const found = statements.files.find((f) => f.name === name);
  if (found === undefined) throw new Error(`No synthetic file ${name}`);
  return found;
};
const rows = (name: string) => parse(file(name).text).rows;

/** How many rows share each account, day, amount and description. */
function counts(list: readonly StatementRow[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const r of list) {
    const key = [r.account, r.bookingDate, r.amount, r.description].join("|");
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}

describe("the synthetic statements", () => {
  it("are the same text every time for the same options, and change with the seed", () => {
    expect(syntheticStatements(options).files).toEqual(statements.files);
    const other = syntheticStatements({ ...options, seed: options.seed + 1 });
    expect(other.files.find((f) => f.name === "bulder.csv")?.text).not.toBe(file("bulder.csv").text);
  });

  it("match the committed fixtures, so the script's output is current", () => {
    for (const f of [...statements.files, ...syntheticOfx(options)]) {
      expect(readFileSync(join(fixtures, f.name), "utf8"), f.name).toBe(f.text);
    }
  });

  it("are read by the format for their bank, every row", () => {
    for (const f of statements.files) {
      const format = recogniseFormat(f.text);
      expect(format?.id, f.name).toBe(f.bank === "bulder" ? "bulder-csv" : "sparebank1-csv");
      expect(format?.parse(f.text).accountCurrency).toBe("NOK");
    }
  });

  it("use only the household's accounts and the invented outside ones", () => {
    const household = new Set<string>([...Object.values(syntheticAccounts.bulder), ...Object.values(syntheticAccounts.sparebank1)].map((a) => a.number));
    const outside = new Set<string>([...Object.values(syntheticAccounts.outside), ...Object.values(syntheticAccounts.children)].map((a) => a.number));
    for (const f of statements.files) {
      for (const r of parse(f.text).rows) {
        expect(household.has(r.account), `${f.name} line ${r.line}`).toBe(true);
        if (r.counterpartAccount) expect(household.has(r.counterpartAccount) || outside.has(r.counterpartAccount), `${f.name} line ${r.line}`).toBe(true);
      }
    }
    expect(dotted(syntheticAccounts.bulder.everyday.number)).toBe("9710.11.10001");
  });

  it("cover only the days asked for", () => {
    const narrow = syntheticStatements({ from: localDate("2026-03-01"), to: localDate("2026-04-30"), seed: 7 });
    for (const f of narrow.files) {
      for (const r of parse(f.text).rows) expect(r.bookingDate >= "2026-03-01" && r.bookingDate <= "2026-04-30", `${f.name} line ${r.line}`).toBe(true);
    }
  });

  it("give a month the same rows whatever range it is generated in", () => {
    const wide = syntheticStatements(options);
    const narrow = syntheticStatements({ ...options, from: localDate("2026-03-01") });
    const march = (text: string) => parse(text).rows.filter((r) => r.bookingDate >= "2026-03-01" && r.bookingDate <= "2026-03-31").map((r) => [r.line > 0, r.account, r.bookingDate, r.amount, r.description]);
    expect(march(narrow.files[0]!.text)).toEqual(march(wide.files[0]!.text));
  });

  it("still make files when the range is a single day: pay day, the contributions and the children's savings, the loan payment, and the payment arriving at SpareBank 1", () => {
    const day = syntheticStatements({ from: localDate("2026-03-20"), to: localDate("2026-03-20"), seed: 1 });
    expect(day.files.map((f) => [f.name, parse(f.text).rows.length])).toEqual([
      ["bulder.csv", 0],
      ["bulder-later.csv", 8],
      ["sparebank1-loan-payments.csv", 1],
      ["sparebank1-deposit.csv", 0],
    ]);
  });
});

describe("the hazards in the Bulder files", () => {
  const older = rows("bulder.csv");
  const newer = rows("bulder-later.csv");

  it("have identical rows on one day, up to three", () => {
    const sizes = [...counts(older).values()];
    expect(Math.max(...sizes)).toBe(3);
    expect(sizes.filter((n) => n > 1).length).toBeGreaterThanOrEqual(3);
  });

  it("have a zero-kroner e-invoice on the account that pays it", () => {
    const zero = older.filter((r) => r.amount === 0);
    expect(zero.length).toBeGreaterThan(0);
    expect(new Set(zero.map((r) => [r.account, r.bankType].join("|")))).toEqual(new Set([`${syntheticAccounts.bulder.everyday.number}|Efaktura`]));
  });

  it("have a purchase in a foreign currency, in kroner with the original as information", () => {
    const abroad = older.filter((r) => r.original !== undefined);
    expect(abroad.map((r) => [r.amount, r.original?.currency])).toEqual([
      [-16_460, "USD"],
      [-5_166, "EUR"],
    ]);
  });

  it("have a transfer between two of the household's accounts once on each account", () => {
    const sent = older.filter((r) => r.description === "Overførsel" && r.amount < 0);
    expect(sent.length).toBeGreaterThan(0);
    for (const out of sent) {
      const into = older.filter((r) => r.description === "Overførsel" && r.bookingDate === out.bookingDate && r.amount === -out.amount);
      expect(into).toHaveLength(1);
      expect(into[0]?.account).not.toBe(out.account);
      expect(out.counterpartAccount).toBe(into[0]?.account);
    }
  });

  it("have a monthly payment that leaves Bulder and arrives in SpareBank 1 on the same day", () => {
    const leaving = older.filter((r) => r.amount === -941_200);
    const arriving = rows("sparebank1-loan-payments.csv").filter((r) => r.amount === 941_200);
    expect(leaving.length).toBeGreaterThan(5);
    for (const out of leaving) {
      expect(arriving.filter((r) => r.bookingDate === out.bookingDate && r.counterpartAccount === out.account)).toHaveLength(1);
    }
  });

  it("give a second file that overlaps the first by two weeks, with the same rows in the overlap", () => {
    const olderLast = older.at(-1)!.bookingDate;
    const newerFirst = newer[0]!.bookingDate;
    const overlap = (list: readonly StatementRow[]) => list.filter((r) => r.bookingDate >= newerFirst && r.bookingDate <= olderLast);
    expect(daysBetween(newerFirst, olderLast)).toBeGreaterThanOrEqual(10);
    expect(daysBetween(newerFirst, olderLast)).toBeLessThanOrEqual(13);
    expect(overlap(older).length).toBeGreaterThan(5);
    expect(counts(overlap(newer))).toEqual(counts(overlap(older)));
    expect(newer.at(-1)!.bookingDate > olderLast).toBe(true);
  });

  it("have rows that repeat in the overlap and so need matching by count", () => {
    const olderLast = older.at(-1)!.bookingDate;
    const repeated = [...counts(newer.filter((r) => r.bookingDate <= olderLast))].filter(([, n]) => n > 1);
    expect(repeated.length).toBeGreaterThan(0);
  });
});

describe("what the household's year holds", () => {
  const older = rows("bulder.csv");
  const newer = rows("bulder-later.csv");
  const merged = [...older, ...newer.filter((r) => r.bookingDate > older.at(-1)!.bookingDate)];
  const month = (m: string) => merged.filter((r) => r.bookingDate.startsWith(m));
  const months = Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);

  it("has an electricity bill on the 15th of each month, shaped like the Plan mockup: 28,800 kroner from January to October", () => {
    const bills = months.map((m) => month(m).filter((r) => r.description === "Fjordstrøm Energi"));
    for (const [i, bill] of bills.entries()) {
      expect(bill, months[i]).toHaveLength(1);
      expect(bill[0]).toMatchObject({ bookingDate: `${months[i]}-15`, amount: -syntheticElectricityBills[i]! * 100, account: syntheticAccounts.bulder.bills.number });
    }
    expect(bills.reduce((sum, [bill]) => sum - bill!.amount, 0)).toBe(2_880_000);
  });

  it("has the winter dear and the summer cheap, and 36,300 kroner for the twelve months from November", () => {
    const [jan, feb, , , , jun, jul, , , , nov, dec] = syntheticElectricityBills;
    expect(Math.min(jan, feb, nov, dec)).toBeGreaterThan(Math.max(jun, jul) * 1.5);
    expect(syntheticElectricityBills.reduce((sum, kroner) => sum + kroner, 0)).toBe(36_300);
  });

  it("has each adult's contribution on the 20th, the second adult's in two parts, into the everyday account", () => {
    for (const m of months) {
      for (const { name, parts } of syntheticContributions) {
        const paid = month(m).filter((r) => r.description.startsWith(`Fra: ${name} `));
        expect(paid.map((r) => [r.bookingDate.slice(8), r.amount]), `${name} ${m}`).toEqual(parts.map((p) => [String(p.day), p.kroner * 100]));
        for (const r of paid) expect(r.account).toBe(syntheticAccounts.bulder.everyday.number);
        expect(paid[0]?.counterparty).toBe(name);
      }
    }
    expect(syntheticContributions.map(({ parts }) => parts.reduce((sum, p) => sum + p.kroner, 0))).toEqual([32_000, 28_000]);
  });

  it("has a payment into each child's savings account on the 20th", () => {
    for (const m of months) {
      const paid = month(m).filter((r) => r.description.startsWith("Barnesparing "));
      expect(paid.map((r) => r.description)).toEqual(["Barnesparing Eldest", "Barnesparing Second", "Barnesparing Third", "Barnesparing Youngest"]);
      expect(paid.map((r) => r.counterpartAccount)).toEqual(Object.values(syntheticAccounts.children).map((a) => a.number));
      for (const r of paid) expect([r.bookingDate, r.amount, r.account]).toEqual([`${m}-20`, -syntheticChildSaving * 100, syntheticAccounts.bulder.everyday.number]);
    }
  });
});

describe("where the older Bulder file ends", () => {
  const lastDays = ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31"];

  it("is the day it is told to, with the newer file starting two weeks before", () => {
    const { files } = syntheticStatements({ ...options, olderEnd: localDate("2026-10-22") });
    const [older, newer] = [parse(files[0]!.text).rows, parse(files[1]!.text).rows];
    expect(older.at(-1)?.bookingDate).toBe("2026-10-22");
    expect(newer[0]?.bookingDate).toBe("2026-10-09");
  });

  it("can be the 22nd, so the adults' payments on the 20th and 22nd are in it, and the newer file still has a row the older lacks, whatever the month", () => {
    for (const to of lastDays) {
      const olderEnd = localDate(`${to.slice(0, 7)}-22`);
      const { files } = syntheticStatements({ from: localDate("2026-01-01"), to: localDate(to), seed: options.seed, olderEnd });
      const [older, newer] = [parse(files[0]!.text).rows, parse(files[1]!.text).rows];
      const paid = older.filter((r) => r.bookingDate.startsWith(to.slice(0, 7)) && r.description.startsWith("Fra: Partner "));
      expect(paid.map((r) => r.bookingDate.slice(8)), to).toEqual(["20", "22"]);
      expect(newer.some((r) => r.bookingDate > olderEnd), to).toBe(true);
    }
  });
});

describe("the SpareBank 1 files", () => {
  it("state the interest date on the newer rows only", () => {
    const loan = rows("sparebank1-loan-payments.csv");
    expect(loan[0]?.interestDate).toBeDefined();
    expect(loan.at(-1)?.interestDate).toBeUndefined();
  });
});

describe("the synthetic OFX files", () => {
  const [sgml, xml] = syntheticOfx(options);

  it("give one account's statement in OFX 1.x and in 2.x, with the same rows", () => {
    expect([sgml?.name, xml?.name]).toEqual(["statement-1x.ofx", "statement-2x.ofx"]);
    const [a, b] = [parse(sgml!.text), parse(xml!.text)];
    expect(a.rows.length).toBeGreaterThan(0);
    expect(b.rows.map(({ line: _, ...r }) => r)).toEqual(a.rows.map(({ line: _, ...r }) => r));
    expect(new Set(a.rows.map((r) => r.account))).toEqual(new Set([syntheticAccounts.ofx.number]));
  });

  it("are not in the household's accounts, so importing the others never meets them", () => {
    const household = new Set<string>([...Object.values(syntheticAccounts.bulder), ...Object.values(syntheticAccounts.sparebank1)].map((a) => a.number));
    expect(household.has(syntheticAccounts.ofx.number)).toBe(false);
  });
});
