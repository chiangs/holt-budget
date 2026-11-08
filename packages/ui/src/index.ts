/**
 * Design-system components live here, built from the tokens in
 * design/design-system/tokens.json (see `pnpm tokens`).
 * Start with the components previewed in design/design-system/components/:
 * Button, NavItem, TickScale, ProportionBar, MonthRibbon, Suggestion.
 */
export const themes = ["hearth-light", "hearth-dark", "instrument-dark", "instrument-light"] as const;
export type ThemeId = (typeof themes)[number];
