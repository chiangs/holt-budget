import { describe, expect, it } from "vitest";
import { localDate, month } from "../dates.ts";
import { type Facts, householdOf } from "../facts.ts";
import { enteredValueId, transactionId } from "../ids.ts";
import { currency } from "../money.ts";
import { accepted, today } from "../testing/command-household.ts";
import { factsBuilder, kr, setAmount, testId } from "../testing/facts-builder.ts";
import { type Command, apply } from "./apply.ts";

const EUR = currency("EUR");

function setUp(): { readonly facts: Facts; readonly everyday: ReturnType<ReturnType<typeof factsBuilder>["account"]> } {
  const b = factsBuilder({ planStart: "2026-11" });
  const everyday = b.account({ name: "Everyday" });
  b.buffer({ monthly: kr(1_000) });
  b.spendJob({ name: "Food", plan: setAmount(kr(5_000)) });
  return { facts: b.facts(), everyday };
}

const run = (facts: Facts, command: Command) => apply(facts, command, { asOf: today });

describe("the household's currency (decision 15)", () => {
  const { facts, everyday } = setUp();
  const payment: Command = {
    kind: "recordTransaction",
    transaction: { id: transactionId(testId(600_000)), accountId: everyday, bookingDate: today, amount: kr(-100), description: "Kiosk", treatment: { kind: "needsYou" } },
  };
  const value: Command = {
    kind: "enterValue",
    value: { id: enteredValueId(testId(600_001)), kind: "figure", subject: "gross-income", value: kr(60_000), unit: "money", asOf: today, source: "entered by you" },
  };

  it("can change while there are accounts and jobs but no transaction or entered value", () => {
    expect(householdOf(accepted(run(facts, { kind: "changeHousehold", changes: { currency: EUR } }))).currency).toBe(EUR);
  });

  it.each([
    ["a transaction", payment],
    ["an entered value", value],
  ])("is fixed once %s exists", (_, first) => {
    const withData = accepted(run(facts, first));
    expect(run(withData, { kind: "changeHousehold", changes: { currency: EUR } })).toMatchObject({ ok: false, refusal: { code: "currencyFixed" } });
    expect(run(withData, { kind: "changeHousehold", changes: { currency: householdOf(facts).currency, name: "Home" } }).ok).toBe(true);
  });
});

describe("the plan start (decision 10)", () => {
  const { facts, everyday } = setUp();

  it("can change before any month is opened or transaction exists", () => {
    expect(householdOf(accepted(run(facts, { kind: "changeHousehold", changes: { planStart: month("2026-12") } }))).planStart).toBe(month("2026-12"));
  });

  it("is fixed once a month is opened", () => {
    const opened = accepted(run(facts, { kind: "openMonth", month: month("2026-11") }));
    expect(run(opened, { kind: "changeHousehold", changes: { planStart: month("2026-12") } })).toMatchObject({ ok: false, refusal: { code: "planStartFixed" } });
  });

  it("is fixed once a transaction exists", () => {
    const history = accepted(
      run(facts, { kind: "recordTransaction", transaction: { id: transactionId(testId(600_002)), accountId: everyday, bookingDate: localDate("2026-10-03"), amount: kr(-90), description: "Kiosk", treatment: { kind: "history", jobId: null } } }),
    );
    expect(run(history, { kind: "changeHousehold", changes: { planStart: month("2026-10") } })).toMatchObject({ ok: false, refusal: { code: "planStartFixed" } });
  });
});
