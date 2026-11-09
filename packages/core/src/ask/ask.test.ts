import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { currency, money } from "../money.ts";
import { type QueryableTransaction, evaluateTransactionQuery, resolvePeriod } from "./evaluate.ts";
import { AskReply, type Filter, type TransactionQuery } from "./query.ts";

const context = { today: "2026-11-09", currency: currency("NOK") };
const kr = (major: number) => money(Math.round(major * 100));
let next = 0;
const tx = (t: Partial<QueryableTransaction> & Pick<QueryableTransaction, "bookingDate" | "amount">): QueryableTransaction => ({
  id: `t${++next}`,
  account: "Everyday",
  counterparty: "",
  description: "",
  transfer: false,
  ...t,
});

// Invented household data: a corner shop, an energy company, a café abroad, and moves between the household's accounts.
const transactions: QueryableTransaction[] = [
  tx({ bookingDate: "2026-08-04", amount: kr(-412.5), counterparty: "Nærbutikken", job: "Groceries" }),
  tx({ bookingDate: "2026-09-12", amount: kr(-301), counterparty: "NÆRBUTIKKEN SENTRUM", job: "Groceries" }), // a Saturday
  tx({ bookingDate: "2026-10-03", amount: kr(-1620), counterparty: "Nærbutikken", job: "Groceries" }), // a Saturday
  tx({ bookingDate: "2026-10-05", amount: kr(-210), counterparty: "Nærbutikken", job: "Groceries" }), // a Monday
  tx({ bookingDate: "2026-10-11", amount: kr(-5400), counterparty: "Fjordstrøm Energi", job: "Electricity", account: "Bills" }), // a Sunday
  tx({ bookingDate: "2026-10-20", amount: kr(42500), counterparty: "Eksempel AS", description: "Lønn" }),
  tx({ bookingDate: "2026-10-21", amount: kr(-8000), counterparty: "Food", transfer: true }),
  tx({ bookingDate: "2026-10-21", amount: kr(8000), counterparty: "Everyday", account: "Food", transfer: true }),
  tx({ bookingDate: "2026-07-09", amount: kr(-164.6), counterparty: "Café Exemple", originalCurrency: "EUR" }),
  tx({ bookingDate: "2026-07-10", amount: kr(-51.66), counterparty: "Example Store", originalCurrency: "USD" }),
  tx({ bookingDate: "2026-06-30", amount: kr(1), counterparty: "", description: "KREDITRENTER" }),
];

const query = (q: Omit<TransactionQuery, "kind">): TransactionQuery => ({ kind: "transactions", ...q });
const run = (q: Omit<TransactionQuery, "kind">) => evaluateTransactionQuery(query(q), transactions, context);
const amountOf = (r: ReturnType<typeof run>) => (r.value.kind === "money" ? r.value.amount : Number.NaN);

describe("the reply schema", () => {
  it("accepts each kind of step", () => {
    const reply = {
      steps: [
        { kind: "transactions", filter: { period: { type: "month", month: "2026-10" }, jobs: ["Groceries"], transfers: "exclude" }, measure: "sum" },
        { kind: "figure", figure: "job", job: "Food", month: "this-month", measure: "left" },
        { kind: "elsewhere", screen: "recurring-costs" },
      ],
    };
    expect(AskReply.safeParse(reply).success).toBe(true);
    expect(AskReply.safeParse({ steps: [{ kind: "cannot", reason: "advice" }] }).success).toBe(true);
  });

  it("refuses an impossible month, an unknown figure, a figure without its job, and an empty reply", () => {
    const filter = { period: { type: "month", month: "2026-13" }, transfers: "exclude" };
    expect(AskReply.safeParse({ steps: [{ kind: "transactions", filter, measure: "sum" }] }).success).toBe(false);
    expect(AskReply.safeParse({ steps: [{ kind: "figure", figure: "mood", month: "this-month" }] }).success).toBe(false);
    expect(AskReply.safeParse({ steps: [{ kind: "figure", figure: "job", month: "this-month", measure: "left" }] }).success).toBe(false);
    expect(AskReply.safeParse({ steps: [] }).success).toBe(false);
  });

  it("becomes a JSON Schema for the runtime's constrained decoding", () => {
    const schema = JSON.stringify(z.toJSONSchema(AskReply));
    for (const kind of ["transactions", "figure", "elsewhere", "cannot"]) expect(schema).toContain(`"${kind}"`);
  });
});

describe("periods", () => {
  it("resolve relative to today, never by the model", () => {
    expect(resolvePeriod({ type: "last-months", count: 3 }, "2026-11-09")).toEqual({ from: "2026-08-01", to: "2026-10-31" });
    expect(resolvePeriod({ type: "last-month" }, "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolvePeriod({ type: "this-month" }, "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(resolvePeriod({ type: "this-year" }, "2026-11-09")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("transaction queries", () => {
  it("sum what a counterparty was paid, matching names whatever their case", () => {
    const r = run({ filter: { period: { type: "last-months", count: 3 }, counterparties: ["nærbutikken"], transfers: "exclude" }, measure: "sum" });
    expect(amountOf(r)).toBe(kr(-412.5 - 301 - 1620 - 210));
    expect(r.matched).toHaveLength(4);
  });

  it("count, and average to the nearest øre", () => {
    const filter: Filter = { period: { type: "month", month: "2026-10" }, counterparties: ["Nærbutikken"], transfers: "exclude" };
    expect(run({ filter, measure: "count" }).value).toEqual({ kind: "count", count: 2 });
    expect(amountOf(run({ filter: { ...filter, period: { type: "range", from: "2026-08-01", to: "2026-10-31" } }, measure: "average" }))).toBe(kr(-635.88));
  });

  it("filter by weekday: food at weekends in October", () => {
    const r = run({ filter: { period: { type: "month", month: "2026-10" }, jobs: ["Groceries"], weekdays: ["sat", "sun"], transfers: "exclude" }, measure: "sum" });
    expect(amountOf(r)).toBe(kr(-1620));
  });

  it("leave out moves between the household's own accounts unless asked", () => {
    const filter = { period: { type: "month", month: "2026-10" }, direction: "in" } as const;
    expect(amountOf(run({ filter: { ...filter, transfers: "exclude" }, measure: "sum" }))).toBe(kr(42500));
    expect(amountOf(run({ filter: { ...filter, transfers: "only" }, measure: "sum" }))).toBe(kr(8000));
  });

  it("list payments over a threshold in kroner, largest first", () => {
    const r = run({ filter: { period: { type: "month", month: "2026-10" }, direction: "out", amount: { atLeast: 5000 }, transfers: "exclude" }, measure: "list", top: 10 });
    expect(r.matched.map((t) => t.counterparty)).toEqual(["Fjordstrøm Energi"]);
  });

  it("group purchases abroad by currency", () => {
    const r = run({ filter: { period: { type: "this-year" }, foreign: true, transfers: "exclude" }, measure: "sum", groupBy: "currency" });
    expect(r.groups?.map((g) => [g.key, g.value])).toEqual([
      ["EUR", { kind: "money", amount: kr(-164.6) }],
      ["USD", { kind: "money", amount: kr(-51.66) }],
    ]);
  });

  it("put the largest counterparties first when asked for the top ones", () => {
    const r = run({ filter: { period: { type: "month", month: "2026-10" }, direction: "out", transfers: "exclude" }, measure: "sum", groupBy: "counterparty", top: 1 });
    expect(r.groups?.map((g) => g.key)).toEqual(["Fjordstrøm Energi"]);
  });

  it("give months in order, and a monthly average over the whole period", () => {
    const filter: Filter = { period: { type: "last-months", count: 3 }, jobs: ["Groceries"], transfers: "exclude" };
    expect(run({ filter, measure: "sum", groupBy: "month" }).groups?.map((g) => g.key)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(amountOf(run({ filter, measure: "monthly-average" }))).toBe(kr(-847.83));
  });

  it("find interest by the bank's description", () => {
    expect(amountOf(run({ filter: { period: { type: "this-year" }, text: ["kreditrenter"], direction: "in", transfers: "exclude" }, measure: "sum" }))).toBe(kr(1));
  });
});

// Properties that must hold for any transactions, not just the examples above.
const arbitraryTransaction = fc.record({
  id: fc.uuid(),
  account: fc.constantFrom("Everyday", "Bills", "Food"),
  bookingDate: fc.date({ min: new Date("2026-01-01T00:00:00Z"), max: new Date("2026-12-31T00:00:00Z"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10)),
  amount: fc.integer({ min: -5_000_000, max: 5_000_000 }).map(money),
  counterparty: fc.constantFrom("Nærbutikken", "Fjordstrøm Energi", "Eksempel AS"),
  description: fc.constant(""),
  transfer: fc.boolean(),
});

describe("properties", () => {
  it("group totals add up to the overall total", () => {
    fc.assert(
      fc.property(fc.array(arbitraryTransaction, { maxLength: 60 }), fc.constantFrom("month", "counterparty", "account"), (rows, groupBy) => {
        const r = evaluateTransactionQuery(query({ filter: { period: { type: "this-year" }, transfers: "include" }, measure: "sum", groupBy }), rows, context);
        const groupTotal = (r.groups ?? []).reduce((sum, g) => sum + (g.value.kind === "money" ? g.value.amount : 0), 0);
        expect(groupTotal).toBe(amountOf(r));
      }),
    );
  });

  it("money in and money out together are everything that isn't zero", () => {
    fc.assert(
      fc.property(fc.array(arbitraryTransaction, { maxLength: 60 }), (rows) => {
        const count = (direction?: "in" | "out") =>
          evaluateTransactionQuery(query({ filter: { period: { type: "this-year" }, transfers: "include", ...(direction ? { direction } : {}) }, measure: "count" }), rows, context).value;
        const all = count();
        const zero = rows.filter((t) => t.amount === 0).length;
        expect([count("in"), count("out")].reduce((n, v) => n + (v.kind === "count" ? v.count : 0), 0)).toBe((all.kind === "count" ? all.count : 0) - zero);
      }),
    );
  });
});
