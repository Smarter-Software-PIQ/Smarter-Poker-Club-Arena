# A bumped player is first to move only until they return

2026-11-09. Found during production verification of the full-ring feeder rule
(migration `20261108193515`, Dan 2026-11-08).

## What production showed

NLH 0.50/1 Classic started a feeder at 00:00:02 UTC: the two latest Main
arrivals were moved over (316.91 and 212.90, exact). Both returned to Main the
moment a Main player left, while the feeder had fewer than seven: one at
00:00:56 (Main leave at 00:00:54), the other at 00:08:20 (Main leave at
00:08:09). That is the rule working.

Then one of them, already back on Main, cashed out of Main at 00:39:47 (306.46,
credited), bought into the feeder at 00:40:22 and was moved straight back to
Main at 00:40:23, ahead of a feeder player waiting since 00:01:09, with the
feeder at 6. The tick kept both ids in `first_to_move` for the whole feeder
start, so the returned player's later rejoin carried the priority and the
seven-player gate exemption again.

## The fix (migration `20261109010155`)

One step of `fn_cash_cluster_tick`: a bumped player stays first to move only
while seated on a feeder of the game or still holding a pending move (the
bump, or the move back). Once back on a Main, or gone from the game, the id
leaves `first_to_move` for good; a later rejoin queues like anyone else.

Reproduced and verified on the local Postgres copy (production text of the
affected tick steps): before the fix the returned-then-rejoined player was
moved past the gate; after it, the vacated chair went to the bumped player
still waiting, and the rejoiner waited for the gate. The earlier acceptance
suites still pass. Pinned in
`tests/a-full-ring-feeder-starts-with-the-last-two.law.test.ts`.
