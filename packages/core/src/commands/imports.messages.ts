/** Why the app refused an import command. Owned by the import work (decision 0047). */
export const importMessages = {
  importFingerprintLive: "The app has already imported this file. To import it again, undo that import first.",
  importDisagrees: "The app can't import this file, because its rows and transactions don't agree.",
  importNotFound: "The app can't find that import.",
  importAlreadyUndone: "You've already undone this import.",
  mergeSameTransaction: "You need two different transactions to merge.",
  mergeMismatch: "The app can only merge two transactions on the same account with the same amount.",
  mergeSameFile: "The app can't merge these, because one bank file lists them both, so they are two transactions.",
  transferSameAccount: "You need two transactions in different accounts to make a transfer.",
  transferAmountsDiffer: "You can only pair two transactions with the same amount going opposite ways.",
  transferAlreadyPaired: "You've already paired one of these transactions with another.",
  moveDoesNotMatch: "The app can only mark a move at the bank done with a transfer between the same accounts for the same amount.",
} as const satisfies Record<string, string>;
