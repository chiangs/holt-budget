/** Why the app refused a command about a contribution agreement (decision 0048). Each message names who acts. */
export const contributionMessages = {
  agreementNotFound: "The app can't find that contribution agreement.",
  personNotAdult: "You can only set up a contribution for an adult.",
  accountNotShared: "You can only have a contribution land in a shared account.",
  dayOutOfRange: "You need a day from 1 to 28.",
  agreementEndsBeforeStart: "You need the last month to be no earlier than the first.",
} as const satisfies Record<string, string>;
