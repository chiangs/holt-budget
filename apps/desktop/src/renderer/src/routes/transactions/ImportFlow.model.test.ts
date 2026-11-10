import { type Currency, type ImportBlock, type ImportPreview, type LocalDate, type Refusal, accountNumber, apply, currency, importBatchId, messageFor } from "@holt/core";
import { kr, testId } from "@holt/core/testing";
import { describe, expect, it } from "vitest";
import type { ImportOpened } from "../../../../shared/import-types.ts";
import type { ImportFailed } from "../../data/client.ts";
import { type Action, type Checking, type Flow, canAdd, commitOutcome, entryOf, flowReducer, planOutcome, refusedView, startFlow } from "./ImportFlow.model.ts";
import { english, importHousehold, noEntry, numbers, previewOf, replan, statement, today } from "./ImportTestKit.ts";

const nok: Currency = currency("NOK");
const h = importHousehold();
const facts = h.facts();
const file = statement([
  { account: numbers.everyday, date: "2026-11-02", amount: kr(-120), description: "Kiwi Sentrum", counterparty: "Kiwi" },
  { account: numbers.everyday, date: "2026-11-03", amount: kr(-449), description: "Viaplay", counterparty: "Viaplay" },
  { account: numbers.bills, date: "2026-11-05", amount: kr(-1_980), description: "Stavanger kommune", counterparty: "Stavanger kommune" },
]);
const firstPreview: ImportPreview = previewOf(replan(facts, file, noEntry));

const opened = (preview: ImportPreview = firstPreview): ImportOpened => ({ kind: "opened", session: "s1", fileName: "regninger.csv", preview });
const act = (flow: Flow, ...actions: Action[]): Flow => actions.reduce(flowReducer, flow);
const open = (result: ImportOpened | ImportFailed = opened()): Flow => flowReducer(startFlow, { type: "opened", result, currency: nok, today });
const checking = (flow: Flow): Checking => {
  if (flow.stage.kind !== "checking") throw new Error(`Expected checking, got ${flow.stage.kind}`);
  return flow.stage.check;
};
/** The main process's answer to the entry the page holds, as the page's next `planned` action. */
const planned = (flow: Flow): Action => {
  const check = checking(flow);
  return { type: "planned", version: check.version, result: { kind: "planned", preview: previewOf(replan(facts, file, entryOf(check).entry)) } };
};

describe("opening a file", () => {
  it("closes the dialog when the family cancels the first file window, and stores nothing", () => {
    expect(open({ kind: "cancelled" }).stage.kind).toBe("closed");
  });

  it("shows what the app read, with a balance field for each account the file touches, dated the file's last day", () => {
    const check = checking(open());
    expect(check.draft.balances.map((b) => [b.accountId, b.text, b.asOf])).toEqual(firstPreview.accounts.map((a) => [a.accountId, "", firstPreview.to]));
    expect(check.order).toEqual(firstPreview.sample.map((l) => l.line));
    expect(check.draft.suggest).toBe(true);
    expect(canAdd(check)).toBe(true);
  });

  it("tells a screen reader what the app read", () => {
    const { announcement } = open();
    expect(announcement && english(announcement)).toBe("The app read regninger.csv: 3 new, 0 skipped as duplicates, 3 need you.");
  });

  it("goes back to the preview when the family cancels the window for another file", () => {
    const before = open();
    const after = act(before, { type: "choose" }, { type: "opened", result: { kind: "cancelled" }, currency: nok, today });
    expect(after.stage).toEqual(before.stage);
  });

  it("replaces the preview with the reason when the other file can't be used", () => {
    const flow = act(open(), { type: "choose" }, { type: "opened", result: { kind: "unrecognised", fileName: "notes.txt" }, currency: nok, today });
    expect(flow.stage).toEqual({ kind: "refused", refused: { kind: "unrecognised", fileName: "notes.txt" } });
    expect(act(flow, { type: "choose" }).stage).toEqual({ kind: "waiting", back: null });
  });

  it("takes a new file's preview in place of the old one, with nothing carried over", () => {
    const typed = act(open(), { type: "typed", accountId: firstPreview.accounts[0]!.accountId, text: "9 000" });
    const second: ImportOpened = { kind: "opened", session: "s2", fileName: "second.csv", preview: firstPreview };
    const flow = act(typed, { type: "choose" }, { type: "opened", result: second, currency: nok, today });
    expect(checking(flow).draft.balances.every((b) => b.text === "")).toBe(true);
    expect([checking(flow).session, checking(flow).fileName]).toEqual(["s2", "second.csv"]);
  });
});

describe("what the family types", () => {
  const account = firstPreview.accounts[0]!.accountId;

  it("asks for a new preview when a balance changes the entry, and Add waits until it arrives", () => {
    const typed = act(open(), { type: "typed", accountId: account, text: "9 431" });
    expect(checking(typed).version).toBe(1);
    expect(canAdd(checking(typed))).toBe(false);
    const updated = act(typed, planned(typed));
    expect(canAdd(checking(updated))).toBe(true);
    expect(checking(updated).plannedVersion).toBe(1);
  });

  it("asks for nothing while the amount is only half typed", () => {
    const flow = act(open(), { type: "typed", accountId: account, text: "9 4x" });
    expect(checking(flow).version).toBe(0);
    expect(canAdd(checking(flow))).toBe(true);
  });

  it("ignores the reply to an older request, so a slow reply can't undo a newer edit", () => {
    const first = act(open(), { type: "typed", accountId: account, text: "9" });
    const stale = planned(first);
    const second = act(first, { type: "typed", accountId: account, text: "9 431" });
    const after = act(second, stale);
    expect(checking(after).plannedVersion).toBe(0);
    expect(canAdd(checking(after))).toBe(false);
    expect(checking(act(after, planned(after))).plannedVersion).toBe(2);
  });

  it("puts a job the family chose into the entry for that line, and the next preview shows it as theirs", () => {
    const line = firstPreview.sample.find((l) => l.description === "Viaplay")!;
    const chose = act(open(), { type: "chose", choice: { line: line.line, jobId: h.jobs.food, amount: line.amount } });
    expect(entryOf(checking(chose)).entry.choices).toEqual([{ line: line.line, treatment: { kind: "split", allocations: [{ jobId: h.jobs.food, amount: line.amount }] } }]);
    const after = act(chose, planned(chose));
    expect(checking(after).preview.counts.needsYou).toBe(firstPreview.counts.needsYou - 1);
    expect(checking(after).preview.sample.find((l) => l.line === line.line)).toMatchObject({ why: { kind: "chosen" } });
  });

  it("keeps each row where it was when the plan sorts it elsewhere", () => {
    const line = firstPreview.sample[0]!;
    const chose = act(open(), { type: "chose", choice: { line: line.line, jobId: h.jobs.food, amount: line.amount } });
    const after = act(chose, planned(chose));
    expect(checking(after).order).toEqual(firstPreview.sample.map((l) => l.line));
  });

  it("turns suggestions off and on through the entry", () => {
    const off = act(open(), { type: "suggested", on: false });
    expect(entryOf(checking(off)).entry.suggest).toBe(false);
    expect(checking(off).version).toBe(1);
  });

  it("lets go of a job the app can't give, tells the family, and plans again", () => {
    const chose = act(open(), { type: "chose", choice: { line: 2, jobId: h.jobs.food, amount: kr(-120) } });
    const blocked: Action = { type: "planned", version: checking(chose).version, result: { kind: "blocked", block: { kind: "badChoice", line: 2 } } };
    const after = act(chose, blocked);
    expect(entryOf(checking(after)).entry.choices).toEqual([]);
    expect(checking(after).version).toBeGreaterThan(checking(chose).version);
    expect(checking(after).message?.tone).toBe("note");
    expect(english(checking(after).message!.words)).toContain("line 2");
  });
});

describe("a balance that differs", () => {
  it("is flagged and does not stop Add", () => {
    const account = firstPreview.accounts[0]!.accountId;
    const typed = act(open(), { type: "typed", accountId: account, text: "1" });
    const updated = act(typed, planned(typed));
    expect(checking(updated).preview.accounts.find((a) => a.accountId === account)?.balance.kind).toBe("differs");
    expect(canAdd(checking(updated))).toBe(true);
    expect(act(updated, { type: "adding" }).stage.kind).toBe("adding");
  });
});

describe("adding", () => {
  const ready = () => open();
  const adding = () => act(ready(), { type: "adding" });
  /** What the main process answers once it has stored the file: the patch of the change, made from the plan it made on Add, with its own IDs. */
  const stored = () => {
    const plan = replan(facts, file, noEntry, "the-file", 600_000);
    if (!plan.ok) throw new Error("expected a plan");
    const result = apply(facts, plan.command, { asOf: today });
    if (!result.ok) throw new Error("expected the plan to apply");
    return { status: "applied", patch: result.patch, batchId: plan.preview.batchId } as const;
  };
  const applied = stored() as never;

  it("starts once, and only when the preview matches the entry", () => {
    const typed = act(ready(), { type: "typed", accountId: firstPreview.accounts[0]!.accountId, text: "9 431" });
    expect(act(typed, { type: "adding" }).stage.kind).toBe("checking");
    expect(act(adding(), { type: "adding" }).stage.kind).toBe("adding");
  });

  it("shows the result once the main process applied the change, and names the import it stored, not the one it previewed", () => {
    const { patch } = stored();
    const batch = patch.find((change) => change.table === "importBatches");
    const done = act(adding(), { type: "committed", result: { status: "applied", patch } as never });
    expect(done.stage).toMatchObject({ kind: "added", batchId: batch?.key });
    expect(batch?.key).not.toBe(firstPreview.batchId);
    expect(done.announcement && english(done.announcement)).toBe("The app added 3 transactions.");
  });

  it("keeps the file, the choices and the typed balances when the app refused the change, and says why", () => {
    const line = firstPreview.sample[0]!;
    const typed = act(open(), { type: "chose", choice: { line: line.line, jobId: h.jobs.food, amount: line.amount } });
    const refused: Refusal = { code: "importDisagrees", message: messageFor("importDisagrees") };
    const flow = act(typed, planned(typed), { type: "adding" }, { type: "committed", result: { status: "refused", refusal: refused } });
    const check = checking(flow);
    expect(check.session).toBe("s1");
    expect(check.draft.choices).toHaveLength(1);
    expect(check.message?.tone).toBe("problem");
    expect(english(check.message!.words)).toContain(messageFor("importDisagrees"));
  });

  const cases: readonly [string, Parameters<typeof commitOutcome>[0], string][] = [
    ["conflict", { status: "conflict" } as never, "trouble"],
    ["expired", { status: "expired" }, "refused"],
    ["a block that ends the file", { status: "blocked", block: { kind: "noRows" } }, "refused"],
    ["a block on one choice", { status: "blocked", block: { kind: "badChoice", line: 4 } }, "dropChoice"],
    ["a failed call", { status: "failed", failure: { code: "handler-failed", message: "x" } }, "trouble"],
    ["a call that never came back", { status: "failed", failure: { code: "unreachable", message: "x" } }, "trouble"],
    ["a change saved but not yet seen", { status: "failed", failure: { code: "out-of-sync", message: "x" } }, "behind"],
  ];
  for (const [name, result, kind] of cases) {
    it(`reads ${name} as ${kind}`, () => {
      expect(commitOutcome(result, "a.csv").kind).toBe(kind);
    });
  }

  it("does not claim the file is stored when the call never came back, and says so when the failure is certain", () => {
    const unsure = commitOutcome({ status: "failed", failure: { code: "unreachable", message: "x" } }, "a.csv");
    const sure = commitOutcome({ status: "failed", failure: { code: "handler-failed", message: "x" } }, "a.csv");
    expect(unsure.kind === "trouble" && english(unsure.words)).toContain("can't tell whether it added the file");
    expect(sure.kind === "trouble" && english(sure.words)).toContain("stored nothing");
  });

  it("leaves a file whose session expired or that is now blocked, so the family can only choose another", () => {
    expect(act(adding(), { type: "committed", result: { status: "expired" } }).stage).toEqual({ kind: "refused", refused: { kind: "expired" } });
  });

  it("offers a way to ask again when the preview could not be updated, and Add waits", () => {
    const typed = act(open(), { type: "typed", accountId: firstPreview.accounts[0]!.accountId, text: "9 431" });
    const failed = act(typed, { type: "planned", version: checking(typed).version, result: { kind: "failed", failure: { code: "unreachable", message: "x" } } });
    expect(checking(failed).stale).toBe(true);
    expect(canAdd(checking(failed))).toBe(false);
    expect(checking(failed).message).toMatchObject({ tone: "problem", retry: true });
    expect(planOutcome({ kind: "expired" }, "a.csv").kind).toBe("refused");
    const again = act(failed, { type: "retry" }, planned(failed));
    expect(canAdd(checking(act(again, planned(again))))).toBe(true);
  });

  it("notes what an undo removed once the family undoes the import from the result", () => {
    const done = act(adding(), { type: "committed", result: applied }, { type: "undone", removed: 3 });
    expect(done.stage).toMatchObject({ kind: "added", undone: 3 });
  });
});

describe("a file that can't be used", () => {
  const said = (refused: Parameters<typeof refusedView>[0], importedOn: LocalDate | null = null) => {
    const view = refusedView(refused, { importedOn: () => importedOn });
    return { title: english(view.title), detail: english(view.detail), note: view.note, leftOut: view.leftOut };
  };
  const blocked = (block: ImportBlock) => said({ kind: "blocked", fileName: "a.csv", block });
  const eur = currency("EUR");

  it("says the file's currency and the household's", () => {
    expect(blocked({ kind: "wrongCurrency", file: eur, household: nok }).detail).toBe("This file is in EUR. Your household uses NOK.");
  });

  it("says when a file the household already holds was imported", () => {
    const duplicate: ImportBlock = { kind: "duplicateFile", batchId: importBatchId(testId(1)) };
    expect(blocked(duplicate).detail).toContain("You already imported this file.");
    expect(said({ kind: "blocked", fileName: "a.csv", block: duplicate }, "2026-11-03" as LocalDate).detail).toContain("You imported this file on 3 Nov 2026.");
  });

  it("lists the accounts the app left out, with the number and the name the bank gave", () => {
    const view = blocked({ kind: "noKnownAccounts", leftOut: [{ account: accountNumber("9009.99.99999"), accountName: "Ferie", rows: 4 }] });
    expect(view.detail).toContain("Add them first");
    expect(view.leftOut).toEqual([{ account: "90099999999", accountName: "Ferie", rows: 4 }]);
  });

  it("names the line the parser stopped at, with the parser's own reason", () => {
    const view = said({ kind: "unparseable", fileName: "a.csv", line: 14, message: "The amount isn't a number." });
    expect(view.detail).toBe("The app couldn't read line 14 of a.csv.");
    expect(view.note).toBe("The amount isn't a number.");
    expect(said({ kind: "unparseable", fileName: "a.csv", line: null, message: "m" }).detail).toBe("The app couldn't read a.csv.");
  });

  it("has words for every reason a file can't be read, a file with no rows, a lost session and a failed call", () => {
    const reasons = ["missing", "denied", "tooLarge", "notText"] as const;
    for (const reason of reasons) expect(said({ kind: "unreadable", fileName: "a.csv", reason }).detail).toContain("a.csv");
    expect(said({ kind: "unrecognised", fileName: "a.csv" }).detail).toContain("doesn't recognise a.csv");
    expect(blocked({ kind: "noRows" }).detail).toBe("a.csv has no transactions in it.");
    expect(said({ kind: "expired" }).title).toBe("The app no longer has this file");
    expect(said({ kind: "failed", failure: { code: "unreachable", message: "x" } }).title).toBe("Something went wrong");
  });
});
