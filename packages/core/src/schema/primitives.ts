/**
 * The branded values every schema is built from. A brand is built by core's own constructor, so a value
 * that passes here is one the rest of core accepts. A constructor that throws becomes an issue on the field,
 * because a parse that threw would escape the code that checks the result.
 */

import { z } from "zod";
import { accountNumber } from "../account-number.ts";
import { localDate, month } from "../dates.ts";
import {
  accountId,
  changeId,
  enteredValueId,
  groupId,
  householdId,
  importBatchId,
  importRowId,
  jobId,
  moveId,
  proposalId,
  ruleId,
  transactionId,
} from "../ids.ts";
import { currency, money } from "../money.ts";

const longestMessage = 200;

export function checked<Input, Output>(source: z.ZodType<Input>, build: (input: Input) => Output): z.ZodType<Output> {
  return source.transform((input, ctx) => {
    try {
      return build(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The value is not valid";
      ctx.issues.push({ code: "custom", message: message.slice(0, longestMessage), input });
      return z.NEVER;
    }
  });
}

const show = (value: number): string => (Object.is(value, -0) ? "-0" : String(value));

/** A safe integer, and never negative zero, which equals zero everywhere except `Object.is` and survives no JSON round trip. */
export function wholeNumber(min = Number.MIN_SAFE_INTEGER): z.ZodType<number> {
  return checked(z.number(), (value) => {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new RangeError(`Not a whole number: ${show(value)}`);
    if (value < min) throw new RangeError(`Too small: ${value} is below ${min}`);
    return value;
  });
}

/** A list that is never empty, with a message that says what the list is for. */
export function atLeastOne<T>(item: z.ZodType<T>, message: string): z.ZodType<[T, ...T[]]> {
  return z.array(z.unknown()).min(1, message).pipe(z.tuple([item], item));
}

/** A finite number for an entered value, which may have decimals. */
export const FiniteSchema = checked(z.number(), (value) => {
  if (Object.is(value, -0)) throw new RangeError("Not a number the app can store: -0");
  return value;
});

export const MoneySchema = checked(z.number(), (value) => {
  if (Object.is(value, -0)) throw new RangeError("Not a whole number of minor units: -0");
  return money(value);
});

export const CurrencySchema = checked(z.string(), currency);
export const AccountNumberSchema = checked(z.string(), accountNumber);
export const LocalDateSchema = checked(z.string(), localDate);
export const MonthSchema = checked(z.string(), month);

/** An ISO datetime from the caller's clock, with its offset. */
export const DateTimeSchema = z.iso.datetime({ offset: true });

export const ids = {
  household: checked(z.string(), householdId),
  account: checked(z.string(), accountId),
  group: checked(z.string(), groupId),
  job: checked(z.string(), jobId),
  transaction: checked(z.string(), transactionId),
  move: checked(z.string(), moveId),
  enteredValue: checked(z.string(), enteredValueId),
  change: checked(z.string(), changeId),
  proposal: checked(z.string(), proposalId),
  importBatch: checked(z.string(), importBatchId),
  importRow: checked(z.string(), importRowId),
  rule: checked(z.string(), ruleId),
};
