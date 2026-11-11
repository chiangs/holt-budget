/** Why the app refused a move of money between buckets (decision 0048). Each message names who acts. */
export const bucketTransferMessages = {
  transferMonthNotStarted: "You can only move money between buckets in a month you've opened.",
  bucketNotKept: "You can only move money between jobs that keep their money in a bucket.",
  bufferMoveNeedsReason: "You need to say why you're taking money out of the buffer.",
  bucketHoldsLess: "You can't move more than the bucket holds at the end of the month.",
  jobHasTransfers: "You can't delete a job while a move between buckets names it. You can archive it instead.",
} as const satisfies Record<string, string>;
