import { type AccountId, type ImportState, type ImportStatus, type ImportStatusFigures, type LocalDate, accountId, localDate, month } from "@holt/core";
import { kr, testId } from "@holt/core/testing";
import { describe, expect, it } from "vitest";
import { resultView, reviewLine } from "./ImportResult.model.ts";
import { english, importHousehold, noEntry, numbers, previewOf, replan, statement } from "./ImportTestKit.ts";

const [regninger, buffer] = [accountId(testId(1)), accountId(testId(2))] as [AccountId, AccountId];
const names = (id: AccountId) => (id === regninger ? "Regninger" : "Buffer");
const today = localDate("2026-11-06");
const planStart = month("2026-08");

const statuses = (...entries: (readonly [AccountId, ImportState, string | null])[]): ImportStatusFigures => ({
  due: entries.filter(([, state]) => state === "due").length,
  accounts: new Map(
    entries.map(([id, state, coversTo]): [AccountId, ImportStatus] => [id, { accountId: id, lastImport: null, coversTo: coversTo === null ? null : (coversTo as LocalDate), state, checkedOn: null }]),
  ),
});
const said = (figures: ImportStatusFigures | null) => {
  const line = figures === null ? null : reviewLine(figures, names, today, planStart);
  return line && english(line.words);
};

describe("whether last month's review has its figures", () => {
  it("says the review has its final figures when every account is up to date and reaches the end of last month", () => {
    expect(said(statuses([regninger, "upToDate", "2026-11-03"], [buffer, "upToDate", "2026-10-31"]))).toBe("Every account is now up to date, so the review of October has its final figures.");
  });

  it("does not promise the review when an account is up to date but stops short of the month's end", () => {
    expect(said(statuses([regninger, "upToDate", "2026-11-03"], [buffer, "upToDate", "2026-10-26"]))).toBe("Every account is now up to date.");
  });

  it("names the accounts that are not up to date yet, never reporting a partial set as done", () => {
    expect(said(statuses([regninger, "upToDate", "2026-11-03"], [buffer, "due", "2026-10-17"]))).toBe("Not up to date yet: Buffer.");
    expect(said(statuses([regninger, "notImported", null], [buffer, "due", "2026-10-17"]))).toBe("Not up to date yet: Regninger and Buffer.");
  });

  it("ticks only when every account is up to date", () => {
    const tone = (...entries: (readonly [AccountId, ImportState, string | null])[]) => reviewLine(statuses(...entries), names, today, planStart)?.tone;
    expect(tone([regninger, "upToDate", "2026-11-03"], [buffer, "upToDate", "2026-10-31"])).toBe("good");
    expect(tone([regninger, "upToDate", "2026-11-03"], [buffer, "due", "2026-10-17"])).toBe("waiting");
  });

  it("makes no claim about a month before the plan starts", () => {
    expect(english(reviewLine(statuses([regninger, "upToDate", "2026-11-03"]), names, today, month("2026-11"))!.words)).toBe("Every account is now up to date.");
  });

  it("says nothing before the figures have caught up", () => {
    expect(said(null)).toBeNull();
    expect(said(statuses())).toBeNull();
  });
});

describe("the result panel", () => {
  const h = importHousehold();
  const file = statement([
    { account: numbers.everyday, date: "2026-11-02", amount: kr(-120), description: "Kiwi Sentrum", counterparty: "Kiwi" },
    { account: numbers.everyday, date: "2026-11-03", amount: kr(-449), description: "Viaplay", counterparty: "Viaplay" },
    { account: numbers.bills, date: "2026-11-04", amount: kr(-80), description: "Reservert", pending: true },
  ]);
  const facts = h.facts();
  const accountName = (id: AccountId) => facts.accounts.get(id)?.name ?? "";
  const preview = previewOf(replan(facts, file, noEntry));
  const view = resultView({ preview, accountName, statuses: null, today, planStart });

  it("says how many transactions went to which account, and what else the import did", () => {
    expect(english(view.title)).toBe("Added 2 transactions to Everyday");
    expect(view.lines.map((l) => english(l))).toEqual(["The app kept 1 pending row aside until the bank books it."]);
    expect(view.needsYou).toBe(2);
  });

  it("gives each account's balance check its own line", () => {
    expect(view.balances.map((b) => [b.name, b.view.status])).toEqual([
      ["Everyday", "notChecked"],
      ["Bills", "notChecked"],
    ]);
  });
});
