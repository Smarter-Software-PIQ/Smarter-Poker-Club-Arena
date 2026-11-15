# The pre-repair discount reaches the decision

Cash table-speed opponent profiles learned before the showdown-memory repair hold folds without the calls, so they
make a player look like an over-folder. The remedy for that was the pre-repair discount: the fold-to-bet figure (and
the three other showdown-dependent figures) of such a profile stays out of a Horse's read until 60 opportunities
played after the repair are in, and counts at a reduced weight after that. Its switch (`styleFoldRatePreRepair`) is on
in production.

It never engaged there. Whether a profile is pre-repair was recorded only by one import function
(`HorseMind.importDurableOpponentProfiles`), and no production code calls that function. A live decision reads its
opponents from the pooled public profiles that arrive with accepted hands, and those rows carried their counters and
nothing else. So on the path production uses every profile read as not affected, the discount was skipped, and its
receipt (`style_pre_repair_fold_rate_discounted_seen`) stayed at zero while Horses went on bluffing more against
players whose only over-folding evidence was pre-repair. Every test passed because every test installed its profile
through the import production does not use.

## What changed

- When a decision's read is assembled from the pooled rows, each cash table-speed row (and each cash row with no speed
  on file, which cannot be told apart) now carries its pre-repair keying and the post-release counts the boot
  supplied for that row. This travels with that one decision's own state, in the same place its counters go, for the
  exact rows and the borrowed sibling-size rows alike. Nothing is kept in a process-wide map, so two decisions never
  see each other's rows.
- The read frame the worker journals gains version `horse-decision-reads-v14` (v13 plus that list), written only when
  a decision carries such a row. The second look and an exact replay therefore apply the same discount the first look
  did, from the journaled record alone. A decision with no such row keeps the frame it had, byte for byte.
- The discount is consulted only behind the same switch. With `styleFoldRatePreRepair` off, every decision is what it
  was. In shadow the switch records what it would have withheld and applies nothing.

## What it changes in live play

Only cash table-speed opponents are affected, and the direction is more conservative. Against a player whose stored
fold-to-bet says over-folder but who has fewer than 60 post-repair opportunities on record: the bluff increase and
the thinner value bet taken from that figure are withheld, the lifetime fold-rate branch stands down, and the style
read keeps fold-to-bet, river call, fold to 3-bet and bet-when-checked-to out of its classification. A calling
station's decrease is never withheld. Tournament and Lightning profiles, and rows a Horse learned itself, are
untouched. From 60 opportunities on, the figures count again at weight 1 - 0.5^(m/30).

## Not changed

The completeness of a profile, and the confidence cap it selects, are exactly what they were on the production path
(complete, cap 1). Whether pooled profiles should be qualified for completeness there is a separate decision and is
reported separately.

## Proof

`thePreRepairDiscountReachesTheDecision.law.test.ts` drives the observer reads the worker owns, and
`thePreRepairDiscountThroughTheWorker.test.ts` drives the worker itself (accepted hand, fast look, second look, exact
replay). Neither calls the import. Before this change 8 of their 11 tests failed on main; after it all 11 pass.
