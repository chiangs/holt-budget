# 0049 Versioning: alpha until the plan is done, then beta until Stephen says v1

Status: proposed. The check and the bump are built as this record says; the two points in "For Stephen to confirm" are not yet decided.
Date: 2026-11-11

## Question
How does the app's version track the plan, so that a coding agent always sets and bumps the right one — alpha while any milestone is open, beta when all seven are done, and 1.0.0 only when Stephen says so?

## The rule
The version is one number, in `apps/desktop/package.json`. The app shows it (About), the AppImage and `install.sh` carry it, and nothing else ships a version. The private packages (`@holt/core`, `@holt/importers`, `@holt/ui`) keep `0.0.0`, and the check fails if they leave it.

The number is set by the plan in `BACKLOG.md`, which is the source of truth:

| The plan | The version |
|---|---|
| Any milestone open | `0.M.0-alpha.N`, where M is the number of milestones complete (0 to 6) |
| All seven complete, v1 not declared | `0.7.0-beta.N` |
| All seven complete and the `v1` item in `BACKLOG.md` is ticked | `1.0.0`, then ordinary semver |

- A milestone is complete when every box under it is ticked, and only then.
- The v1 box alone does not make v1: it needs every milestone complete too. Ticked early, it changes nothing and the bump is left to a person.
- M counts complete milestones, so it does not matter which ones are done.
- N counts builds within the stage and starts at 1 for each new M: `0.5.0-alpha.3` is the third build with five milestones complete.
- A version is never lowered or reused: it must be after the newest `v*` tag.
- After 1.0.0 the rule stops: later releases are ordinary semver and are chosen by hand, not bumped.

## How it is enforced
- `scripts/version-state.mjs` reads `BACKLOG.md` and says the stage, how many milestones are complete, and which boxes are still open; `scripts/version-state.test.ts` pins the reading and the version math.
- `pnpm version:check` (run in CI, job `check`) fails when the app's version is not the one the plan allows, when a private package leaves `0.0.0`, or when the version is not after the newest tag. Its message names the stage and the open boxes, so the agent sees what to finish or what to bump.
- `pnpm version:bump` works out the next version from the plan, writes it to `apps/desktop/package.json`, and prints the tag for the commit (like `v0.3.0-alpha.1`). It refuses to lower a version and refuses to guess after a version the plan does not set.
- CLAUDE.md says the version is set by the plan and names the two commands, so an agent that reads the repository finds the rule before it touches a number.

## For Stephen to confirm
1. **Milestone 1 is still open on the app icon** ("not a priority", in the backlog), so it does not count as complete and the version is `0.3.0-alpha.N`, not `0.4.0`. Fix the icon or strike the item with a note, and the next bump moves to M4's work.
2. **"To decide" (the updater) does not gate beta.** The updater is not part of any milestone, so the seven milestones alone move Holt from alpha to beta. If the updater decision must land first, it becomes a box under a milestone, and the check gains nothing.

## First state
`0.3.0-alpha.1`: Milestones 0, 2 and 3 complete; Milestone 1 open on the icon; Milestones 4, 5 and 6 ahead.
