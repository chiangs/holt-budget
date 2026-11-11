/**
 * What the panel says about the way to start (decision record 0048, "Starting to even out"). The cards, the
 * paragraph under them and the note for a job that is already evened out are all read from core's offer, so
 * every number the family sees here is one core gave: the seed, the lowest the bucket gets, where it ends, what
 * the buffer holds afterwards. The sentences are the message file's; this says which sentence and with what.
 */

import { type AssignmentChange, type EvenOutOffer, type JobForecast, type Money, type Month, type Runway, type StartNowBlock, addMonths } from "@holt/core";
import { type Selection, type SpendPanelData, startOf } from "./JobPanel.model.ts";

export interface Point {
  readonly month: Month;
  readonly amount: Money;
}

function lastOf(forecast: JobForecast): Point {
  const last = forecast.months.at(-1);
  if (last === undefined) throw new RangeError("A forecast has at least one month");
  return { month: last.month, amount: last.bucketEnd };
}

/** Where a start leaves the bucket: its lowest point and where it stands at the end of the year. */
export interface Course {
  readonly lowest: Point;
  readonly last: Point;
}

const courseOf = (forecast: JobForecast): Course => ({ lowest: forecast.lowest, last: lastOf(forecast) });

export interface StartCard {
  readonly key: "now" | "later";
  /** The month evening out starts in. */
  readonly month: Month;
  /** What moves from the buffer to start the bucket. Only "now" has one. */
  readonly seed: Money | null;
  readonly source: string | null;
  /** Why the card can't be chosen. Only "now" is ever blocked. */
  readonly blockedBy: StartNowBlock | null;
}

/** What a bucket that starts now with nothing moved in would do, which is why there is a choice. */
export type Intro =
  | { readonly kind: "runsDry"; readonly month: Month; readonly lowest: Point }
  | { readonly kind: "holds"; readonly lowest: Point };

export type Explanation =
  | {
      readonly kind: "now";
      readonly seed: Money;
      readonly course: Course;
      /** Where the seed would come from and what it holds, or null when the bucket needs none or the move is blocked. */
      readonly source: { readonly name: string; readonly holds: Money } | null;
      readonly bankMove: boolean;
      readonly bufferAfter: { readonly balance: Money; readonly runway: Runway } | null;
      readonly blockedBy: StartNowBlock | null;
      /** What the buffer holds now, for the words that say it holds too little. */
      readonly bufferHolds: Money | null;
    }
  | {
      readonly kind: "later";
      readonly startMonth: Month;
      /** The last month that follows the bills before the start. */
      readonly followsUntil: Month;
      readonly course: Course;
      /** The open months whose assigned amount changes, as core's commands set them. */
      readonly changes: readonly AssignmentChange[];
    };

export interface OfferView {
  readonly intro: Intro;
  readonly cards: readonly StartCard[];
  readonly chosen: "now" | "later";
  readonly explanation: Explanation;
  /** The monthly amount evened out, rounded up to the step, and the figure before rounding. */
  readonly monthly: Money;
  readonly step: Money;
  readonly average: Money | null;
}

/** The cards, the introduction and the paragraph for a job offered the choice to even out. Null for a job that is already evened out. */
export function offerViewOf(panel: SpendPanelData, selection: Selection): OfferView | null {
  const offer = panel.offer;
  if (offer?.kind !== "start" || selection.mode !== "evenOut") return null;
  const { startNow, startLater } = offer;
  const chosen = startOf(offer, selection);
  const cards: StartCard[] = [
    { key: "now", month: offer.startMonth, seed: startNow.seed, source: panel.bufferName, blockedBy: startNow.blockedBy },
  ];
  if (startLater !== null) cards.push({ key: "later", month: startLater.startMonth, seed: null, source: null, blockedBy: null });

  const dry = offer.withoutSeed.runsDryIn;
  const intro: Intro = dry === null ? { kind: "holds", lowest: offer.withoutSeed.lowest } : { kind: "runsDry", month: dry, lowest: offer.withoutSeed.lowest };

  const explanation: Explanation =
    chosen === "later" && startLater !== null
      ? { kind: "later", startMonth: startLater.startMonth, followsUntil: addMonths(startLater.startMonth, -1), course: courseOf(startLater.forecast), changes: startLater.assignments }
      : {
          kind: "now",
          seed: startNow.seed,
          course: courseOf(startNow.forecast),
          source: startNow.source === null ? null : { name: startNow.source.name, holds: startNow.source.holds },
          bankMove: startNow.bankMove !== null,
          bufferAfter: startNow.bufferAfter,
          blockedBy: startNow.blockedBy,
          bufferHolds: panel.buffer.kind === "buffer" ? panel.buffer.balance : null,
        };
  return { intro, cards, chosen, explanation, monthly: offer.monthly, step: offer.step, average: panel.estimate?.monthlyAverage.amount ?? null };
}

/** The note under the chart for a job that follows the bills: where its plan peaks and bottoms out. */
export interface FollowView {
  readonly highest: Point;
  readonly lowest: Point;
}

export function followViewOf(panel: SpendPanelData): FollowView | null {
  const months = panel.estimate?.months ?? [];
  const [first, ...rest] = months;
  if (first === undefined) return null;
  let highest: Point = { month: first.month, amount: first.bill };
  let lowest: Point = highest;
  for (const m of rest) {
    if (m.bill > highest.amount) highest = { month: m.month, amount: m.bill };
    if (m.bill < lowest.amount) lowest = { month: m.month, amount: m.bill };
  }
  return { highest, lowest };
}

/** What the family sees for a job that is already evened out: where its bucket goes, and a higher amount when it would run dry. */
export interface EvenedOutView {
  readonly monthly: Money;
  readonly startMonth: Month;
  readonly course: Course;
  readonly runsDryIn: Month | null;
  readonly proposal: { readonly monthly: Money; readonly course: Course; readonly changes: readonly AssignmentChange[] } | null;
}

export function evenedOutViewOf(offer: EvenOutOffer | null): EvenedOutView | null {
  if (offer?.kind !== "evenedOut") return null;
  return {
    monthly: offer.monthly,
    startMonth: offer.startMonth,
    course: courseOf(offer.forecast),
    runsDryIn: offer.forecast.runsDryIn,
    proposal: offer.proposal === null ? null : { monthly: offer.proposal.monthly, course: courseOf(offer.proposal.forecast), changes: offer.proposal.assignments },
  };
}
