# omahaOopReraiseRangeHoldsVsReraise: Authority For The Live Switch

Built 2026-11-24 by PLO-LEAD-6 from the trace of hand a6f9206d-3a5e-4a7f-8c7c-65c67fcb2778 (OOP-3BET-FOLD-TRACE.md). Evidence NOT MET: the audited-decision scorer and the league card were not run; the generated-state replay below is the only grade. This file does not authorize switching the option on.

## What It Does

PLO4/PLO5 cash tables (never Lightning, PLO6, tournaments, hi-lo, bomb pots or more than one board), the Horse out of position facing one open with no caller (`server/src/engine/HorseOopReraiseRangeHolds.ts`, wired by `HorseOopReraiseRangeHoldsWiring.ts`). A 3-bet the brain chose stands only when

- EV(3-bet) = phi x P0 + kappa x [R x eq(h | his calling band) x Pot3 x (1 - rake) - I3] + rho x V4 is at least the priced call the existing calling rule admits (`omahaDowngradedThreeBetCalls`, coordinated hands and aces or equity past the price plus the margin) or 0; and
- the Horse's own answer to the pot 4-bet, asked on the public 4-bet frame (a side ask with the option off, no learning, intent writes discarded, the three random streams put back), is not a fold, unless the hand holds an ace and the seeded keep unit (a hash of the Horse's id, the pot and its own cards, recorded on the receipt) is under the keep frequency that holds the out-of-position 3-bet range's fold-to-4-bet share at or under `horse.reraiseFoldShareCap` (default 0.45, never above the 4-bettor's pure-bluff break-even for the size).

phi / kappa / rho are how the opener answers a 3-bet: his own decayed fold to a 3-bet (public counters foldTo3Bet / foldTo3BetOpp) shrunk to the fitted population answer (`OPENER_ANSWERS_PRIOR` 2026-11-24.v1, by game and depth, fitted by `server/scripts/oop-reraise-range/fit-opener-answers-three-bet.ts` on a read-only hand_history pull of 58,681 hands; the continuing share split call : 4-bet as the population splits it). The opener's band is `HorseMind.bandFor` of his line, the 4-bet band its top rho share and the calling band the next kappa share. Equity is the engine's seeded sampler; realization is the engine's measured out-of-position realization by depth after the call and by the call's own equity (`omahaPreflopDefenceRealization`). V4 is the value of the Horse's own answer: fold -I3, call R x eq(4-bet band) x Pot4 x (1 - rake) - I3 - C4, raise the stacks in against the 4-bet band.

A rejected 3-bet becomes the call where the calling rule admits it and EV(call) >= 0, otherwise the fold. The rule never adds a call the calling rule refuses and never adds a 3-bet. Where both are on it supersedes nothing: `omahaReraiseRangeOutOfPosition` still judges a 3-bet this rule keeps.

Receipts: `omaha_oop_reraise_range_holds_kept`, `_blocker_kept`, `_called`, `_folded`, `_unpriced`; every number on the decision (`oopReraiseRangeHolds`). The response validator admits the raise -> call only under the decision's own option (`oopReraiseRangeHoldsGate`), in the spot re-derived from the request, for the exact chips of the call; the raise -> fold is the existing PLO fold admission.

Default OFF in source (read `=== true`), registered in the option switch, switchable live; scopable per game (`horse.omahaGameScope.omahaOopReraiseRangeHoldsVsReraise`).

## What Was Measured

@@OMAHA_TABLE@@

## Replay

- Replay: NOT RUN (the audited-decision scorer was not run; the generated-state replay above, server/scripts/oop-reraise-range/replay.ts, is the only grade)
