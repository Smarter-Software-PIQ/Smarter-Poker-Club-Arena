---
name: smarter-design
description: >
  The #SmarterDesign standard for routed page sections in Club Arena: the arena
  workspace language (thin chrome case, section title over a hairline, chrome
  readout tiles, chrome-stat buttons with one lit primary, dark search-well
  fields, chrome ledger rows) from src/components/lobby/ArenaWorkspace.css.
  Use when the user writes "#SmarterDesign" or "#SMARTERDESIGN", says "smarter
  design", "upgrade this section", "upgrade the bottom of this page", or asks to
  restyle, upgrade or enhance a section of a routed Club Arena page (Player
  Management, Cashier, Club Data, Stats, a player record, any operator page).
  It is NOT the painted SpadeConsole: read this before reaching for
  .claude/skills/club-arena-console. Every agent or subagent doing the work must
  read this file in full and pass it to any subagent it spawns.
version: 1.1.0
---

# #SmarterDesign: The Arena Workspace Language

Repo: `Smarter-Poker-Club-Arena`. Read `CLAUDE.md`, `AGENT-PLAYBOOK.md` and
`PUBLISHING.md` first; they own delivery, money and law. This file owns what a
section of a routed page looks like.

---

## 0. Why this file exists

On 2026-11-27 Dan sent a screenshot of the bottom of Player Management:
"ALL OF THIS ON THE BOTTOM OF THE PLAYER MANAGEMENT PAGE NEEDS TO BE UPGRADED
WITH THE #SMARTERDESIGN". An agent read the tag as the painted #ClubArenaConsole
spade frames and rebuilt the section on `SpadeConsole`. Dan rejected it on
sight, verbatim:

> "NO DO NOT USE THOSE BULKY FRAMES, THATS THE OLD STYLE... USE THE
> #SMARTERDESIGN STYLE FOR THESE."

The approved result is PR #12235 (squash `eaef16ff5`):
`src/components/club/RosterRecords.tsx` and `RosterRecords.css`, changelog
`docs/changelog/2026-11-27-player-management-bottom-smarterdesign.md`. Until
then the tag had no written definition; this is it.

> **#SmarterDesign on a routed page = the arena workspace already worn by the
> top of Player Management and by the Cashier. Thin chrome, live HTML, no
> painted console.**

---

## 1. What it is NOT

- **Not the painted SpadeConsole** (`src/components/console/SpadeConsole.tsx`,
  `top.png` / `mid.png` / `bottom-plates.png`, crest, header well, painted
  plates, `SPADE_CONSOLE_ZONES`). On a routed page section that is "THE OLD
  STYLE" and "BULKY FRAMES". Never wrap a page section in `SpadeConsole`,
  never print a section into console zones, never put a `PlateButton` under a
  section.
- **Not the Buy-In four-bay deck** (`BUY_IN_ZONES`). That belongs to the buy-in
  family's dialogs only.
- **Not a new look.** You do not invent gradients, radii, shadows, colours or
  a new frame. Every piece below already exists in `ArenaWorkspace.css`; you
  put the section's real controls into those classes. If a section needs a
  piece the workspace has no rule for, dress it from the workspace's own
  variables and inks (the way `RosterRecords.css` dresses its disclosures),
  in the section's own stylesheet.
- **Not an image header.** A section inside a page gets an
  `arena-section-title`, never a panorama mast (section 4).

### How it relates to #ClubArenaConsole

Both are Dan's and they do not conflict; they govern different surfaces.

| Surface                                                                | Standard                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A popup, modal, sheet or dialog (buy-in, rebuy, confirm, rules)        | #ClubArenaConsole, `.claude/skills/club-arena-console/SKILL.md`            |
| A section of a routed page (Player Management, Cashier, Club Data ...) | #SmarterDesign, this file                                                  |
| A store / Marketplace page                                             | #ClubArenaConsole section 0.1 (keep the store's layout, upgrade its parts) |
| The lobby's game cards                                                 | the lobby's own card art (`ArenaGameCard`)                                 |

The Cashier states the split in its own stylesheet header
(`src/pages/CashierPage.module.css`): routed cashier pages "follow the Players
directory layout without large frames"; "#ClubArenaConsole is the visual
authority of financial dialogs". The Cashier's confirm dialog (`consoleDialog`)
still wears its master; its page sections wear the workspace.

The console's core idea still holds here: **the frame is art, not CSS.** Every
rim in the workspace is a painted chrome slice from
`src/components/lobby/console-art/` laid with `border-image` (nine-slice metal,
so the corners stay intact and the case grows with its content). What CSS adds
is only the dark glass fill behind the chrome, from the workspace's own
variables. So the console's "never write `border-radius` or a gradient to make
something look like a control" still binds you: you never write a NEW one. You
use `var(--arena-tile)`, `var(--arena-panel)` and the existing class rules.

---

## 2. The kit (all in `src/components/lobby/ArenaWorkspace.css`)

### 2.1 The shell: `.arena-workspace`

Every workspace rule is scoped under `.arena-workspace`, so **the page root
must carry the class** or none of it applies. Player Management:
`<div className="club-members-page arena-workspace members-simple">`. Cashier:
`` `${styles.page} arena-workspace arena-cashier` ``.

The shell sets `background: #050d17`, `color: #f1f5fc`, padding
`7px 6px max(18px, env(safe-area-inset-bottom))`, and the variables:

| Variable          | Value                                                                                                           | Job                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `--arena-frame`   | `url('./console-art/chrome-case.webp')`                                                                         | the thin case around a section  |
| `--arena-row`     | `url('./console-art/chrome-row.webp')`                                                                          | a ledger row, a disclosure      |
| `--arena-stat`    | `url('./console-art/chrome-stat.webp')`                                                                         | a readout tile, a button        |
| `--arena-active`  | `url('./console-art/chrome-active.webp')`                                                                       | the lit / pressed / primary rim |
| `--arena-readout` | `url('./console-art/chrome-readout.webp')`                                                                      | the mast, a hero readout        |
| `--arena-panel`   | `radial-gradient(ellipse at 90% -40%, #1e3853, transparent 63%), linear-gradient(145deg, #091727, #030b14 74%)` | case glass                      |
| `--arena-tile`    | `linear-gradient(155deg, #12273b, #07111c 70%)`                                                                 | tile and button glass           |

`ArenaWorkspace.css` is imported by `ArenaWorkspaceHeader.tsx`. A section
component that only imports its own sheet (as `RosterRecords.tsx` does) relies
on the page having mounted the header, which every workspace page does. In a
harness render, mount the section inside an `.arena-workspace` element and
import `ArenaWorkspace.css` yourself.

### 2.2 The case: `.arena-case`

`box-sizing: border-box; position: relative; background: var(--arena-panel);
border: 0; border-radius: 0; box-shadow: none; padding: 12px; margin: 7px 0`.
Its `::before` (inset 0, `z-index: 1`, `pointer-events: none`) paints the
chrome: `border-image: var(--arena-frame) 41 / 19px stretch`.

Because the chrome is a `z-index: 1` overlay, put the section's children above
it: `RosterRecords.css` does `.arena-workspace .roster-records > * { position:
relative; z-index: 2; }`.

The same case rule also dresses `.members-console`, `.members-list`,
`.mm-card`, `.stats-command-deck` and `.stats-intelligence-brief`. A new
section uses `arena-case`; do not add its class to that list.

### 2.3 The section title: `.arena-section-title`

An `h2` (in a case, the first child). Flex, `justify-content: space-between`,
`min-height: 30px`, `padding: 0 3px 5px`, a hairline `border-bottom: 1px solid
#253e57`, ink `#f1f5fc`, `font: 800 20px/1.05 'Arial Narrow', Arial,
sans-serif`, `letter-spacing: -0.35px`. A `<small>` inside it rides the right
edge: `10px/1.35 Arial`, `#9aabba` (Roster Records uses `11px` and `#9fbacc`
for its counts and "Staff Only").

### 2.4 Readout tiles: `.arena-meter`

`border: 5px solid transparent; border-image: var(--arena-stat) 11 / 6px
stretch; background: var(--arena-tile); text-align: center; padding: 5px 2px;
min-width: 0`. The same rule dresses `.ca-page-bar__metric` and `.hero-stat`.

The live tone: the **workspace** only colours
`.ca-page-bar__metric[data-tone='live'] dd` (`#74dfff`). `.arena-meter` itself
has no `data-tone` rule in `ArenaWorkspace.css`; Roster Export sets
`data-tone="live"` on its Selected tile and colours it in its own sheet,
`.arena-workspace .roster-records__meters [data-tone='live'] dd { color:
#74dfff; }`. Do the same: set `data-tone="live"` on the tile and colour the
`dd` with `#74dfff` in your section's sheet. Lay tiles out in a grid
(`repeat(3, minmax(0, 1fr))`, `gap: 4px` in Roster Export; four across in the
Player Management page bar). Label `dt`: `700 10px/1.2 'Arial Narrow'`,
`#9fbacc`. Value `dd`: `800 18px/1.1 'Arial Narrow'`, `#f1f5fc`,
`tabular-nums`.

### 2.5 Chrome-stat buttons: `.arena-switch`

A flex row (`gap: 4px; margin: 7px 0`) of buttons or links. Each child:
`flex: 1; min-height: 44px; padding: 6px 5px; color: #dce5ef; background:
linear-gradient(#152639, #06111e 65%); border-radius: 6px; font: 700 12px
'Arial Narrow'`, and an `::after` that paints the rim with `border-image:
var(--arena-stat) 11 / 6px stretch`.

**The active state** (in `ArenaWorkspace.css`): a child with
`[aria-pressed='true']`, `[aria-selected='true']` or `.active` turns white on
`linear-gradient(#087cfa, #0044ac 55%, #002b68)` and its `::after` swaps to
`border-image-source: var(--arena-active)`. A child with
`[aria-current='page']` gets the active rim directly on `#084397`. Use the
ARIA attribute that is true for the control; never fake `.active`.

**The lit primary** is not in `ArenaWorkspace.css`; each section declares its
one primary action in its own sheet with the same two moves. Roster Export:

```css
.arena-workspace .roster-records__actions > .roster-records__primary {
  color: white;
  background: linear-gradient(#1678ec, #064da9 52%, #082d60);
}
.arena-workspace .roster-records__actions > .roster-records__primary::after {
  border-image-source: var(--arena-active);
}
```

The same lit gradient and `--arena-active` rim are used by
`.members-history-action` (workspace sheet) and the last button of
`.arena-transfer-review .club-page-actions` (the Cashier transfer review).
One lit primary per group; everything else stays steel.

Pressed feedback is `:active { filter: brightness(0.86); }`; keyboard focus is
`:focus-visible { outline: 2px solid #9ae5ff; outline-offset: 2px; }`;
disabled is `opacity: 0.5; cursor: default`.

The same switch rule also dresses `.members-mode-toggle`,
`.members-simple-tabs`, `.stats-range-row` and `.stats-pill-tabs`.

### 2.6 Ledger rows: `.arena-ledger-row` and `.member-row`

`border: 4px solid transparent; border-image: var(--arena-row) 13 / 6px
stretch; background: linear-gradient(108deg, #13253a, #060e18 72%);
border-radius: 0; box-shadow: none`. Every record in a list, and every
disclosure `summary`, is one of these. Roster Records dresses its `summary`
the same way (`min-height: 44px`, `padding: 6px 10px`, `700 14px/1.2 'Arial
Narrow'`, `#dce5ef`, the native marker hidden) with a chevron of two
`2px solid #74dfff` strokes that turns from `rotate(45deg)` to
`rotate(225deg)` when open. The Cashier's `.txRow` uses the same row rim on
`var(--arena-tile)`.

### 2.7 Fields: the `.members-search` well

`.arena-workspace.club-members-page .members-search`: `min-height: 40px;
padding: 0 8px; background: #040d17; border: 1px solid #476079`; the input is
borderless and transparent inside it, `13px/1.25 Arial`. This rule is scoped
to `.club-members-page`, so on another page copy the well, not the selector:
Roster Records' history fields are `min-height: 44px; padding: 0 8px;
background: #040d17; border: 1px solid #476079; border-radius: 0; color:
#f1f5fc; color-scheme: dark; font: 16px/1.2 Arial`. Inputs keep `16px` so iOS
does not zoom on focus.

### 2.8 Inks

| Ink                   | Job                                                        |
| --------------------- | ---------------------------------------------------------- |
| `#f1f5fc`             | titles, values (the shell ink)                             |
| `#dce5ef`             | button and summary labels, body copy                       |
| `#9fbacc`             | labels, counts, meta (`#9aabba`, `#b6c8d6` in older rules) |
| `#74dfff`             | live values, emphasis, chevrons, timestamps                |
| `#9ae5ff`             | focus rings                                                |
| `#476079`             | field hairline                                             |
| `#253e57`             | section-title hairline                                     |
| `#040d17`             | field and receipt glass                                    |
| `#35d95a` / `#c8ffd2` | success rule and ink                                       |
| `#ffd700` / `#ffe98a` | preparing / pending rule and ink                           |
| `#f02849` / `#ff5b6e` | error rule and ink                                         |

These are the Smarter.Poker schema's tokens (see #ClubArenaConsole section
3.4). No browns, no pinks, no derived tones.

---

## 3. Reference implementations

Read these before you write a line; your section should look like it was
always part of them.

1. **The top of Player Management**, `src/pages/ClubMembersPage.tsx`: the
   `ArenaWorkspaceHeader` mast (`area="members"`), the `PageBar` with four
   metrics (Online Now carries `tone: 'live'`), the `.members-console` case
   ("Find A Player", the `.members-search` well, the `.members-simple-tabs`
   switch) and the `.members-list` case of `.member-row` cards.
2. **The Cashier**, `src/pages/CashierPage.tsx` with
   `src/pages/CashierPage.module.css`: Wallet Balances as an `arena-case`
   with an `arena-section-title`, the tab nav as an `arena-switch`, each panel
   (Send Chips, Distribute Chips, Transaction History) as an `arena-case`,
   transaction rows on the `--arena-row` rim, and the transfer review
   (`arena-transfer-review`, `arena-transfer-amount`, `arena-transfer-lines`).
3. **The bottom of Player Management**, `src/components/club/RosterRecords.tsx`
   / `.css` (PR #12235): `RosterExportCase` (an `arena-case` titled Roster
   Export, three `arena-meter` tiles Loaded / Matching / Selected, an
   `arena-switch` group with Select Loaded / Clear Selection and the lit
   Export CSV / Export Selected (n), the Export Scope note, the receipt, and a
   Metric Definitions ledger-row disclosure) and `ChangeHistoryCase` (an
   `arena-case` titled Change History with "Staff Only", the audit disclosure,
   search-well fields, chrome-stat buttons with Refresh lit, one ledger row per
   record). The component owns no state: the page keeps every handler, guard
   and test-pinned literal, and passes them in. Copy that shape.

`src/pages/club/ClubDataSimplePage.tsx` also prints its stats on
`arena-meter`.

---

## 4. Dan's rules that bind here

- **Title Case** on every word a player reads; data goes through `titleCase()`
  at the print site. Gates: `scripts/ci/check-title-case.mjs`,
  `scripts/ci/check-nav-title-case.mjs`. Do not add
  `text-transform: uppercase` to make a title shout.
- **No em dashes** (U+2014) in UI text: `scripts/ci/check-ui-text.mjs`. "Em
  bars" means that character and nothing else (CLAUDE.md 10.7).
- **No `:hover`, ever** (`tests/no-hover-effects.law.test.ts`). `:active` and
  `:focus-visible` only.
- **Nothing cheap or flat.** Every rim is the chrome art; a bare `1px solid`
  box, a flat fill button, a plain text link where a control belongs or a
  floating glyph is the "before", not the "after". The disclosure chevron and
  the field hairline are the only drawn lines, and both are already specified
  above.
- **Every image display header carries the chrome "?"** in its upper-right
  corner: `PageHelp` (`src/components/help/PageHelp.tsx`) renders
  `images/header-help-v4.png` (the approved chrome "?" in a ring) as the
  `.ca-page-help` button. `ArenaWorkspaceHeader` already mounts it, and
  `.arena-workspace .arena-workspace-mast > .ca-page-help` pins it at
  `top: 8px; right: 10px`. Never draw a "?" glyph or a CSS circle.
- **A "Back To Dashboard" button sits ABOVE an image header, never inside
  it.** The mast holds the medallion, the lettering and the "?" only.
- **A section title inside a page is not an image header.** It is an
  `arena-section-title` in an `arena-case`. One page, one mast, at the top.
- **The page keeps its logic.** Re-render, do not rewrite: every handler,
  ref, double-tap guard, focus behaviour, ARIA role and test-pinned literal
  survives, as literals in the JSX.
- **Horses are never named** in a section (`tests/a-horse-is-never-named.law.test.ts`),
  and figures follow the current figure laws (`exactChips()`, no K/M/B).
- Mobile first: design at 375px, verify at 393px. Touch targets 44px.
- No new unstyled class hooks (`tests/unit/classNamesResolve.test.ts`): every
  `className` you add has a rule in a sheet the route loads.

---

## 5. The e2e trap (PR #12257)

When you replace a control, **its old class names die with it, and the e2e
specs that select by them fail only after deploy.** PR #12235 moved Select
Loaded and Export CSV into Roster Export and dropped `.members-select-loaded`
and `.members-export`; `tests/e2e/production-club-members.spec.ts` still
looked for them, found zero controls, and failed post-deploy Client browser
verification (run 46063424139) until PR #12257 pointed it at
`.members-roster-footer .roster-records__actions button`.

So, before you push, for every class you remove or rename:

```bash
grep -rn "old-class-name" tests/ src/ | grep -v node_modules
```

and update every spec, unit test and tutorial target (`SIMPLE_TOUR` in
`ClubMembersPage.tsx` targets `.members-search` and `.members-list`) **in the
same PR**. A selector that now matches nothing is a broken check, not a
passing one.

---

## 5.5 Finding the work, claiming it, and shared components (2026-11-28)

### The inventory is printed from the code; it is never committed

`node scripts/smarterdesign-inventory.mjs` prints the inventory (`--write`
puts the full document in the gitignored `.smarterdesign/inventory.md`, and in
the CI step summary when there is one). It resolves every route in
`src/App.tsx` to its page module and grades it from markers in source (the
page file plus the page-owned components it renders one hop down):

| Grade         | Meaning                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| Converted     | `arena-workspace` on the page root, an `ArenaWorkspaceHeader` mast, and no painted console section left    |
| Partial       | some arena evidence, but the line names what is missing (no mast, a PageBar only, a painted panel left)    |
| Not converted | no arena evidence: painted `SpadeConsole` sections, its own rounded/gradient module dress, or a flat sheet |
| UNKNOWN       | the scan could not read the evidence; read the source yourself. Never treat it as done                     |
| Excluded      | the commented `EXCLUDED` list in the script (other masters, staff desks, the front door)                   |

Two traps it accounts for, so you do not have to:

- **The root skin is not a conversion.** `src/App.tsx` provides
  `<ConsoleSkinProvider value="smarterdesign">` (PR #12299), so every
  `SpadeConsole` already renders as a thin chrome case. A page built from
  console sections looks closer than it is: it still has no root, mast,
  readouts or chrome keys, and stays on the list.
- **The #ClubArenaConsole scanner does not measure pages.** Its "0 to go"
  counts painted pages as done. It stays the measure for popups, modals,
  sheets and dialogs only.

### Record a conversion: two new files, never a shared document

No lane edits a shared #SmarterDesign document. Until 2026-11-28 every batch
rewrote the committed inventory and appended to one history file, so every
merge to main made every other open lane conflict on both and pay a full CI
rerun. Both files are gone; a batch now ADDS files that no other lane can
touch:

1. **The ratchet entry, one per converted page.** Run

   ```bash
   node scripts/smarterdesign-inventory.mjs --ratchet
   ```

   It writes `docs/club-operations/smarterdesign.d/<Component>` (one line, the
   page module path) for every page that now reads as converted, and never
   deletes one. `tests/the-smarterdesign-inventory-matches-the-code.law.test.ts`
   fails when a converted page has no entry, when an entry no longer reads as
   converted (the page lost its root or mast, or gained a painted section), and
   when an entry on main disappears while its page is still routed. So the
   Converted count only grows: fix a regression by restoring the page, never by
   deleting its entry. An entry goes only when its page leaves the routes or is
   moved to the script's `EXCLUDED` list by a written ruling.

2. **The history file, one per batch.** Add
   `docs/club-operations/smarterdesign-history.d/YYYY-MM-DD-<batch>.md`, opening
   with `## Batch <id>: <what>`, with the same table and notes earlier batches
   wrote (see that directory's `README.md`). `node scripts/smarterdesign-history.mjs`
   prints the whole history in order;
   `tests/the-smarterdesign-history-is-one-file-per-batch.law.test.ts` holds the
   names and headings.

### The last conflict on the retired files (open lanes, once)

A branch cut before 2026-11-28 still edits
`docs/club-operations/SMARTERDESIGN-INVENTORY.md` and
`docs/club-operations/SMARTERDESIGN-HISTORY.md`. Main deleted both, so its next
`git merge origin/main` stops on them once (modify/delete). Resolve it exactly
like this, in your own worktree, with the merge still in progress:

```bash
git merge origin/main                                    # stops: both files "deleted in origin/main"
node scripts/smarterdesign-history.mjs --rescue <batch>  # eg p7-friends-and-vip: moves YOUR added
                                                         # history lines into smarterdesign-history.d/
                                                         # <today>-<batch>.md and git-rm's the old file
git rm docs/club-operations/SMARTERDESIGN-INVENTORY.md   # take main's deletion; nothing to keep
node scripts/smarterdesign-inventory.mjs --ratchet       # your converted pages' ratchet entries
git add docs/club-operations/smarterdesign.d docs/club-operations/smarterdesign-history.d
# read the new history file: it holds only the lines your branch added; fix its
# "## " heading if --rescue said so, then resolve any other conflict and commit
npx vitest run tests/the-smarterdesign-inventory-matches-the-code.law.test.ts \
  tests/the-smarterdesign-history-is-one-file-per-batch.law.test.ts tests/law-registry.law.test.ts
git commit --no-edit
```

Never re-create either file, never `git checkout --ours` them (both laws
refuse them), and never regenerate a committed inventory. The local helper
`resolve-sd-docs.sh` that merged the two files is retired with them: do not run
it.

### Claim before you start

Two lanes once converted the same page because the hand-kept list was stale.
Before starting a page, run:

```bash
node scripts/smarterdesign-inventory.mjs --claims            # every page still to convert
node scripts/smarterdesign-inventory.mjs --claims Rakeback   # one page, by name or path
```

It lists the open pull requests touching each page, its stylesheets and its
page-owned components. `CLAIMED` means an open PR that reads as design work
touches it: coordinate with that PR (or `COORDINATION-INBOX.md`, CLAUDE.md
10.8 rule 5) instead of starting a second conversion. `touched` means only
other work touches it: expect a merge, not a duplicate. Your own PR is the
claim; open it as a draft early if the page will take a while. The step is
advisory: it never blocks a commit or push and never runs on a timer. A PR
that adds the page's ratchet entry counts as a claim on it. Exit 3
and `UNKNOWN` mean GitHub could not be read; that is never "unclaimed", so
check the open PRs by hand.

### A shared component is restyled by scope or by opt-in

A component that a non-arena page or a dialog also renders must not change
for them. Restyle it one of two ways, and pin the scoping with a unit test:

1. **A sheet scoped under `.arena-workspace`.** Every rule in the new sheet
   starts with `.arena-workspace`, so the component only changes inside an
   arena page. Worked example: `src/components/accounting/WeeklyAccountingArena.css`
   (the Settlement body), whose scoping is asserted by
   `tests/unit/weeklyAccountingArenaIsScoped.test.ts`; the Settlement
   Dashboard, Union Statements and admin dashboard keep their look.
2. **An opt-in `arena` prop.** The component keeps its painted markup by
   default and renders the arena case only when a host passes `arena`.
   Worked example: `AgentCashoutPanel`'s `arena` prop
   (`src/components/agent/AgentCashoutPanel.tsx`) with its dress in
   `src/components/agent/AgentCashoutArena.css`, scoped and asserted by
   `tests/unit/agentTeamArenaDressIsScoped.test.ts`; only Agent Team passes
   it, so the Cashier trade dialog and the player record keep the console.

The inventory reads a shared component with an opt-in `arena` prop only on
the pages that pass `arena`, so the arena branch is never credited to a host
that does not use it.

## 6. Verification

1. **Before.** Render the section as it is, 393px wide, with the
   #ClubArenaConsole render harness
   (`.claude/skills/club-arena-console/harness/`, read its `README.md` for the
   browser and font provisioning; without Roboto Condensed and Inter the
   render lies). Add a branch to `card-harness.tsx` that mounts the section
   inside `<div className="arena-workspace">` with `ArenaWorkspace.css`
   imported, then:

   ```bash
   bash .claude/skills/club-arena-console/harness/run-shots.sh /tmp/before "?surface=<key>"
   ```

2. **After.** Same command into `/tmp/after`, every state: empty, loading,
   error, the longest real string, the disclosure open, the primary disabled
   and busy. Then build the sheet:

   ```bash
   python3 .claude/skills/club-arena-console/harness/sheet.py /tmp/sheet.jpg 760 \
     "Roster Export:/tmp/before/x.png:/tmp/after/x.png"
   ```

   Look at it honestly: does it read as the same page as the Find A Player
   case and the Cashier? Is any label touching a rim? Is anything flat?

3. **Show Dan the before and after before any push.** Then delete only the
   harness files you copied into the checkout.
4. **Gates**, in the owned worktree:

   ```bash
   for s in check-ui-text check-title-case check-nav-title-case; do node scripts/ci/$s.mjs; done
   npx tsc --noEmit -p tsconfig.app.json
   npx vitest run tests/unit/classNamesResolve.test.ts tests/no-hover-effects.law.test.ts \
     <every test that names your files>
   npx prettier --check <changed files>
   ```

5. **Deliver** under `PUBLISHING.md`: owned branch, PR, required checks,
   protected merge, then confirm the merged SHA at
   `https://ca-static.smarter.poker/build-info.json` and
   `https://smarter.poker/hub/club-arena/build-info.json`. A client section
   never waits for an engine window.

---

## 7. Definition of done

- [ ] The page root carries `arena-workspace`; the section is an `arena-case`
      with an `arena-section-title`.
- [ ] Figures on `arena-meter` tiles; actions in an `arena-switch` with one
      lit primary; records and disclosures on the `--arena-row` rim; fields in
      the search well.
- [ ] No `SpadeConsole`, no painted plates, no new gradient, radius, shadow or
      colour; everything comes from the workspace's classes and variables.
- [ ] The image header (if this page has one) carries the chrome "?" top
      right; any Back To Dashboard button sits above it.
- [ ] Title Case, no em dashes, no `:hover`, 44px targets, no unstyled hooks.
- [ ] Every handler, guard and test-pinned literal survived.
- [ ] Every removed class name searched in `tests/e2e` and updated in the
      same PR.
- [ ] Before/after at 393px, every state, shown to Dan before the push.
- [ ] `--claims` run before starting; `--ratchet` run and its new
      `smarterdesign.d/<Component>` files committed, and one new
      `smarterdesign-history.d/YYYY-MM-DD-<batch>.md` for the batch, in the
      same PR. No shared #SmarterDesign document edited.
- [ ] Gates green; changelog under `docs/changelog/`; merged SHA verified live.

---

## 8. Whole pages: the Club Operations pages and their shared kit (2026-11-27)

Dan ordered the Club Operations bar and every page it opens upgraded ("THAT NEEDS TO BE ENHANCED WITH THE #SMARTERDESIGN, AS WELL AS EVERY SINGLE ONE OF THESE PAGES"), and rejected a pass built from the painted plates: "THAT IS NOT THE #SMARTERDESIGN. WTF?!". A whole routed page wears the same language as a section, plus a mast at the top. These pages are the worked examples, and `tests/club-operations-pages-stay-smarterdesign.law.test.ts` keeps them there.

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

### Whole-page pieces

- **Page root:** class `arena-workspace` (dark #050d17, chrome art variables).
- **Mast:** `<ArenaWorkspaceHeader area title context subtitle summary steps emblem />` from `src/components/lobby/ArenaWorkspaceHeader.tsx`. It draws the illustrated scene, the chrome medallion, Barlow italic title and the chrome "?" top right, so a page never renders a second PageHelp. Areas: members, record, cashier, data, stats, operations, dashboard, reports, integrity, handreview, finance, control, settings. A "Back" button goes above the mast, never inside it. `context` is the club name, never a placeholder such as "Club Arena".
- **Live line and meters under the mast:** `<PageBar titleAs={false} showHelp={false} title status metrics />`; inside a Club Operations page its metrics render as one even row of chrome meters.
- **Sections:** `<section className="arena-case arena-ops-case"><h2 className="arena-section-title">Title<small>note</small></h2>...</section>`, or `ClubPageSection` with `arena`.
- **Readouts:** `ArenaReadings` (chrome `arena-meter` tiles; tones live, attention, danger).
- **Keys, tabs, filters:** `<div className="arena-switch">` with direct-child buttons or links. `aria-pressed="true"`, `aria-selected="true"`, `aria-current="page"` or class `active` lights a key blue. `arena-ops-keys` wraps two per row on a phone; `arena-ops-primary` lights the first key as the primary action. Never one full-width bulky key per line on a phone.
- **Rows:** `ArenaRow` (numeral, title, line, gold or red signal, chevron) inside `ul.arena-ops-rows`, or `className="arena-ledger-row"` on a row of your own.
- **Fields:** `arena-ops-well`.
- **Empty, loading, error:** `ArenaState` with the page's own wording.

### Traps from the page rebuilds

- The CLAUDE.md redesign pointer used to send every agent to the painted plates. That pass was rejected outright. Start from section 1, not from a master PNG.
- Do not rebuild Players or Club Data; they were the reference.
- `PageBar` requires `title` even with `titleAs={false}`; it labels the meters.
- `ArenaRow` puts `signalLabel` in `aria-label`; when a test reads "9 Waiting" as text, keep the text visible.
- A python `str.replace` patch fails silently after Prettier rewraps a line: assert every replacement.
- The lint job has a hard warning ceiling: an unused import or binding fails it.

## 9. Full-page before/after render harness (`harness/`)

It serves the real app (router, layout, guards, the rail) with six modules swapped for offline stand-ins: `src/lib/supabase.ts` (it honours `.in()`), `ClubWorkspaceContext`, `useClubNavigationAccess`, `useAuthUser`, `useCashoutScope` (one stable always-current guard, so money screens render instead of reading Unavailable) and `CashoutService` (a fixed Agent Desk cashout queue). Every route then renders as Kings Club's owner with fixture data (`harness/fixtures.ts`: rake `403.3814552027556`, 174 members, alerts). Nothing here is imported by the app or shipped.

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
- A route without a leading `/` is under `/clubs/kings-club/`; one with a leading `/` is any app path (`/wallet`, `/legal/tos`, `/notifications`).
- `shot.mjs` waits until the page has settled (no PageSkeleton, LoadingSpinner or `aria-busy`, fonts loaded, the DOM quiet for 1.5 s), so the first shot after a server start is no longer a grey skeleton.
- Any stand-in you add locally must return STABLE values: a fresh `() => true` or object per render is a new effect dependency every render and the page loops forever.
- Fixture keys must match what the page reads (the activity series uses `d` for the day).
- A page showing "Could Not Render" with `Invalid hook call` in `harness/probe.mjs` output means two copies of React were pre-bundled. The harness gives each checkout its own dependency cache for this reason; if it happens anyway, restart with `run.sh` (it passes `--force`).
