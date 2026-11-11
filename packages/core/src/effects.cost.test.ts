/**
 * What a preview costs the page (decision 0048): the screen previews on every keystroke in an amount, so a preview
 * must not pay for what it never shows. `pnpm bench:core` style timing is in `testing/measure-effects.ts`; the
 * test here guards the part that does not depend on the machine.
 */

import { describe, expect, it } from "vitest";
import { localDate, month } from "./dates.ts";
import { previewEffects } from "./effects.ts";
import { type Command, apply } from "./commands/apply.ts";
import { fundingOptions } from "./funding.ts";
import { movesPlan } from "./figures/moves-plan.ts";
import { kr } from "./testing/facts-builder.ts";
import { familyVolume } from "./testing/family-volume.ts";

/** A Map that counts how often it is iterated. */
class CountingMap<K, V> extends Map<K, V> {
  iterations = 0;
  override values(): MapIterator<V> {
    this.iterations += 1;
    return super.values();
  }
  override [Symbol.iterator](): MapIterator<[K, V]> {
    this.iterations += 1;
    return super[Symbol.iterator]();
  }
}

const asOf = localDate("2026-07-15");
const july = month("2026-07");

describe("what the plan screen's functions read, on the family's volume", () => {
  const { facts } = familyVolume(170);
  const [, a, b] = [...facts.jobs.keys()];
  if (a === undefined || b === undefined) throw new Error("expected jobs");
  const command: Command = { kind: "moveAssignment", month: july, from: a, to: b, amount: kr(1) };

  it("a preview reads no import row and no more of the rules than applying the command does, since it shows neither the needs-you list nor the import status", () => {
    const reads = (run: (counted: typeof facts) => unknown) => {
      const importRows = new CountingMap(facts.importRows);
      const rules = new CountingMap(facts.rules);
      run({ ...facts, importRows, rules });
      return { importRows: importRows.iterations, rules: rules.iterations };
    };
    const applying = reads((counted) => apply(counted, command, { asOf }));
    const previewing = reads((counted) => expect(previewEffects(counted, command, { asOf }).ok).toBe(true));
    expect(previewing.importRows).toBe(0);
    expect(previewing.rules).toBe(applying.rules);
    expect(applying.importRows).toBe(0);
  });

  it("funding options and the moves plan read none either", () => {
    const importRows = new CountingMap(facts.importRows);
    const rules = new CountingMap(facts.rules);
    const counted = { ...facts, importRows, rules };
    fundingOptions(counted, { month: july, amount: kr(500) }, asOf);
    movesPlan(counted, july, asOf);
    expect(importRows.iterations).toBe(0);
    expect(rules.iterations).toBe(0);
  });
});
