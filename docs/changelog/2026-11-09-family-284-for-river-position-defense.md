# Held-Out Family 284 Belongs To riverPositionDefense (2026-11-09)

Family 283 was spent by provider run 42703327017: every effect gate passed
(primary +187.6 bb/100, 99 percent interval [+159.9, +215.3], all seeds
positive, coverage triple the minimums) but the interval-trust guard refused
(Edgeworth coverage error 0.00115 against the 0.001 maximum). A spent family is
never reset, replaced or re-run.

The owner approved one second held-out family for riverPositionDefense only
(2026-11-09 15:54 CT): family 284, using the previously declared reserved seed
set 28401109 / 28402231 / 28403347, which no run has ever dealt. This change
maps river_position_defense to family 284 and its reserved seeds, and moves
the two pressure-package targets' unregistered default to a fresh declaration
(285, seeds 28501109 / 28502231 / 28503347) that still authorizes nothing.
The development harness refuses the new declaration alongside every other
reserved set, and the seed-collision assertion covers it.

Until the family 284 registration replaces the plan entry, the spent 283 plan
no longer validates (its seeds no longer match the target's family); the
registration PR that follows restores the locked state with the redrafted
plan: 42 cells of 1,152 pairs (48,384 in total, sized for the trust guard),
acceptance criteria unchanged. The new design file is
docs/horse-measure/2026-11-09/river-position-defense-heldout-v2.design.json.
