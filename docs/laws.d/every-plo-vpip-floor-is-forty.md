# tests/every-plo-vpip-floor-is-forty.law.test.ts

Every PLO VPIP floor is 40, Madness included, and a Madness table is identified
by its ruleset rather than by the number 50.

Dan ruled on 2026-11-17: "lower the vpip down to 40%", and then, when the first
pass left the Madness cluster behind, "PLO5 MADNESS NEEDS TO GO TO 40". Two
migrations carry it. `20261118004324` took Classic plo5/plo6 from 50 to 40,
which required moving BOTH sources of that floor, because
`fn_cash_game_floor_from_template` resolves the template default from
`fn_cash_template_defaults` and then RAISES it with `GREATEST` against the
`ca_classic_vpip_floors` row: changing either one alone is a no-op that still
reads as applied. `20261118025205` then brought the `madness_without_lightning`
cluster to 40 by removing the explicit 50 that branch pinned.

The floor is the easy half. The number 50 was also an IDENTITY.
`server/src/services/HorseMadnessSelection.ts` decided a table was Madness by
`Number(table.maintain_percent_min) === 50`, and only there ordered horse
candidates by measured PLO performance. Moving Madness to 40 without touching
that check would have switched the ordering off silently - the condition would
simply stop matching, with no failing test and nothing in the logs. Deleting
the floor clause instead would have been worse: Lightning and Action plo5
tables run the same bomb pot, the same big-blind ante, the same nit game and
now the same 40, so they would have begun being treated as Madness.

The identity therefore moved to the thing the trigger itself keys on,
`ruleset_snapshot->>'rules_profile' = 'madness_without_lightning'`, kept inside
the plo5 scope the ordering was measured on, and fed to the selector by
`HorseFleetManager` through the cluster join. A floor can move again without
touching any of it.

The law reads both migration files and the selector. It pins the pre- and
post-image hashes both migrations declare, that the Classic arm reads 40 with
no 50 arm left, that the config row moved too, that the Madness migration
removes the explicit 50 while keeping the template minimum flowing through,
that both refuse themselves if an open cluster is left on 50 or a live Madness
table misses 40, that a retired club's read-only records are excluded, and that
both are wrapped and re-runnable because the merger dispatches them to the
applier. On the selector it pins the ruleset test, the plo5 scope, the fleet
manager feeding the profile through, and - the point of the whole file - that
no executable line decides Madness from `maintain_percent_min` ever again.
