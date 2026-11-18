# tests/the-classic-plo-floor-is-forty-and-madness-keeps-fifty.law.test.ts

The Classic plo5/plo6 VPIP floor is 40 and the number 50 belongs to the
Madness ruleset alone, so migration 20261118004324 must keep moving BOTH
sources of the Classic floor and must keep its hands off Madness.

The floor a Classic table keeps was never one number in one place.
`fn_cash_game_floor_from_template` resolves the template default from
`fn_cash_template_defaults` first and then RAISES it with `GREATEST` against
the `ca_classic_vpip_floors` config row, so the live value is the larger of
the two. Both read 50 before 2026-11-17, which means an edit to either one on
its own is a no-op that still reads as applied. Dan's ruling that day was
"lower the vpip down to 40%", and then, so it could not be taken as a blanket,
that 50% is for the Madness games only.

What makes the second half load bearing is that Madness is identified
elsewhere BY THE NUMBER: `server/src/services/HorseMadnessSelection.ts` treats
a plo5 table with bombs, the big-blind ante, the nit game and
`maintain_percent_min === 50` as Madness, and only there orders its horse
candidates by measured PLO performance; and
`20261024200548_plo5_one_two_madness_without_lightning.sql` carries an
`@live-proof` asserting that cluster still reads exactly 50. While Classic
plo5 also sat at 50 that check was true for tables that were never Madness;
lowering Classic to 40 is what made it exact.

So the law reads the migration and pins that it still carries the md5 pin on
the function body it patches, still replaces `THEN 50` with `THEN 40` for
plo5/plo6 only, still updates the config row, still excludes
`madness_without_lightning` from every write, still leaves a retired club's
read-only gameplay records alone, and still carries all four fail-closed
assertions. It also pins the selector's comparison as an exact `=== 50` rather
than a `>=`, because widening it would start ordering horses by measured PLO
performance at tables that are not Madness, and nothing else would fail.
