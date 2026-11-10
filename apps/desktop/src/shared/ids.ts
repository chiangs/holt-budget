/**
 * Making IDs. Core never makes one (it has no clock and no randomness), so the code that builds a command
 * does (the main process for an import, the page for a rule the family adds) and the command carries it in. An ID is a UUIDv7: 48 bits of milliseconds, so IDs sort in the order they were
 * made, a 12-bit counter that keeps IDs made in the same millisecond in order, and random bits.
 */

import {
  type Id,
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
} from "@holt/core";

const builders = {
  household: householdId,
  account: accountId,
  group: groupId,
  job: jobId,
  transaction: transactionId,
  move: moveId,
  enteredValue: enteredValueId,
  change: changeId,
  proposal: proposalId,
  importBatch: importBatchId,
  importRow: importRowId,
  rule: ruleId,
} as const satisfies Record<string, (value: string) => Id<string>>;

export type IdKind = keyof typeof builders;

/** Makes a new ID of the kind asked for. */
export type IdMint = <K extends IdKind>(kind: K) => Id<K>;

export interface MintSources {
  /** Milliseconds since the epoch. */
  now(): number;
  /** Fills the array with random bytes. */
  random(bytes: Uint8Array): void;
}

const systemSources: MintSources = { now: () => Date.now(), random: (bytes) => bytes.set(crypto.getRandomValues(new Uint8Array(bytes.length))) };

const counterLimit = 0x1000;

/** A mint whose IDs are strictly increasing, even when the clock stands still or steps back. */
export function createMint(sources: MintSources = systemSources): IdMint {
  let lastMs = -1;
  let counter = 0;
  const bytes = new Uint8Array(16);

  function next(): string {
    let ms = sources.now();
    if (ms > lastMs) {
      lastMs = ms;
      sources.random(bytes.subarray(0, 2));
      counter = ((bytes[0] as number) << 8 | (bytes[1] as number)) & 0x7ff;
    } else {
      counter += 1;
      if (counter >= counterLimit) {
        lastMs += 1;
        counter = 0;
      }
      ms = lastMs;
    }
    sources.random(bytes.subarray(8, 16));
    bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
    bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
    bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
    bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
    bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
    bytes[5] = ms & 0xff;
    bytes[6] = 0x70 | (counter >> 8);
    bytes[7] = counter & 0xff;
    bytes[8] = 0x80 | ((bytes[8] as number) & 0x3f);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return <K extends IdKind>(kind: K): Id<K> => builders[kind](next()) as Id<K>;
}

/** The mint the app uses. */
export const mintId: IdMint = createMint();
