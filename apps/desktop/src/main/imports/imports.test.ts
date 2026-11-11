import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type JobId, type Money, type TreatmentInput, localDate, money } from "@holt/core";
import { syntheticOfx } from "@holt/importers/synthetic";
import type { ImportCommitted, ImportEntry, ImportOpened, SessionId } from "../../shared/import-types.ts";
import { type Rig, createRig, today } from "./test-rig.ts";

let rig: Rig;
beforeEach(() => {
  rig = createRig();
});
afterEach(() => rig.dispose());

const entry = (changes: Partial<ImportEntry> = {}): ImportEntry => ({ balances: [], choices: [], suggest: true, ...changes });

function opened(result: ImportOpened) {
  if (result.kind !== "opened") throw new Error(`Expected the file to open, got ${JSON.stringify(result)}`);
  return result;
}

function applied(result: ImportCommitted) {
  if (!("status" in result) || result.status !== "applied") throw new Error(`Expected the import to apply, got ${JSON.stringify(result)}`);
  return result;
}

function add(name: string, changes: Partial<ImportEntry> = {}) {
  const file = opened(rig.imports.planBytes(rig.bytes(name), name));
  applied(rig.imports.commit(file.session, entry(changes)));
  return file;
}

const toJob = (jobId: JobId, amount: Money): TreatmentInput => ({ kind: "split", allocations: [{ jobId, amount }] });

const october = { from: localDate("2026-10-01"), to: localDate("2026-10-31"), seed: 1 };

describe("a file the app can't read", () => {
  it.each(["missing", "denied", "tooLarge", "notText"] as const)("says it is %s, with the file's name and no path", async (reason) => {
    rig.choose("/home/someone/Downloads/bank.csv", { kind: "unreadable", reason });
    const result = await rig.imports.open();
    expect(result).toEqual({ kind: "unreadable", fileName: "bank.csv", reason });
  });

  it("calls a file with binary content not text", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]);
    expect(rig.imports.planBytes(bytes, "statement.pdf")).toEqual({ kind: "unreadable", fileName: "statement.pdf", reason: "notText" });
  });

  it("doesn't recognise text in no bank's format", () => {
    const bytes = new TextEncoder().encode("Date,Amount\n2026-01-01,5\n");
    expect(rig.imports.planBytes(bytes, "other.csv")).toEqual({ kind: "unrecognised", fileName: "other.csv" });
  });

  it("names the line of a row it can't read", () => {
    const lines = rig.text("bulder.csv").split("\n");
    const columns = (lines[2] as string).split(";");
    columns[1] = "not an amount";
    lines[2] = columns.join(";");
    const result = rig.imports.planBytes(new TextEncoder().encode(lines.join("\n")), "bulder.csv");
    expect(result).toMatchObject({ kind: "unparseable", fileName: "bulder.csv", line: 3 });
    expect((result as { message: string }).message).not.toMatch(/^Line 3/);
  });
});

describe("a file the app reads but won't import", () => {
  it("is blocked when it is in another currency, before any row is read", () => {
    const [ofx] = syntheticOfx(october);
    const euros = (ofx?.text ?? "").replace("<CURDEF>NOK", "<CURDEF>EUR");
    expect(euros).toContain("EUR");
    const result = rig.imports.planBytes(new TextEncoder().encode(euros), "euro.ofx");
    expect(result).toEqual({ kind: "blocked", fileName: "euro.ofx", block: { kind: "wrongCurrency", file: "EUR", household: "NOK" } });
  });

  it("is blocked when the same bytes are already in, and allowed again once that import is undone", () => {
    add("bulder.csv");
    const [batch] = rig.facts().importBatches.values();
    const again = rig.imports.planBytes(rig.bytes("bulder.csv"), "bulder-copy.csv");
    expect(again).toMatchObject({ kind: "blocked", block: { kind: "duplicateFile", batchId: batch?.id } });

    const undone = rig.store.run({ kind: "undoImport", batchId: batch!.id });
    expect(undone.status).toBe("applied");
    expect(rig.imports.planBytes(rig.bytes("bulder.csv"), "bulder.csv").kind).toBe("opened");
  });

  it("is blocked when none of its rows belong to a household account", () => {
    const [ofx] = syntheticOfx(october);
    const result = rig.imports.planBytes(new TextEncoder().encode(ofx?.text ?? ""), "elsewhere.ofx");
    expect(result).toMatchObject({ kind: "blocked", block: { kind: "noKnownAccounts" } });
  });
});

describe("choosing a file and cancelling", () => {
  it("leaves the database exactly as it was, whether the family cancels the dialog or walks away from a preview", async () => {
    const before = rig.dump();
    rig.choose(null);
    expect(await rig.imports.open()).toEqual({ kind: "cancelled" });
    expect(rig.dump()).toBe(before);

    rig.choose("/downloads/bulder.csv", { kind: "bytes", bytes: rig.bytes("bulder.csv") });
    opened(await rig.imports.open());
    expect(rig.dump()).toBe(before);
    expect(rig.hookRuns()).toBe(0);
  });

  it("keeps a preview the page is showing when a later dialog is cancelled", async () => {
    rig.choose("/downloads/bulder.csv", { kind: "bytes", bytes: rig.bytes("bulder.csv") });
    const file = opened(await rig.imports.open());
    rig.choose(null);
    await rig.imports.open();
    expect(applied(rig.imports.commit(file.session, entry())).change.kind).toBe("batch");
  });

  it("replaces the held file when another is read, so the older preview can no longer be added", () => {
    const first = opened(rig.imports.planBytes(rig.bytes("bulder.csv"), "bulder.csv"));
    const second = opened(rig.imports.planBytes(rig.bytes("sparebank1-deposit.csv"), "deposit.csv"));
    expect(rig.imports.commit(first.session, entry())).toEqual({ status: "expired" });
    expect(rig.facts().importBatches.size).toBe(0);
    applied(rig.imports.commit(second.session, entry()));
    expect([...rig.facts().importBatches.values()].map((b) => b.fileName)).toEqual(["deposit.csv"]);
  });

  it("gives the page the file's name and a preview, never the path or the parsed rows", async () => {
    const path = "/home/someone/Downloads/bulder.csv";
    rig.choose(path, { kind: "bytes", bytes: rig.bytes("bulder.csv") });
    const result = opened(await rig.imports.open());
    const sent = JSON.stringify(result);
    expect(result.fileName).toBe("bulder.csv");
    expect(sent).not.toContain("someone");
    expect(sent).not.toContain("Downloads");
    expect(Object.keys(result).sort()).toEqual(["fileName", "kind", "preview", "session"]);
    expect(Object.keys(result.preview)).not.toContain("rows");
  });
});

describe("adding a file", () => {
  it("stores the file as one change, and undoing the import removes what it made", () => {
    const file = opened(rig.imports.planBytes(rig.bytes("bulder.csv"), "bulder.csv"));
    const result = applied(rig.imports.commit(file.session, entry()));
    const facts = rig.facts();
    expect(facts.transactions.size).toBe(file.preview.counts.created);
    expect(facts.importRows.size).toBe(file.preview.counts.rows);
    expect(result.revision).toBe(1);

    const [batch] = facts.importBatches.values();
    expect(rig.store.run({ kind: "undoImport", batchId: batch!.id }).status).toBe("applied");
    expect(rig.facts().transactions.size).toBe(0);
    expect(rig.facts().importBatches.get(batch!.id)?.undone).toBe(true);
  });

  it("imports once when the page presses Add twice", () => {
    const file = opened(rig.imports.planBytes(rig.bytes("bulder.csv"), "bulder.csv"));
    applied(rig.imports.commit(file.session, entry()));
    const after = rig.dump();
    expect(rig.imports.commit(file.session, entry())).toEqual({ status: "expired" });
    expect(rig.imports.plan(file.session, entry())).toEqual({ kind: "expired" });
    expect(rig.dump()).toBe(after);
    expect(rig.hookRuns()).toBe(1);
  });

  it("turns away a session it never issued", () => {
    opened(rig.imports.planBytes(rig.bytes("bulder.csv"), "bulder.csv"));
    const stranger: SessionId = "not-a-session";
    expect(rig.imports.plan(stranger, entry())).toEqual({ kind: "expired" });
    expect(rig.imports.commit(stranger, entry())).toEqual({ status: "expired" });
    expect(rig.facts().importBatches.size).toBe(0);
  });

  it("plans again on the facts as they are when the family presses Add, not as they were in the preview", () => {
    const file = opened(rig.imports.planBytes(rig.bytes("bulder.csv"), "bulder.csv"));
    const rule = rig.mint("rule");
    const made = rig.store.run({ kind: "addRule", rule: { id: rule, match: { counterparty: "Torgkafeen" }, result: { kind: "job", jobId: rig.job("Hobbies") }, origin: "set", priority: 0 } });
    expect(made.status).toBe("applied");

    applied(rig.imports.commit(file.session, entry()));
    const sorted = [...rig.facts().transactions.values()].filter((t) => t.ruleId === rule);
    expect(sorted.length).toBeGreaterThan(0);
    expect(sorted.every((t) => t.counterparty === "Torgkafeen")).toBe(true);
  });

  it("refuses to add a file another window added in the meantime, and stores nothing twice", () => {
    const here = opened(rig.imports.planBytes(rig.bytes("bulder.csv"), "bulder.csv"));
    const elsewhere = rig.another();
    const there = opened(elsewhere.planBytes(rig.bytes("bulder.csv"), "bulder.csv"));
    applied(elsewhere.commit(there.session, entry()));
    const after = rig.dump();

    expect(rig.imports.commit(here.session, entry())).toMatchObject({ status: "blocked", block: { kind: "duplicateFile" } });
    expect(rig.dump()).toBe(after);
    expect(rig.hookRuns()).toBe(1);
  });

  it("keeps the session after a blocked add, so the family can correct the choice and press Add again", () => {
    const file = opened(rig.imports.planBytes(rig.bytes("bulder.csv"), "bulder.csv"));
    const waiting = file.preview.sample.find((line) => line.treatment.kind === "needsYou" && line.amount < -100);
    const wrongSum = { line: waiting!.line, treatment: toJob(rig.job("Hobbies"), money(-1)) };
    const blocked = rig.imports.commit(file.session, entry({ choices: [wrongSum] }));
    expect(blocked).toMatchObject({ status: "blocked", block: { kind: "badChoice", line: waiting!.line } });
    expect(rig.facts().importBatches.size).toBe(0);
    applied(rig.imports.commit(file.session, entry()));
  });

  it("gives each new row the job the family chose for its line", () => {
    const file = opened(rig.imports.planBytes(rig.bytes("bulder.csv"), "bulder.csv"));
    const waiting = file.preview.sample.find((line) => line.why.kind === "none" && line.treatment.kind === "needsYou" && line.amount < 0);
    expect(waiting).toBeDefined();
    const hobbies = rig.job("Hobbies");
    const choices = [{ line: waiting!.line, treatment: toJob(hobbies, waiting!.amount) }];

    const preview = rig.imports.plan(file.session, entry({ choices }));
    expect(preview).toMatchObject({ kind: "planned", preview: { counts: { chosen: 1 } } });
    expect(file.preview.counts.chosen).toBe(0);

    applied(rig.imports.commit(file.session, entry({ choices })));
    const given = [...rig.facts().transactions.values()].filter((t) => t.treatment.kind === "split" && t.treatment.allocations.every((a) => a.jobId === hobbies));
    expect(given).toHaveLength(1);
    expect(given[0]).toMatchObject({ bookingDate: waiting!.bookingDate, amount: waiting!.amount, description: waiting!.description });
  });

  it("gives a new row the job of the last one from the same payee only when suggestions are on", () => {
    // A payee with no rule whose monthly row falls after the older file ends, so the later file adds it.
    const payee = "Kontogebyr";
    add("bulder.csv");
    const earlier = [...rig.facts().transactions.values()]
      .filter((t) => t.counterparty === payee && t.treatment.kind === "needsYou" && t.amount < 0)
      .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate));
    expect(earlier.length).toBeGreaterThan(1);
    const hobbies = rig.job("Hobbies");
    const latest = earlier[0]!;
    const set = rig.store.run({ kind: "setTreatment", transactionId: latest.id, treatment: toJob(hobbies, latest.amount) });
    expect(set.status).toBe("applied");

    const later = opened(rig.imports.planBytes(rig.bytes("bulder-later.csv"), "bulder-later.csv"));
    const on = rig.imports.plan(later.session, entry({ suggest: true }));
    const off = rig.imports.plan(later.session, entry({ suggest: false }));
    if (on.kind !== "planned" || off.kind !== "planned") throw new Error("Expected both plans to go ahead");
    expect(on.preview.counts.suggested).toBeGreaterThan(0);
    expect(off.preview.counts.suggested).toBe(0);
    expect(off.preview.counts.needsYou).toBe(on.preview.counts.needsYou + on.preview.counts.suggested);

    applied(rig.imports.commit(later.session, entry({ suggest: false })));
    const suggestedAnyway = [...rig.facts().transactions.values()].filter((t) => t.counterparty === payee && t.treatment.kind === "split" && t.id !== latest.id);
    expect(suggestedAnyway).toHaveLength(0);
  });

  it("checks a typed balance against the books, and keeps it as an entered value when it is added", () => {
    const everyday = rig.account("Everyday");
    const file = opened(rig.imports.planBytes(rig.bytes("bulder.csv"), "bulder.csv"));
    const asOf = today;

    const guess = rig.imports.plan(file.session, entry({ balances: [{ accountId: everyday, value: money(1), asOf }] }));
    if (guess.kind !== "planned") throw new Error("Expected a plan");
    const wrong = guess.preview.accounts.find((a) => a.accountId === everyday)?.balance;
    if (wrong?.kind !== "differs") throw new Error(`Expected a mismatch, got ${JSON.stringify(wrong)}`);

    const right = rig.imports.plan(file.session, entry({ balances: [{ accountId: everyday, value: wrong.calculated, asOf }] }));
    if (right.kind !== "planned") throw new Error("Expected a plan");
    expect(right.preview.accounts.find((a) => a.accountId === everyday)?.balance).toMatchObject({ kind: "matches", entered: wrong.calculated });
    const quiet = rig.imports.plan(file.session, entry());
    if (quiet.kind !== "planned") throw new Error("Expected a plan");
    expect(quiet.preview.accounts.find((a) => a.accountId === everyday)?.balance.kind).toBe("notChecked");

    const heldBefore = new Set(rig.facts().enteredValues.keys());
    applied(rig.imports.commit(file.session, entry({ balances: [{ accountId: everyday, value: wrong.calculated, asOf }] })));
    const kept = [...rig.facts().enteredValues.values()].filter((v) => !heldBefore.has(v.id));
    expect(kept).toMatchObject([{ kind: "accountBalance", subject: everyday, value: wrong.calculated, asOf }]);
  });
});

describe("after an import", () => {
  it("runs the hook once for an import that was stored, and a failing hook doesn't change the result", () => {
    const failing = createRig({
      afterImport: () => {
        throw new Error("backup folder missing");
      },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const file = opened(failing.imports.planBytes(failing.bytes("bulder.csv"), "bulder.csv"));
      expect(failing.imports.commit(file.session, entry())).toMatchObject({ status: "applied" });
      expect(failing.hookRuns()).toBe(1);
      expect(failing.facts().importBatches.size).toBe(1);
    } finally {
      log.mockRestore();
      failing.dispose();
    }
  });

  it("doesn't run the hook for a file that was blocked or expired", () => {
    add("bulder.csv");
    const second = rig.another();
    expect(second.planBytes(rig.bytes("bulder.csv"), "bulder.csv").kind).toBe("blocked");
    expect(second.commit("nothing", entry())).toEqual({ status: "expired" });
    expect(rig.hookRuns()).toBe(1);
  });
});
