# The table in #SmarterDesign: every console, purchase popup, the drawer and Leave (2026-11-27)

Dan, verbatim: "https://smarter.poker/hub/club-arena/table/e78717a2-... NEEDS THE SAME #SMARTERDESIGN
UPGRADE TO EVERY SINGLE PAGE, SUBPAGE, BUTTON AND EVERYTHING ELSE, EXACTLY LIKE WE'VE DONE FOR
EVERY OTHER WORLD HUB PAGE". Earlier the same day, on painted frames: "NO DO NOT USE THOSE BULKY
FRAMES, THATS THE OLD STYLE... USE THE #SMARTERDESIGN STYLE".

## How it reaches every table popup at once

Every console on the table is a `SpadeConsole` (settings, table settings, theme, game rules, hand
history and hand detail, leaderboard, club profile, identity, sit out, wait list, hit-and-run
leave, heads-up waiting, invites, time bank store, real-time results, tournament break and winner,
connection banner, load failure, Lightning notices and more). `SpadeConsole` now reads a
`ConsoleSkinContext` (defined in `src/components/console/SpadeConsole.tsx`). `MultiTableSurface` (the lazily loaded wrapper `PersistentTableLayer` opens) provides
`smarterdesign` once, around the whole table layer, so every one of those changes together with no
caller touched. Off the table nothing changes: the default skin is still the painted master.

In the `smarterdesign` skin the console prints the arena workspace dress (the Cashier, Player
Management and Club Operations language): one thin chrome case on ink navy, the eyebrow, title and
subtitle as live lettering in normal flow, the pill as a chrome readout, the X as a 44px chrome
key in the upper-right corner, and the plates as chrome keys with the primary lit blue. Class
names, roles, test ids, handlers and labels are unchanged.

## The surfaces that were not consoles

- **Purchase popups** (Add-On, Rebuy, the cash Rebuy amount picker, the table Cashier): the shared
  `.addon-console` canvas no longer draws the painted chassis. The title and subtitle sit in flow,
  the timer or amount in a chrome readout, each line on a chrome ledger row, quick amounts as
  chrome keys (lit when pressed), the plates as chrome keys with the primary lit blue, and a
  visible 44px chrome X. The balance figure is white instead of gold.
- **Table drawer** (hamburger): an ink-navy panel inside one chrome case, every action a chrome
  ledger row with an ice-blue icon, section titles as live type, the X a 44px chrome key. The
  slide-in animations still play.
- **Buy-In** (the first popup on any cash table): the painted spade head and deck are replaced by
  a flow head (eyebrow, title, countdown key), the amount in a chrome readout beside the slider,
  Min / BB / Max / Balance as four chrome tiles (Min and Max light blue when pressed), and Close
  or Top Up beside the confirm, lit blue. The measured zones keep their handlers and test hooks;
  their inline placement is neutralised in CSS.
- **Leave Table confirm**: one chrome case, a chrome medallion for the exit mark, Stay as a chrome
  key and Leave Table lit red.

## Not changed

No behaviour, data, money path, timer or animation changed. The painted families and their
zone laws are untouched for every surface off the table.

## The rest of the table (second batch, same day)

- **Insurance and EV Cashout**: chrome case, flow head with the countdown in a chrome tile, tabs
  and presets as chrome keys, player rows, readouts and outcomes on chrome rows, No / Play It Out
  and Insure / Cash Out as chrome keys with the primary lit. Gold ink is ice blue or white.
- **Must Move Lobby**: chrome case, live title, chrome keys (the 34px small button is 44px now),
  one chrome row per table section with your own table outlined blue, four chrome tiles.
- **Tournament Lobby host**: ink-navy background; it stays frameless (owner ruling of Oct 4).
- **Tournament announcements, Maintenance Break, Spectators, Emoji picker, Share As Video, Bomb
  Pot lettering, Lightning lines**: chrome cases, rows, keys and 44px chrome X keys; gold accents
  re-coloured ice blue. The Bomb Pot bomb, fuse and explosion art and every animation are
  untouched (no block sets `animation`).
- The skin's success green is the house green `#4dc660` (`gameplay-wears-the-house-colours`).

New pins: `tests/components/table-overlays-wear-smarterdesign-a.test.tsx` and `-b.test.tsx`.
481 test files touching these surfaces ran: 475 pass; the 6 that fail need Postgres or host
shell state that the sandbox lacks and read none of these files.

## One trap, fixed before it shipped

`SpadeConsole.css` and `metallic-popups.css` reset every plate, close and `__head` inside a
`role="dialog"` with `!important` (they were written for painted art, where the button paints
nothing). The first render outside a dialog looked right; inside a real table dialog the chrome
keys lost their frame and the head became a rounded bar. The skin's keys and head now carry
`!important` at higher specificity, and the renders were repeated inside `role="dialog"` with
`metallic-popups.css` loaded.

## Verified

`tsc --noEmit` clean. 138 test files / 2,088 tests that reference the console, the purchase
popups, the drawer, the table layer or Leave pass, including the new
`tests/components/table-consoles-wear-smarterdesign.test.tsx`. Headless renders at 393px of a
console with eyebrow, title, subtitle, pill, X and two plates, the Add-On popup and Leave Table.
