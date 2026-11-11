import { describe, expect, it } from "vitest";
import type { KeyPress } from "../transactions/keys.model.ts";
import { type PlanKeyContext, moveSelection, planKey } from "./PlanKeys.model.ts";

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

const context = (more: Partial<PlanKeyContext> = {}): PlanKeyContext => ({ row: true, canEdit: true, panelOpen: false, canUndo: false, canRedo: false, busy: false, ...more });

describe("the keys on Plan", () => {
  it("N opens the New job flow from anywhere on the screen", () => {
    expect(planKey(press("n"), context({ row: false }))).toEqual({ kind: "newJob" });
    expect(planKey(press("N"), context())).toEqual({ kind: "newJob" });
    expect(planKey(press("n", { target: "control" }), context())).toEqual({ kind: "newJob" });
  });

  it("J, K and the arrows move through the rows, and hold-to-repeat keeps moving", () => {
    expect(planKey(press("j"), context())).toEqual({ kind: "move", step: 1 });
    expect(planKey(press("ArrowDown"), context())).toEqual({ kind: "move", step: 1 });
    expect(planKey(press("k"), context())).toEqual({ kind: "move", step: -1 });
    expect(planKey(press("ArrowUp", { repeat: true }), context())).toEqual({ kind: "move", step: -1 });
    expect(planKey(press("j"), context({ row: false }))).toBeNull();
  });

  it("Enter opens the selected row, and leaves a focused button to do what it does", () => {
    expect(planKey(press("Enter"), context())).toEqual({ kind: "open" });
    expect(planKey(press("Enter", { target: "control" }), context())).toBeNull();
    expect(planKey(press("Enter"), context({ row: false }))).toBeNull();
  });

  it("E edits the amount of the selected row, only while the month takes changes", () => {
    expect(planKey(press("e"), context())).toEqual({ kind: "edit" });
    expect(planKey(press("e"), context({ canEdit: false }))).toBeNull();
    expect(planKey(press("e"), context({ row: false }))).toBeNull();
  });

  it("Esc closes the panel, and does nothing when none is open", () => {
    expect(planKey(press("Escape"), context({ panelOpen: true }))).toEqual({ kind: "closePanel" });
    expect(planKey(press("Escape"), context())).toBeNull();
  });

  it("U undoes and Shift U redoes, only when there is something this screen can take back", () => {
    expect(planKey(press("u"), context({ canUndo: true }))).toEqual({ kind: "undo" });
    expect(planKey(press("u"), context())).toBeNull();
    expect(planKey(press("U", { shiftKey: true }), context({ canRedo: true }))).toEqual({ kind: "redo" });
    expect(planKey(press("U", { shiftKey: true }), context({ canUndo: true }))).toBeNull();
    expect(planKey(press("z", { ctrlKey: true }), context({ canUndo: true }))).toEqual({ kind: "undo" });
    expect(planKey(press("z", { ctrlKey: true, shiftKey: true }), context({ canRedo: true }))).toEqual({ kind: "redo" });
  });

  it("waits while a change is saving, except to move", () => {
    const busy = context({ busy: true, canUndo: true });
    expect(planKey(press("u"), busy)).toBeNull();
    expect(planKey(press("z", { ctrlKey: true }), busy)).toBeNull();
    expect(planKey(press("e"), busy)).toBeNull();
    expect(planKey(press("Enter"), busy)).toBeNull();
    expect(planKey(press("j"), busy)).toEqual({ kind: "move", step: 1 });
  });

  it("never fires while the family types in a field", () => {
    for (const key of ["n", "j", "k", "e", "u", "Enter", "Escape", "ArrowDown", " "]) {
      expect(planKey(press(key, { target: "field" }), context({ panelOpen: true, canUndo: true, canRedo: true }))).toBeNull();
    }
    expect(planKey(press("z", { ctrlKey: true, target: "field" }), context({ canUndo: true }))).toBeNull();
  });

  it("never fires while a dialog is open", () => {
    for (const key of ["n", "j", "e", "u", "Enter", "Escape", "ArrowDown"]) {
      expect(planKey(press(key, { dialogOpen: true }), context({ panelOpen: true, canUndo: true }))).toBeNull();
    }
  });

  it("leaves the navigation letters and every other key alone", () => {
    for (const key of ["a", "o", "t", "p", "r", "m", "i", "s", "x", "?", " "]) expect(planKey(press(key), context())).toBeNull();
    expect(planKey(press("n", { ctrlKey: true }), context())).toBeNull();
    expect(planKey(press("n", { altKey: true }), context())).toBeNull();
    expect(planKey(press("n", { repeat: true }), context())).toBeNull();
    expect(planKey(press("N", { shiftKey: true }), context())).toBeNull();
  });
});

describe("moving the selection", () => {
  const ids = ["a", "b", "c"];

  it("steps to the next and previous row and stops at the ends", () => {
    expect(moveSelection(ids, "a", 1)).toBe("b");
    expect(moveSelection(ids, "b", -1)).toBe("a");
    expect(moveSelection(ids, "c", 1)).toBe("c");
    expect(moveSelection(ids, "a", -1)).toBe("a");
  });

  it("starts at the first row when nothing, or a row that has gone, was selected", () => {
    expect(moveSelection(ids, null, 1)).toBe("a");
    expect(moveSelection(ids, "gone", -1)).toBe("a");
    expect(moveSelection([], "a", 1)).toBeNull();
  });
});
