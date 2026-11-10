/** Accessors for tests that read figures. Each throws when the figure is missing, so a test fails loudly. */

import { month } from "../dates.ts";
import type { AccountFigures, Figures, JobMonth, MonthFigures, Unassigned } from "../figures/index.ts";
import type { AccountId, JobId } from "../ids.ts";

export function monthIn(figures: Figures, m: string): MonthFigures {
  const found = figures.months.get(month(m));
  if (found === undefined) throw new Error(`No figures for ${m}`);
  return found;
}

export function jobIn(figures: Figures, job: JobId, m: string): JobMonth {
  const found = monthIn(figures, m).jobs.get(job);
  if (found === undefined) throw new Error(`No figures for job ${job} in ${m}`);
  return found;
}

export function accountIn(figures: Figures, account: AccountId): AccountFigures {
  const found = figures.accounts.get(account);
  if (found === undefined) throw new Error(`No figures for account ${account}`);
  return found;
}

/** Unassigned money as one signed number: negative when over-assigned. */
export function signed(unassigned: Unassigned): number {
  return unassigned.kind === "unassigned" ? unassigned.amount : -unassigned.amount;
}
