import { type LocalDate, localDate } from "@holt/core";

/** The date and time the store and the import use. A test passes its own. */
export interface Clock {
  today(): LocalDate;
  now(): Date;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Today is the date on the family's own clock, not UTC's. */
export const systemClock: Clock = {
  today() {
    const now = new Date();
    return localDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
  },
  now: () => new Date(),
};
