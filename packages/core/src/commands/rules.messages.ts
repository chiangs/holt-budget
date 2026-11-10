/** Why the app refused a rule or a plan start change (decision 0047). Each message names who acts. */
export const ruleMessages = {
  ruleNotFound: "The app can't find that rule.",
  ruleCounterpartyMissing: "You need to say who the rule is for.",
  ruleWeightNotPositive: "You need each share of a split to have a whole weight above zero.",
  ruleRangeBackwards: "You need the lowest amount to be no higher than the highest.",
  planStartMonthOpened: "You can't move the plan start once you've opened a month.",
} as const satisfies Record<string, string>;
