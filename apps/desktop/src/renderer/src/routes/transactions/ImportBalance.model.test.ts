import { type BalanceCheck, type LikelyCause, accountId, importRowId, localDate, moveId, money, transactionId } from "@holt/core";
import { kr, testId } from "@holt/core/testing";
import { describe, expect, it } from "vitest";
import { balanceView, causeWords } from "./ImportBalance.model.ts";
import { english, importHousehold, noEntry, numbers, previewOf, replan, statement } from "./ImportTestKit.ts";

const account = accountId(testId(1));
const said = (check: BalanceCheck) => {
  const view = balanceView(check, "Regninger");
  return { status: view.status, result: english(view.result), causes: view.causes.map((c) => english(c)), note: view.note && english(view.note) };
};
const base = { accountId: account, asOf: localDate("2026-11-06"), entered: kr(24_960), calculated: kr(24_960) };

describe("the balance check in words", () => {
  it("says it matches, with the balance the family typed", () => {
    expect(said({ kind: "matches", ...base })).toEqual({ status: "matches", result: "Balance matches the bank: 24,960 kr", causes: [], note: null });
  });

  it("says how far apart the two are, whichever is larger, and that the app adjusts nothing", () => {
    const above = said({ kind: "differs", ...base, calculated: kr(24_800), difference: kr(160), causes: [] });
    const below = said({ kind: "differs", ...base, calculated: kr(25_100), difference: kr(-140), causes: [] });
    expect(above.result).toBe("The balance differs by 160 kr. Your bank shows 24,960 kr and the app works out 24,800 kr.");
    expect(below.result).toBe("The balance differs by 140 kr. Your bank shows 24,960 kr and the app works out 25,100 kr.");
    expect(above.note).toBe("The app flags this account for you to look at. It adjusts nothing, and you can still add the file.");
    expect(above.causes).toEqual(["The app can't see a likely cause. Check the date and the amount you typed."]);
  });

  it("says an unchecked account is not checked, and that being up to date by its dates is not a check against the bank", () => {
    expect(said({ kind: "notChecked", accountId: account })).toMatchObject({
      result: "Not checked",
      note: "Until you type a balance, Regninger counts as up to date by its dates, but nothing has checked it against your bank.",
    });
  });
});

describe("the likely causes", () => {
  const rows = [importRowId(testId(5)), importRowId(testId(6))];
  const causes: LikelyCause[] = [
    { kind: "gap", from: localDate("2026-10-01"), to: localDate("2026-10-17") },
    { kind: "nearDuplicate", transactionId: transactionId(testId(7)), of: transactionId(testId(8)) },
    { kind: "nearDuplicate", transactionId: transactionId(testId(9)), of: transactionId(testId(10)) },
    { kind: "pending", rows, amount: kr(-1_200) },
    { kind: "moveToDo", moveId: moveId(testId(11)) },
  ];

  it("names a gap between imports, a possible duplicate, a pending row and a move not made yet, in plain words", () => {
    expect(causeWords(causes).map((w) => english(w))).toEqual([
      "No import covers 1 Oct to 17 Oct, so the app may be missing transactions.",
      "2 transactions may each be the same as one you already have.",
      "2 pending rows worth -1,200 kr may count in the balance your bank shows. The app keeps pending rows aside until the bank books them.",
      "A move at the bank into or out of this account is still to do.",
    ]);
  });

  it("adds the counts up instead of repeating a sentence", () => {
    const twoMoves: LikelyCause[] = [
      { kind: "moveToDo", moveId: moveId(testId(11)) },
      { kind: "moveToDo", moveId: moveId(testId(12)) },
    ];
    expect(causeWords(twoMoves).map((w) => english(w))).toEqual(["2 moves at the bank into or out of this account are still to do."]);
    expect(causeWords([])).toEqual([]);
  });
});

describe("against a real plan", () => {
  const h = importHousehold();
  const file = statement([{ account: numbers.everyday, date: "2026-11-02", amount: kr(-120), description: "Kiwi Sentrum", counterparty: "Kiwi" }]);
  const checkFor = (text: number | null) => {
    const entry = { ...noEntry, balances: text === null ? [] : [{ accountId: h.accounts.everyday, value: money(text), asOf: localDate("2026-11-09") }] };
    const preview = previewOf(replan(h.facts(), file, entry));
    const line = preview.accounts.find((a) => a.accountId === h.accounts.everyday);
    if (line === undefined) throw new Error("expected the account");
    return balanceView(line.balance, "Everyday");
  };

  it("matches the balance the app works out from the opening balance and the file", () => {
    expect(checkFor(kr(10_000 - 120)).status).toBe("matches");
  });

  it("flags a balance that is off and still has something to say about it", () => {
    const view = checkFor(kr(9_000));
    expect(view.status).toBe("differs");
    expect(english(view.result)).toContain("differs by 880 kr");
    expect(view.causes.length).toBeGreaterThan(0);
  });

  it("is not checked when nothing was typed", () => {
    expect(checkFor(null).status).toBe("notChecked");
  });
});
