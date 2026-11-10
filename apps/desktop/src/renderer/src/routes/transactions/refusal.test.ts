import { type Refusal, type RefusalCode, messageFor, refusalCodes } from "@holt/core";
import { createIntl } from "react-intl";
import { describe, expect, it } from "vitest";
import { locale, messages } from "../../i18n/messages.ts";
import { problemText, refusalText } from "./refusal.ts";

const intl = createIntl({ locale, messages });

describe("the refusal words", () => {
  it("has an entry for every refusal code, with core's English text", () => {
    for (const code of refusalCodes) expect(messages[`refusal.${code}`], code).toBe(messageFor(code));
  });

  it("has no entry for a code that doesn't exist", () => {
    const known = new Set<string>(refusalCodes.map((code) => `refusal.${code}`));
    const stale = Object.keys(messages).filter((id) => id.startsWith("refusal.") && !known.has(id));
    expect(stale).toEqual([]);
  });

  it("shows the message file's words for a refusal, so the interface can be translated", () => {
    const translated = createIntl({ locale: "nb", messages: { ...messages, "refusal.sameJob": "Du kan ikke flytte penger fra en jobb til seg selv." } });
    const refusal: Refusal = { code: "sameJob", message: messageFor("sameJob") };
    expect(refusalText(translated, refusal)).toBe("Du kan ikke flytte penger fra en jobb til seg selv.");
    expect(refusalText(intl, refusal)).toBe(messageFor("sameJob"));
  });

  it("falls back to core's own text for a code the message files don't have yet", () => {
    const bare = createIntl({ locale, messages: {} });
    expect(refusalText(bare, { code: "sameJob", message: "Core's words" })).toBe("Core's words");
  });
});

describe("problemText", () => {
  it("says why core refused", () => {
    const refusal: Refusal = { code: "splitDoesNotAddUp", message: messageFor("splitDoesNotAddUp") };
    expect(problemText(intl, { status: "refused", refusal })).toBe(messageFor("splitDoesNotAddUp"));
  });

  it("says why an undo or redo did not happen", () => {
    const rowsChanged = { status: "conflict", conflict: { kind: "rowsChanged", changeId: "x", rows: [] } } as never;
    expect(problemText(intl, { status: "conflict", conflict: { kind: "nothingToUndo" } })).toBe(messages["needsYou.problem.nothingToUndo"]);
    expect(problemText(intl, { status: "conflict", conflict: { kind: "nothingToRedo" } })).toBe(messages["needsYou.problem.nothingToRedo"]);
    expect(problemText(intl, rowsChanged, "undo")).toBe(messages["needsYou.problem.undoBlocked"]);
    expect(problemText(intl, rowsChanged, "redo")).toBe(messages["needsYou.problem.redoBlocked"]);
  });

  it("says when a call failed, and when the change was saved but the page fell behind", () => {
    expect(problemText(intl, { status: "failed", failure: { code: "unreachable", message: "x" } })).toBe(messages["needsYou.problem.failed"]);
    expect(problemText(intl, { status: "failed", failure: { code: "out-of-sync", message: "x" } })).toBe(messages["needsYou.problem.outOfSync"]);
  });

  it("never returns nothing, whatever went wrong", () => {
    const code: RefusalCode = refusalCodes[0] as RefusalCode;
    expect(problemText(intl, { status: "refused", refusal: { code, message: "" } as Refusal }).length).toBeGreaterThan(0);
  });
});
