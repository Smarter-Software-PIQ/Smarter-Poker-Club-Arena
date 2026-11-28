---
name: smarter-design
description: >
  The #SmarterDesign standard for Club Arena pages: the arena workspace look
  (illustrated mast with the chrome "?", thin chrome cases, chrome readout
  tiles, chrome keys that light blue when selected, chrome list rows) that
  Player Management, the Cashier, Club Data and every Club Operations page use.
  Use when Dan writes "#SmarterDesign", asks to upgrade, enhance, redesign or
  restyle a Club Arena page or sub page, says a page is "generic", "boring" or
  "the old style", or asks for before/after screenshots of a page. Read it in
  full before touching a page and pass it to any subagent you spawn.
version: 1.0.0
---

# #SmarterDesign: the arena workspace standard

## 0. Dan's rulings, verbatim (2026-11-27)

- "INSIDE THE PLAYER MANAGEMENT PAGE AT THE TOP ... YOU SEE THE 'CLUB OPERATIONS'. THAT NEEDS TO BE ENHANCED WITH THE #SMARTERDESIGN, AS WELL AS EVERY SINGLE ONE OF THESE PAGES, WHEN CLICKED NEED THE SAME UPGRADE, ENHANCEMENT AND IMPROVEMENT TO THEM ALL."
- On a first pass built from the painted console plates: "THAT IS NOT THE #SMARTERDESIGN. WTF?!"
- About another page the same day: "DO NOT USE THOSE BULKY FRAMES, THATS THE OLD STYLE... USE THE #SMARTERDESIGN STYLE".

So for a routed page, a sub page or a workspace, **#SmarterDesign is the standard and the painted console plates are the old style.** Do not use `src/components/console/SpadeConsole`, `sc-*` plate classes, `ops-console-v1` keys, `club-nav-shell` bars or any painted frame art on a page. `.claude/skills/club-arena-console/SKILL.md` (#ClubArenaConsole) still applies only when Dan names #ClubArenaConsole or a specific painted master for a specific surface.

## 1. Where it already lives (copy these, do not invent)

| Page                         | File                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------- |
| Player Management            | `src/pages/ClubMembersPage.tsx`, `src/components/club/RosterRecords.tsx` + `.css` |
| Cashier                      | `src/pages/CashierPage.tsx`                                                       |
| Club Data                    | `src/pages/club/ClubDataSimplePage.tsx`                                           |
| Club Operations Overview     | `src/pages/club/ClubOperationsPage.tsx`                                           |
| Finance and Control Overview | `src/pages/workspaces/ArenaWorkspacePages.tsx`                                    |
| Reports, Hand Review         | `src/pages/ReportReviewPage.tsx`, `src/pages/ClubHandReviewPage.tsx`              |
| Dashboard                    | `src/pages/club/ClubDashboard.tsx`                                                |
| Settings                     | `src/pages/ClubSettingsPage.tsx`                                                  |

Stylesheet: `src/components/lobby/ArenaWorkspace.css`. Shared kit: `src/components/ops/ArenaOps.tsx` + `.css`. Changelogs: `docs/changelog/2026-11-27-player-management-bottom-smarterdesign.md`, `docs/changelog/2026-11-27-club-operations-smarterdesign.md`.

## 2. The pieces

- **Page root:** class `arena-workspace` (dark #050d17, chrome art variables).
- **Mast:** `<ArenaWorkspaceHeader area title context subtitle summary steps emblem />` from `src/components/lobby/ArenaWorkspaceHeader.tsx`. It draws the illustrated scene, the chrome medallion, Barlow italic title and the chrome "?" top right, so a page never renders a second PageHelp. Areas: members, record, cashier, data, stats, operations, dashboard, reports, integrity, handreview, finance, control, settings. A "Back" button goes above the mast, never inside it. `context` is the club name, never a placeholder such as "Club Arena".
- **Live line and meters under the mast:** `<PageBar titleAs={false} showHelp={false} title status metrics />`; inside a Club Operations page its metrics render as one even row of chrome meters.
- **Sections:** `<section className="arena-case arena-ops-case"><h2 className="arena-section-title">Title<small>note</small></h2>...</section>`, or `ClubPageSection` with `arena`.
- **Readouts:** `ArenaReadings` (chrome `arena-meter` tiles; tones live, attention, danger).
- **Keys, tabs, filters:** `<div className="arena-switch">` with direct-child buttons or links. `aria-pressed="true"`, `aria-selected="true"`, `aria-current="page"` or class `active` lights a key blue. `arena-ops-keys` wraps two per row on a phone; `arena-ops-primary` lights the first key as the primary action. Never one full-width bulky key per line on a phone.
- **Rows:** `ArenaRow` (numeral, title, line, gold or red signal, chevron) inside `ul.arena-ops-rows`, or `className="arena-ledger-row"` on a row of your own.
- **Fields:** `arena-ops-well`.
- **Empty, loading, error:** `ArenaState` with the page's own wording.

## 3. Rules the tests enforce

- No `:hover` rules (`tests/no-hover-effects.law.test.ts`).
- Title Case copy and no em dashes (`scripts/ci/check-ui-text.mjs`, `check-title-case.mjs`).
- Every class you add must resolve in a stylesheet the component loads (`tests/unit/classNamesResolve.test.ts`, frozen baseline).
- Animations keep playing (`tests/animations-always-play.law.test.ts`).
- smarter.poker colours only: chrome blues (#45adff, #74dfff, #087cfa, #0044ac), gold #ffd700, red #ff5a6a and panel darks. No browns, pinks or purples. Gold numbers, not badge boxes.
- Figures go through `src/utils/format.ts`, which stops at two decimals and cuts, never rounds.
- The Club Operations pages are pinned by `tests/club-operations-pages-stay-smarterdesign.law.test.ts`.

## 4. How to work

1. Read the reference page closest to yours and the tests that pin your file (`grep -rl <Component> tests`).
2. Rebuild the page's controls in place. Keep its layout, data reads, routes, wording, aria and anything a test asserts. This is a visual rebuild.
3. Render before and after with the harness (section 6) at 393px and 1280px.
4. Send the side-by-side sheets to Dan in the chat and wait for his approval before you push or publish a design.

## 5. Traps that cost time on 2026-11-27

- The CLAUDE.md redesign pointer used to send every agent to the painted plates. That pass was rejected outright. Start from section 1, not from a master PNG.
- Do not rebuild Players or Club Data; they were the reference.
- `PageBar` requires `title` even with `titleAs={false}`; it labels the meters.
- `ArenaRow` puts `signalLabel` in `aria-label`; when a test reads "9 Waiting" as text, keep the text visible.
- A python `str.replace` patch fails silently after Prettier rewraps a line: assert every replacement.
- The lint job has a hard warning ceiling: an unused import or binding fails it.

## 6. Render harness (`harness/`)

It serves the real app (router, layout, guards, the rail) with four modules swapped for offline stand-ins: `src/lib/supabase.ts`, `ClubWorkspaceContext`, `useClubNavigationAccess` and `useAuthUser`. Every route then renders as Kings Club's owner with fixture data (`harness/fixtures.ts`: rake `403.3814552027556`, 174 members, alerts). Nothing here is imported by the app or shipped.

```bash
# after: this checkout
bash .claude/skills/smarter-design/harness/run.sh 5199
node .claude/skills/smarter-design/harness/shot.mjs http://127.0.0.1:5199 /tmp/after operations,dashboard-full,members 393,1280

# before: main, in a detached worktree on another port
git worktree add --detach /tmp/before origin/main && ln -s "$PWD/node_modules" /tmp/before/node_modules
bash /tmp/before/.claude/skills/smarter-design/harness/run.sh 5198   # if main lacks the harness, copy this folder there first
node .claude/skills/smarter-design/harness/shot.mjs http://127.0.0.1:5198 /tmp/before operations,dashboard-full,members 393,1280

python3 .claude/skills/smarter-design/harness/sheet.py /tmp/before /tmp/after /tmp/sheets operations,dashboard-full,members 393 2600 0.75
```

Requirements: `playwright-core` (already a dependency) and Chrome at `/usr/bin/google-chrome` or `CHROME_PATH`. Notes:

- A page that waits on a read the fixtures lack shows its empty or error state. Add the RPC or table to `fixtures.ts` (shapes are in the page's own tests).
- The server runs with no file watcher, so restart it (`run.sh`) after editing source.
- Fixture keys must match what the page reads (the activity series uses `d` for the day).
