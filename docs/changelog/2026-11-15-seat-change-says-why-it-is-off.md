# 2026-11-15: Seat Change says why it is off, and the live proof covers every table

Fourth table-menu delivery, after #10924, #10933 and #10947.

## The live-table proof was failing on every publish

`tests/e2e/support/mobileLiveTableLayout.ts` runs after each publish at
whatever occupied cash tables production is running. It demanded a Seat Change
switch. A Lightning game withholds seat change on purpose (#10818, 2026-11-14),
and the tables it picked were Kings Club Lightning games, so four of five phone
widths failed at that line on every run. The one seated-owner case that landed
on a Classic table passed all the way through, and was the first real-table
proof of the menu work: Seat Change, Sounds on and back, and Game Rules opened
and closed from the menu.

## Changes

- **Seat Change names the reason.** TablePage reports
  `seatChangeOffInLightning`: off because the game is Lightning, as opposed to
  off while its mode is loading. The menu shows a disabled "Seat Change, Off In
  Lightning" row for the first and hides the row for the second.
- **The live proof accepts either answer and proves both.** A switch at a
  Classic table is toggled as before; at a Lightning table the disabled row
  must be present. Sounds and Game Rules are then proved at every table.
- **Spectators are proved on every publish.** The occupied-table layout case
  runs as a spectator and now asserts that no seat-only row is offered and
  that Leave Table is.
- **Cross-device sound is proved end to end.** A unit test drives a
  `user_table_settings` row change through the real bus, the settings store,
  the gate and the switches. Removing the gate's change event fails it.

## Examined, not changed

The seat-move announcement check in the same post-deploy job fails before it
reaches any menu. It needs the reserved club's cash catalogue to hold a "main"
table and a second, differently named table, and production does not right
now. Its code last changed on 2026-11-10. It belongs to that lane.

Client only. No engine, schema or financial path is touched.
