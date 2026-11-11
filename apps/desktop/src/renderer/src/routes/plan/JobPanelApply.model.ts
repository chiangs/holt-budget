/**
 * What Apply does, and what the family is told about it first. The commands come from core's offer
 * (`startNowCommands`, the start-later batch, the proposal), so the batch Apply runs is exactly the one core built
 * and the one `previewEffects` was shown. Nothing is worked out here: this picks the command for the plan the family
 * is looking at, and turns `previewEffects` into the few lines worth reading.
 */

import {
  type BufferFigures,
  type Command,
  type Effects,
  type Facts,
  type FamilyCommand,
  type JobId,
  type LocalDate,
  type Money,
  type Month,
  type Refusal,
  type Runway,
  type StartNowBlock,
  type StartNowIds,
  type Unassigned,
  expectedIncome,
  money,
  previewEffects,
  startNowCommands,
} from "@holt/core";
import { type Selection, type SpendPanelData, followCommand, raiseOf, startOf } from "./JobPanel.model.ts";

/** The page may send every command core builds here, and may never send an import. */
export function familyOf(command: Command): FamilyCommand {
  if (command.kind === "importFile") throw new Error("The page may not send importFile.");
  if (command.kind === "batch") return { kind: "batch", commands: command.commands.map(familyOf) };
  return command;
}

/** What happened, as facts the confirmation turns into words. */
export type Done =
  | {
      readonly kind: "evenNow";
      readonly month: Month;
      readonly monthly: Money;
      readonly seed: Money;
      /** Where the seed came from, or null when the bucket needed none. */
      readonly source: string | null;
      /** The seed has to move at the bank too, because the buffer and the job sit in different accounts. */
      readonly bankMove: boolean;
    }
  | { readonly kind: "evenLater"; readonly month: Month; readonly monthly: Money }
  | { readonly kind: "followBills" }
  | { readonly kind: "raise"; readonly monthly: Money };

/** The label of the Apply button, as facts. */
export type ApplyLabel =
  | { readonly kind: "evenOut"; readonly month: Month }
  | { readonly kind: "followBills" }
  | { readonly kind: "raise"; readonly monthly: Money };

export type Applying =
  /** The plan the family is looking at is the plan the job has. */
  | { readonly kind: "nothing" }
  /** Starting now is what the family chose and the buffer can't pay for it, and there is no later start to fall back on. */
  | { readonly kind: "blocked"; readonly reason: StartNowBlock }
  | { readonly kind: "ready"; readonly label: ApplyLabel; readonly command: FamilyCommand; readonly done: Done };

export interface ApplyInput {
  readonly ids: StartNowIds;
  /** Why the seed moves, in the family's words. */
  readonly reason: string;
}

/** The command that Apply would run for this choice, or why there is none. */
export function applyOf(panel: SpendPanelData, selection: Selection, { ids, reason }: ApplyInput): Applying {
  const { job, offer } = panel;
  switch (selection.mode) {
    case "setAmount":
      return { kind: "nothing" };
    case "followBills":
      return job.plan.mode === "followBills" ? { kind: "nothing" } : { kind: "ready", label: { kind: "followBills" }, command: followCommand(job.id), done: { kind: "followBills" } };
    case "evenOut": {
      const proposal = raiseOf(offer, selection);
      if (proposal !== null) {
        return { kind: "ready", label: { kind: "raise", monthly: proposal.monthly }, command: familyOf(proposal.command), done: { kind: "raise", monthly: proposal.monthly } };
      }
      if (offer?.kind !== "start") return { kind: "nothing" };
      if (startOf(offer, selection) === "later" && offer.startLater !== null) {
        const { startMonth, command } = offer.startLater;
        return { kind: "ready", label: { kind: "evenOut", month: startMonth }, command: familyOf(command), done: { kind: "evenLater", month: startMonth, monthly: offer.monthly } };
      }
      const batch = startNowCommands(offer, { ids, reason });
      if (batch === null) return { kind: "blocked", reason: offer.startNow.blockedBy ?? "noBuffer" };
      const { startNow } = offer;
      return {
        kind: "ready",
        label: { kind: "evenOut", month: offer.startMonth },
        command: familyOf(batch),
        done: { kind: "evenNow", month: offer.startMonth, monthly: offer.monthly, seed: startNow.seed, source: startNow.source?.name ?? null, bankMove: startNow.bankMove !== null },
      };
    }
  }
}

// ── What it would change ───────────────────────────────────────────────────────

export type EffectRow =
  | { readonly kind: "assigned"; readonly jobId: JobId; readonly name: string; readonly before: Money; readonly after: Money }
  | { readonly kind: "unassigned"; readonly before: Unassigned; readonly after: Unassigned }
  /** In tenths of a percent. Null when no money is in. */
  | { readonly kind: "savingsRate"; readonly before: number | null; readonly after: number | null }
  | { readonly kind: "buffer"; readonly before: Money; readonly after: Money; readonly runwayBefore: Runway; readonly runwayAfter: Runway }
  | { readonly kind: "goal"; readonly jobId: JobId; readonly name: string; readonly monthsBefore: number | null; readonly monthsAfter: number | null; readonly ready: Month | null };

export type EffectsOf = { readonly kind: "refused"; readonly refusal: Refusal } | { readonly kind: "shown"; readonly month: Month; readonly rows: readonly EffectRow[] };

/** Which kind of row shows each part of `Effects`. A new part fails to compile here until it is shown or left out on purpose. */
export const shownAs: Record<keyof Effects, EffectRow["kind"] | null> = {
  month: null,
  unassigned: "unassigned",
  jobs: "assigned",
  savingsRate: "savingsRate",
  goals: "goal",
  buffer: "buffer",
};

const sameRunway = (a: Runway, b: Runway): boolean => (a.kind === "noEssentials" ? b.kind === "noEssentials" : b.kind === "tenthsOfAMonth" && a.tenths === b.tenths);

function bufferRow(before: BufferFigures, after: BufferFigures): EffectRow | null {
  if (before.kind !== "buffer" || after.kind !== "buffer") return null;
  if (before.balance === after.balance && sameRunway(before.runway, after.runway)) return null;
  return { kind: "buffer", before: before.balance, after: after.balance, runwayBefore: before.runway, runwayAfter: after.runway };
}

/** The lines worth reading from what a change would do: only what moves. */
export function effectRows(effects: Effects): readonly EffectRow[] {
  const rows: EffectRow[] = effects.jobs.map((job) => ({ kind: "assigned", jobId: job.jobId, name: job.name, before: job.before, after: job.after }));
  const { before, after } = effects.unassigned;
  if (before.kind !== after.kind || before.amount !== after.amount) rows.push({ kind: "unassigned", before, after });
  if (effects.savingsRate.before !== effects.savingsRate.after) rows.push({ kind: "savingsRate", ...effects.savingsRate });
  const buffer = bufferRow(effects.buffer.before, effects.buffer.after);
  if (buffer !== null) rows.push(buffer);
  for (const goal of effects.goals) {
    if (goal.before === null || goal.after === null || goal.before.monthsToGo === goal.after.monthsToGo) continue;
    rows.push({ kind: "goal", jobId: goal.jobId, name: goal.name, monthsBefore: goal.before.monthsToGo, monthsAfter: goal.after.monthsToGo, ready: goal.after.readyMonth });
  }
  return rows;
}

/** `previewEffects` on the facts the page holds, with the contributions still to arrive counted into the savings rate. */
export function effectsOf(facts: Facts, command: FamilyCommand, asOf: LocalDate): EffectsOf {
  const arriving = (f: Facts, month: Month): Money => expectedIncome(f, asOf).find((e) => e.month === month)?.amount ?? money(0);
  const preview = previewEffects(facts, command, { asOf, expectedIncome: arriving });
  return preview.ok ? { kind: "shown", month: preview.effects.month, rows: effectRows(preview.effects) } : { kind: "refused", refusal: preview.refusal };
}
