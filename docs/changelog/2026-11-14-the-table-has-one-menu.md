# 2026-11-14: the table has one menu

Follow-up audit to `2026-11-14-a-menu-switch-answers-the-press.md`, asked for
by Dan the same evening: "CHECK FOR ANY AND ALL BUGS, GAPS, STUBS, ERRORS,
REGRESSIONS OR WIRING ISSUES". Every row of the table menu was traced from the
press to its effect.

## The finding everything else hangs from

`TablePage` rendered its own `TableMenu` behind `embeddedTableId ? null :`.
Every table is drawn by `MultiTablePage` with `embeddedTableId` (the
`table/:tableId` route renders nothing; `PersistentTableLayer` draws tables),
so that menu and the "Open The Lobby In A New Tab" button beside it were never
on screen. 272 lines of JSX nobody could reach, which kept collecting work:

- **Straddle.** The 2026-09-15 changelog records restoring the straddle switch
  by adding it to this menu. It stayed unreachable: no control anywhere else
  called `handleToggleStraddle`.
- **Club Marketplace** and the tournament **Add-On** row lived only there.
- A tournament seat's funding row said **Rebuy** there and "Top Up" in the menu
  players actually have.
- **Leave Table Next Hand** showed ON while queued there and nothing in the
  live menu.
- Five tests pinned its rows as if they could be pressed.

## Fixed

- The dead menu is deleted. `tests/the-table-has-one-menu.law.test.ts` refuses
  a second `TableMenu` in `TablePage`, refuses a bare `<TablePage>` mount, and
  checks that every action the tab bar emits has a handler and every handler it
  passes is placed on a row (`onAddOn` was passed and used by nothing).
- The live menu gains Straddle (offered only where the page reports the seat
  may straddle; a switch, ON/OFF), Club Marketplace, tournament Add-On, the
  Rebuy wording at a tournament seat, and the queued badge on Leave Table Next
  Hand. TablePage reports `straddleAvailable`, `straddleEnabled` and
  `leaveNextHandQueued` for its tab and answers `TOGGLE_STRADDLE` and
  `CLUB_MARKETPLACE`.
- `useTableSound` kept one copy of the Sounds and Vibrations switches per
  mounted table and seeded it once. A change made through another table, the
  settings panel, the header menu or another device left it stale, and the next
  press computed `!stale`. It now re-reads its gate whenever the shared store's
  value moves.

## Checked and left alone

Sit Out, Top Up, Auto Top Up, Hand History, Leaderboard, Session Stats, Table
Settings, Game Rules, Leave Table, Table Alias, Change Avatar, Social Name,
Auto Time Bank, Seat Change, Tile View and Multi Table Profit Tracking each
reach a handler that acts or says why it cannot. Session Stats renders for a
signed-in player only; a guest cannot hold a seat.

Client only. No engine, schema or financial path is touched.
