# The fixed Lightning early-fold option is graded on the NLH half: not harmful, limps gone, still no gain (2026-11-21)

Antigravity Coordinator subagent (session_01Gw7aDtgw51ks82iZdeEMVr), lane coord-efnft2.

- `lightningEarlyFoldNeedsFoldThrough` was dealt again on the declared 90 NLH cells of the Lightning paired matrix, this time on code containing the fix of #11623 (no early-fold release for an unraised limp, one jitter roll), on a fresh switch seed (41987143, 2,200 hands per cell, 198,000 paired hands), one process, under a declaration written before any hand (sha256 `2e64b99c...79f9b0`).
- Repository merge result: primary fields -1.2 bb/100 (se 0.8, z -1.46); every G5 and G6 group above -2 standard errors (lowest three_bet_heavy, z -1.72); G1, G2, G3, G4 and G7 hold. Not shown harmful under the declared rule, so no off-only lock.
- The fix worked on entry quality: Q3 bottom-quartile share 9.90% to 9.95% (+0.04 points, was +1.08) and first-in limps +0.010 of a +0.437 point VPIP gain (was most of +0.970).
- Still not a gain: primary and counter-exploit point estimates are negative, all_horse alone reads z -2.37 (not a declared lock group; recorded), and Q4 intended share is 63.7%, under two thirds (cold calls +0.143). The option stays OFF with Evidence NOT MET. PLO4 and PLO5 were not run.
- Docs only: `docs/horse-option-authority.d/lightningEarlyFoldNeedsFoldThrough.md`. No switch row, no migration, no engine change.
