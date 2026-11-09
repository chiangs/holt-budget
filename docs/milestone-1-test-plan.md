# Holt: Milestone 1 test plan (9 Nov 2026)

This plan says how each item in Milestone 1 of `BACKLOG.md` is proved. Each item ends in at least one test that fails when the behaviour breaks, and the plan names the layer and tool for it. It also lists the gaps against the definition of done in `CLAUDE.md`.

## Status (9 Nov 2026)

Every test below exists and passes locally, except where this section says otherwise.

- **Not run yet:** the four CI jobs have never run on GitHub. `ci.yml` and the shared setup action were not parsed by a YAML tool, because none is installed here.
- **P5 (shellcheck):** skipped locally because `shellcheck` isn't installed. The packaging script prints SKIP and runs it where it exists.
- **Added after the first draft:** the bridge returns refusals as data, with smoke tests that call it through the real context bridge (`apps/desktop/e2e/lockdown.spec.ts`). N7 also caught Chromium's spellchecker downloading a dictionary.
- **Smoke tests run in `cage`**, a headless Wayland compositor, on this machine, because it has no Xvfb. CI uses Xvfb.

## Layers

| Layer | Tool | Runs | What it proves |
|---|---|---|---|
| Unit | Vitest (`pnpm test`) | Every push | Pure logic and main-process modules that need no window: validation, migrations, the loopback rule, money formatting, message files |
| Static check | Node scripts (`pnpm lint:*`) | Every push | Rules about source text: colours, banned network modules, hard-coded strings |
| Smoke | Playwright for Electron (`pnpm test:e2e`) | Every push, in its own CI job under Xvfb | The built app opens, routes work, keys work, themes apply, the window resizes, axe finds nothing serious |
| Network | A script that runs the built app in a loopback-only network namespace (`pnpm test:no-network`) | Every push, in its own CI job | The app makes no outbound connection |
| Packaging | `pnpm dist` and `install.sh` in a scratch `HOME` | Every push, in its own CI job | The AppImage builds, the installer installs and the uninstaller removes |

Tests assert what the family or the next developer can observe: a rejected argument, a refused address, a route that renders, a file that appears. They don't assert which internal helper ran.

## Item 1: Window, sidebar, routes, themes

| ID | Layer | Test |
|---|---|---|
| W1 | Smoke | Every route in the screen map opens and shows its heading. |
| W2 | Smoke | Each of A O T P R M I S moves to its screen, and none fires while a text field has focus. |
| W3 | Smoke | Ctrl K opens Ask or find over the current screen, and Esc closes it (also covers item 5). |
| W4 | Smoke | At 1440, 1100 and 900 px wide the page has no horizontal scroll. Below the collapse width the sidebar shows icons and key letters only, and every item stays reachable. |
| W5 | Unit | The window options have no `minWidth` or `minHeight`, are frameless, and keep the sandbox settings (`contextIsolation`, `sandbox`, no `nodeIntegration`). |
| W6 | Smoke | Hearth light, Hearth dark and glass each set the theme attribute and change the computed background. Glass off leaves surfaces opaque, and reduced transparency turns glass off. |
| W7 | Smoke | Reduced motion removes transitions. |
| W8 | Smoke | axe reports no serious or critical violation on each route in each theme. |
| W9 | Static | `pnpm lint:colours` passes. CI already runs it. |
| W10 | Static | `pnpm tokens` leaves `tokens.css` unchanged. CI already runs it. |

## Item 2: Typed bridge, encrypted database, migrations

| ID | Layer | Test |
|---|---|---|
| B1 | Unit | A call with arguments that fail the Zod schema is rejected in the main process, and the handler body doesn't run. |
| B2 | Unit | A call to an unregistered channel is rejected. |
| B3 | Unit | The preload exposes exactly the channels the shared schema lists, and no more. |
| B4 | Unit | Migrations apply in order, set `PRAGMA user_version` to the highest applied number, and do nothing on a second run. |
| B5 | Unit | A migration that fails leaves the database at the previous version, with none of its changes. |
| B6 | Unit | A database with a newer `user_version` than the app knows is refused, not opened. |
| B7 | Unit | Each row schema matches `PRAGMA table_info` for its table: same columns, same nullability. This is the check promised in `technical-decisions.md` §4. |
| B8 | Unit | The household table's currency CHECK rejects anything but three capital letters. |
| B9 | Unit | The existing storage tests keep passing: key wrapping, encrypted file, backups. |

## Item 3: Network lock-down

| ID | Layer | Test |
|---|---|---|
| N1 | Unit | The loopback rule accepts `127.0.0.1` and `::1`, and refuses `localhost`, other private addresses, public hosts, and hostnames that merely start with `127.`. |
| N2 | Unit | The single main-process fetch function refuses a non-loopback URL before opening a socket, and follows no redirect to another host. |
| N3 | Unit | The renderer request filter allows the app's own files and, in development only, the dev server. It cancels loopback, `http:`, `https:`, `ws:` and `wss:` requests. |
| N4 | Static | `pnpm lint:network` fails on `node:http`, `node:https`, `node:net`, `node:dgram`, `node:tls`, `undici`, `axios`, `node-fetch` and the global `fetch` in `apps/desktop/src/main`, except in the one allowed file. |
| N5 | Static | The CSP in `index.html` has `default-src 'self'`, no `unsafe-eval`, and no remote origin. |
| N6 | Smoke | A page that tries `fetch("https://example.com")` and `fetch("http://127.0.0.1:1")` fails both, and the filter logs both. |
| N7 | Network | The built app runs in a namespace with only loopback. It opens its window and exits cleanly with no connection attempt to any address except loopback. |

## Item 4: Message files and money formatting

| ID | Layer | Test |
|---|---|---|
| M1 | Static | `pnpm lint:strings` fails on visible text written directly in JSX in `apps/desktop/src/renderer/src`, and on `aria-label`, `title` and `placeholder` string literals. |
| M2 | Unit | Every message ID used in the code exists in the en-GB file, and every ID in the file is used or marked as reserved. |
| M3 | Unit | Every message parses as valid ICU. |
| M4 | Unit | NOK in English shows "68,048 kr", and in Norwegian "68 048 kr". |
| M5 | Unit | Other currencies follow `Intl` ("$68,048", "€68,048", yen with no decimals). Zero, negative and large amounts format correctly. |
| M6 | Unit | Formatting takes integer minor units and the currency's own digit count, so 6804800 øre shows as 68,048 kr, and a non-integer is refused. |

## Item 5: Ask or find overlay

Covered by W3. It adds one more smoke test, S1: the overlay opens over the current screen without changing the URL hash, returns focus to the previously focused element on close, and traps focus while open.

## Item 6: Packaging

| ID | Layer | Test |
|---|---|---|
| P1 | Packaging | `pnpm dist` produces an AppImage. |
| P2 | Packaging | The packaged app contains no prebuilt SQLite binaries for other platforms. |
| P3 | Packaging | `install.sh --yes --no-open` in a scratch `HOME` leaves the app, the `holt` command and the desktop entry. |
| P4 | Packaging | `uninstall.sh` removes those and leaves the data folder. |
| P5 | Static | `shellcheck` passes on both scripts. |

## Gaps against the definition of done

| Requirement in `CLAUDE.md` | Status | Closed by |
|---|---|---|
| Tests pass, types check | Exists | CI |
| The no-network test passes | Missing | N7 |
| `private/check-public.sh` passes, if it exists | Not checked in CI, because `private/` is gitignored | Run by hand before each push |
| Hearth light, dark and glass, and keyboard alone | Missing | W2, W6, W8 |
| Accessibility with axe | Missing | W8 |
| Playwright for Electron smoke tests | Missing | The smoke layer |
| Interface text from the message files | Missing | M1, M2 |

## Order of work

1. Static checks with no dependency on the app: N4, M1.
2. Unit tests that come with their modules: B1 to B8, N1 to N3, M2 to M6, W5.
3. Smoke harness once the shell exists: W1 to W8, N5, N6, S1.
4. Network and packaging jobs last, because they need a built app: N7, P1 to P5.

## Not covered in Milestone 1

Behaviour in Norwegian beyond the money format, Follow my desktop, and the model endpoint. They belong to Milestone 6.
