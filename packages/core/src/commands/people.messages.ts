/** Why the app refused a command about a person (decision 0048). Each message names who acts. */
export const personMessages = {
  personNotFound: "The app can't find that person.",
  personInUse: "You can't delete a person while a contribution agreement names them.",
} as const satisfies Record<string, string>;
