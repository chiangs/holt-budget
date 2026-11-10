import { type ChangeId, type Refusal, messageFor } from "@holt/core";
import { createIntl } from "react-intl";
import { describe, expect, it } from "vitest";
import type { LedgerOutcome } from "../../data/ledger.tsx";
import { locale, messages } from "../../i18n/messages.ts";
import { report } from "./decisions.model.ts";

const intl = createIntl({ locale, messages });
const change = { id: "change-1" as ChangeId, at: "2026-11-10T09:00:00.000Z", kind: "setTreatment" as const, by: { kind: "family" } as never };
const head = { undo: change, redo: null };
const applied: LedgerOutcome = { status: "applied", base: 1, revision: 2, today: "2026-11-10" as never, patch: [], change, head };

describe("what a finished call says to the family", () => {
  it("says what was done, and names the change so it can be undone", () => {
    expect(report(intl, applied, "Sorted 1 transaction.")).toEqual({ message: { kind: "said", text: "Sorted 1 transaction." }, made: change.id, refresh: false });
  });

  it("says why core refused, in the message file's words, and saves nothing", () => {
    const refusal: Refusal = { code: "transactionNotFound", message: messageFor("transactionNotFound") };
    expect(report(intl, { status: "refused", refusal }, "Sorted 1 transaction.")).toEqual({
      message: { kind: "problem", text: messageFor("transactionNotFound") },
      made: null,
      refresh: false,
    });
  });

  it("says why an undo found the rows changed", () => {
    const conflict = { status: "conflict", conflict: { kind: "rowsChanged", changeId: "x", rows: [] } } as never;
    const result = report(intl, conflict, "Undid the change.", "undo");
    expect(result.message).toEqual({ kind: "problem", text: messages["needsYou.problem.undoBlocked"] });
    expect(result.made).toBeNull();
  });

  it("asks the page to refresh when the change was saved but the page fell behind, and not for any other failure", () => {
    expect(report(intl, { status: "failed", failure: { code: "out-of-sync", message: "x" } }, "done").refresh).toBe(true);
    expect(report(intl, { status: "failed", failure: { code: "unreachable", message: "x" } }, "done")).toMatchObject({ refresh: false, made: null, message: { kind: "problem" } });
  });
});
