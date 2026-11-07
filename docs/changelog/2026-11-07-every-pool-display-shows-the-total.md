# Every pool display shows the total (2026-11-07)

Five screens labelled the places-only pool as the prize pool on bounty events
(the break screen, the Detail tiles, the finished Ranking stat, the XMTT detail
and the final-table overlay). On the 46-entry 2.5K GTD bounty freezeout the
lobby card read 1,656 while these read 1,196. Each now prints
`displayTotalPool` (places + bounties, net of rake, the actual live total).
The November 4 "guarantee is the floor" pin in
`tests/a-guarantee-moves-no-chips-before-close.law.test.ts` is restated for the
current rule.
