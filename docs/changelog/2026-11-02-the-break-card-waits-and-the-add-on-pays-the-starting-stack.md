# The Break Card Waits For This Table, The Add-On Pays The Starting Stack, And The Lobby Button Joins The Action Bar

Dan, 2026-11-01, from a live Sunday Funday Big Stack session (verbatim, four
reports in one sitting):

1. "THE TOURNAMENT BREAK CARD SHOULD NOT POP UP UNTIL THE HAND AT THE CURRENT
   TABLE IS FINISHED, IT LITERALLY POPPED UP ON MY TABLE WHILE THERE WAS STILL
   A HAND IN PROGRESS." And, refining: "FIRST CARD SHOULD ONLY APPEAR WHEN THE
   TABLE HAS FINISHED ITS HAND AND IS WAITING FOR THE OTHER TABLE TO FINISH
   ... A SMALLER POP UP SHOULD APPEAR, 'ADD ON PERIOD WILL START WHEN ALL
   TABLES FINISH THERE CURRENT HAND'."
2. "'LAST HAND' IS SUPPOSED TO BE FOR ADD ON'S FOR TOURNAMENTS THAT HAVE ADD
   ON'S BUT ONLY AFTER THE LAST LEVEL FOR RE ENTRY IS OVER."
3. "WHERE IS THE ACTUAL 'ADD ON BUTTON' ON THE CARD?! THERE IS NO WAY TO
   ACTUALLY ADD ON... AN ADD ON CAN NEVER EXCEED THE AMOUNT OF CHIPS THAT THE
   TOURANMENT STARTED WITH, THE ADD ON SHOULD THE SAME AMOUNT OF CHIPS THAT
   YOU START WITH IN THE TOURNAMENT, NEVER LESS!"
4. "THE LOBBY BUTTON IS 100% ALWAYS SUPPOSED TO BE IN THE RIGHT CORNER IN THE
   ACTION BAR AT THE TOP, NOT RANDOMLY INSIDE THE POKER TABLE PAGE. AND THE
   TOURNAMENT LOBBY AND PREVIOUS HAND, TIME BANK, AND RABBIT HUNT BUTTONS ALL
   SHOULD BE THE SAME SIZE AS THE HAMBURGER MENU BUTTON IN THE UPPER LEFT HAND
   CORNER."

## 1. The break card waits for this table's own hand

TournamentBreakScreen takes `heroHandLive` (TableModalsLayer hands it
`isHandInProgress`). During the last-hand window with a hand still in play at
THIS table, the full card does not render; a small status chip says "Add-On
Period / Tournament Break - Will Start When All Tables Finish Their Current
Hand". The full card appears the moment this table's hand completes, while it
waits on the rest of the field. A running countdown always shows the full
card: the engine has parked every table by then.

## 2. "Last Hand" belongs to the add-on window alone

A plain break's waiting card now reads "Waiting / Waiting For Every Table To
Finish" (mini pill: "Break: Waiting"). The add-on break keeps "Last Hand /
Last Hand Before The Add-On Period", and the add-on notice already gates on
`tournamentAddOnEntryBoundaryPassed`, so it only exists after the last
re-entry level closes - exactly where Dan says "Last Hand" belongs.

## 3. The card carries an Add On button, and the add-on pays the starting stack

- The add-on break card renders an Add On button that opens the same
  confirmed, price-bound AddOnModal the persisted window and the table menu
  use (`handleTournamentAddOn`). Disabled during the last-hand window - the
  purchase window does not exist until every table parks - and enabled for the
  60 seconds it runs, so a player who dismissed the auto-opened modal can
  still add on from the card.
- THE AMOUNT: an add-on pays `starting_chips`, exactly. The money core
  (fn_ca_process_tournament_chip_purchase_money_v1) already pays
  COALESCE(NULLIF(addon_chips,0), starting_chips), so migration
  `20261102005209_an_add_on_pays_the_starting_stack.sql` pins the column at
  the root: a BEFORE trigger on tournaments forces `addon_chips =
  starting_chips` for every add-on tournament on every write, and a one-time
  backfill corrects every event that has not ended. Every writer is aligned in
  the same commit: midwayStructurePolicy (the `max(configured, 2x stack)`
  floor that produced the 80,000-chip add-on Dan screenshotted, now `stack`),
  ScheduledTournamentService, tournamentFromTableConfig, CreateTournamentModal
  (the Add-On Chips input is gone - there is nothing to configure),
  TableConfigPage (the 0-3x multiplier slider is an on/off toggle), both
  freeBuy config builders, and FREE_BUY_TIERS (3,000, superseding the
  deliberate 10,000 - Dan's 2026-11-01 ruling is categorical). Every display
  reads starting_chips first: useTournamentAddOnBreak, the TablePage persisted
  offer, TournamentService quote/processAddOn, the engine's
  ADDON_PERIOD_START broadcasts, TournamentBrainContext.
- The Free Buy consequence is deliberate and stated: the Free Buy add-on drops
  from 10,000 to the 3,000 starting stack. MidwayStructurePolicy.law.test.ts's
  2x-stack floor and FreeBuy.test.ts's tier/ladder pins are updated in the
  same commit (the ladder's add-on depth at the hour is 15 BB).

## 4. The lobby button lives in the action bar, and the tiles match the hamburger

- The tournament LOBBY plate left the felt's upper-right corner. It renders in
  MultiTablePage's tab-bar strip - the exact `.mtp-lobby-btn` slot the cash
  must-move LOBBY already uses, hamburger-sized (`--mtp-lobby-w:
  var(--sp-tabbar-control)`) - and opens that table's TournamentLobbyModal
  through the new OPEN_TOURNAMENT_LOBBY bus event (a tap is a tap: never
  deduplicated, never cross-tab). `tests/the-tournament-box-is-under-the-
  action-bar.law.test.ts` now pins the bar location and refuses a felt corner
  button.
- `--sp-hud-tile-size` on `.table-hud` reads `--sp-tabbar-control` (52px at
  every width), so the previous-hand card, time bank and Rabbit Hunt tiles are
  the hamburger's size, and the chat bubble moves with them (Dan 2026-08-28:
  the corner widgets are one size). The cash seat-change dock keeps its 40px
  footprint - Dan named four buttons and the hamburger.

## Tests

- `tests/each-tournament-starts-its-own-break.law.test.ts`: new pins for the
  hero-hand gate, the waiting chip and the card's Add On button.
- `tests/unit/tournamentBreakScreen.test.tsx`: the chip-only state while the
  hero's hand is live, the full card on completion, the Add On button's
  disabled/enabled/click behavior, "Waiting" in place of "Last Hand".
- `tests/all-in-cannot-leave-and-the-hud-slot.test.ts`,
  `tests/unit/liveTablePolish.test.tsx`: retargeted to the new tokens and the
  removed corner button.
- Free Buy and Midway suites updated as above.
