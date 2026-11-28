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
`ConsoleSkinContext` (`src/components/console/consoleSkin.ts`). `PersistentTableLayer` provides
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
- **Leave Table confirm**: one chrome case, a chrome medallion for the exit mark, Stay as a chrome
  key and Leave Table lit red.

## Not changed

No behaviour, data, money path, timer or animation changed. The painted families and their
zone laws are untouched for every surface off the table.

## Still painted on the table

The Buy-In deck and the Insurance deck draw their own painted layouts with measured zones
(`BuyInModal`, `InsuranceModal`); they are the next pass.

## Verified

`tsc --noEmit` clean. 138 test files / 2,088 tests that reference the console, the purchase
popups, the drawer, the table layer or Leave pass, including the new
`tests/components/table-consoles-wear-smarterdesign.test.tsx`. Headless renders at 393px of a
console with eyebrow, title, subtitle, pill, X and two plates, the Add-On popup and Leave Table.
