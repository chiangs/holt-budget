import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type KeyContext, type KeyPress, isImportKey, rowKey } from "./keys.model.ts";

const press = (key: string, more: Partial<KeyPress> = {}): KeyPress => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat: false,
  target: "plain",
  dialogOpen: false,
  ...more,
});

const context = (more: Partial<KeyContext> = {}): KeyContext => ({
  row: { hasSuggestion: true, canChooseJob: true },
  canUndo: true,
  canRedo: true,
  busy: false,
  ...more,
});

describe("moving through the list", () => {
  it("Down and J go to the next row, Up and K to the previous", () => {
    for (const key of ["ArrowDown", "j", "J"]) expect(rowKey(press(key), context())).toEqual({ kind: "move", step: 1 });
    for (const key of ["ArrowUp", "k", "K"]) expect(rowKey(press(key), context())).toEqual({ kind: "move", step: -1 });
  });

  it("keeps moving while the key is held, and when a button has focus", () => {
    expect(rowKey(press("j", { repeat: true }), context())).toEqual({ kind: "move", step: 1 });
    expect(rowKey(press("ArrowDown", { target: "control" }), context())).toEqual({ kind: "move", step: 1 });
  });

  it("does nothing with no rows, or with Shift held", () => {
    expect(rowKey(press("j"), context({ row: null }))).toBeNull();
    expect(rowKey(press("J", { shiftKey: true }), context())).toBeNull();
  });
});

describe("Space", () => {
  it("accepts the selected row's suggestion", () => {
    expect(rowKey(press(" "), context())).toEqual({ kind: "accept" });
  });

  it("says there is nothing to accept when the row has no suggestion", () => {
    expect(rowKey(press(" "), context({ row: { hasSuggestion: false, canChooseJob: true } }))).toEqual({ kind: "noSuggestion" });
  });

  it("leaves Space to a button that has focus, so it can't act twice", () => {
    expect(rowKey(press(" ", { target: "control" }), context())).toBeNull();
  });

  it("accepts one row for one press, never for a held key or while a change is saving", () => {
    expect(rowKey(press(" ", { repeat: true }), context())).toBeNull();
    expect(rowKey(press(" "), context({ busy: true }))).toBeNull();
  });

  it("does nothing with no row", () => {
    expect(rowKey(press(" "), context({ row: null }))).toBeNull();
  });
});

describe("Enter and E", () => {
  it("Enter opens the row's actions, unless a button has focus and uses it itself", () => {
    expect(rowKey(press("Enter"), context())).toEqual({ kind: "openActions" });
    expect(rowKey(press("Enter", { target: "control" }), context())).toBeNull();
  });

  it("E chooses the job when the row can take one, and does nothing for money in", () => {
    expect(rowKey(press("e"), context())).toEqual({ kind: "chooseJob" });
    expect(rowKey(press("E"), context({ row: { hasSuggestion: true, canChooseJob: false } }))).toBeNull();
  });
});

describe("undo and redo", () => {
  it("U undoes and Shift U redoes, when there is something to do", () => {
    expect(rowKey(press("u"), context())).toEqual({ kind: "undo" });
    expect(rowKey(press("U", { shiftKey: true }), context())).toEqual({ kind: "redo" });
    expect(rowKey(press("u"), context({ canUndo: false }))).toBeNull();
    expect(rowKey(press("U", { shiftKey: true }), context({ canRedo: false }))).toBeNull();
  });

  it("works with no rows left, which is when the family most wants it", () => {
    expect(rowKey(press("u"), context({ row: null }))).toEqual({ kind: "undo" });
  });

  it("Ctrl Z and Ctrl Shift Z do the same", () => {
    expect(rowKey(press("z", { ctrlKey: true }), context())).toEqual({ kind: "undo" });
    expect(rowKey(press("Z", { ctrlKey: true, shiftKey: true }), context())).toEqual({ kind: "redo" });
    expect(rowKey(press("y", { ctrlKey: true }), context())).toBeNull();
  });

  it("undoes once for one press, and not while another change is saving", () => {
    expect(rowKey(press("u", { repeat: true }), context())).toBeNull();
    expect(rowKey(press("u"), context({ busy: true }))).toBeNull();
    expect(rowKey(press("z", { ctrlKey: true, repeat: true }), context())).toBeNull();
  });
});

describe("typing and dialogs always win", () => {
  const keys = ["ArrowDown", "ArrowUp", "j", "k", " ", "Enter", "e", "u", "n"];

  it("no key does anything while the family types in a field", () => {
    for (const key of keys) expect(rowKey(press(key, { target: "field" }), context())).toBeNull();
    expect(rowKey(press("z", { ctrlKey: true, target: "field" }), context())).toBeNull();
    expect(isImportKey(press("n", { target: "field" }))).toBe(false);
  });

  it("no key does anything while a dialog is open", () => {
    for (const key of keys) expect(rowKey(press(key, { dialogOpen: true }), context())).toBeNull();
    expect(rowKey(press("z", { ctrlKey: true, dialogOpen: true }), context())).toBeNull();
    expect(isImportKey(press("n", { dialogOpen: true }))).toBe(false);
  });

  it("never uses a navigation letter, which always means the same place", () => {
    for (const letter of ["a", "o", "t", "p", "r", "m", "i", "s"]) expect(rowKey(press(letter), context())).toBeNull();
  });

  it("does nothing with Alt held, for any key", () => {
    fc.assert(fc.property(fc.constantFrom(...keys), (key) => rowKey(press(key, { altKey: true }), context()) === null));
  });
});

describe("the Import key", () => {
  it("is N on its own", () => {
    expect(isImportKey(press("n"))).toBe(true);
    expect(isImportKey(press("N"))).toBe(true);
    expect(isImportKey(press("n", { target: "control" }))).toBe(true);
  });

  it("is not N with a modifier, held down, or any other letter", () => {
    for (const more of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) expect(isImportKey(press("n", more))).toBe(false);
    expect(isImportKey(press("m"))).toBe(false);
  });
});
