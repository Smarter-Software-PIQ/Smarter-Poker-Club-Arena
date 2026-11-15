# 2026-11-15: the heads-up small blind steals against a proven tight big blind (D6, default OFF)

Option `huSmallBlindStealsVsTightBigBlind` (HorseDecideOpts), default OFF, read only as `=== true`. Not proposed for activation.

## The defect

Hand Analysis graded D6 on 2026-11-15 (heads-up serving policy): heads-up no-limit hold'em had no first-in consumer for a credibly tight big blind. Reproduced on main 47c055ce through the real HorseLogic.decide (style options on, a nit read after 100 hands, VPIP 0.100): the small blind's first-in decisions against that big blind changed in 0 of 507 against an unknown opponent (raise 78.6%, limp 5.4%, fold 16.0% at 100bb; 67.7 / 13.3 / 19.0% at 40bb). The first-in block only asks whether a maniac is behind.

## The change

- `HorseHuTightBigBlindSteal.ts` (new, pure): `huTightFolderRead` judges a proven tight folder on the existing decayed holdem:hu counters with the existing posterior (`credibleAtOrBelow`, the Omaha tight read's) against the existing envelope: at least 15 decayed hands, VPIP credibly at or below 0.6 of the heads-up population mean, no preflop statistic engaged high, no maniac width, the fast window not raising again. `huTightBigBlindSteal` takes the worst case: heads-up he is the big blind in half the hands, so he continues at most 2 x VPIP of his big blinds and folds at least 1 - 2 x VPIP. When that clears the largest heads-up open's break-even on folds alone (cash 3.5bb, tournament 2.5bb), every hand is a profitable open.
- `HorseMind.huTightFolderReadOf` (new accessor): assembles the counters exactly as `omahaTightReadOf` does (durable row, probe adjustment) for a holdem:hu decision. No existing read, threshold, decay or confidence changes.
- `HorseLogic`: the scope gate (exactly two dealt, small blind first in, no limper, no prior action, 20-150bb, NLH only; cash, or a tournament with a trusted context of exactly two players left that is not a satellite) and the ctx field; receipt `hu_tight_big_blind_steal`.
- `HorsePreflop`: with the field set, the small blind's open bar drops to 0 beside the Omaha steal. Size, jams, limps and every spot facing action are unchanged; a hand that already opened keeps its size.
- League: personas `hu_nit_big_blind_v1` and `hu_fold_sb_defend_bb_v1` (added; no existing persona changed) and card `human_hu_sb_steals_vs_nit_40bb`.

## Evidence

Declaration `hu-audit-01UxDLnM/round2/d68/DECLARATION-HU-D6.md`, written before any candidate result: its recorded sha256 7ef09344 is the hash of its first 51 lines (5,825 bytes); an amendment dated 16:38Z (the yield stop and the order of reading) was appended after the development results existed, so the file as a whole hashes differently.
Results (`round2/d68/RESULTS-HU-D6.md`), arm A (on) minus arm B (live) on duplicate deals, bb/100, 25,000 pairs per cell per phase, z with the declared 1.1 SE inflation:

| cell                                                                                       | development               | confirmation              |
| ------------------------------------------------------------------------------------------ | ------------------------- | ------------------------- |
| nit 40bb cash                                                                              | +13.75 +/- 0.98           | +12.64 +/- 0.88           |
| nit 100bb cash                                                                             | +10.42 +/- 0.98           | +11.13 +/- 1.21           |
| nit 30bb, two left in a heads-up SNG                                                       | +17.89 +/- 1.04           | +20.35 +/- 1.07           |
| fold-sb-defend-bb 40bb                                                                     | +0.30 +/- 0.14            | +0.30 +/- 0.23            |
| fold-sb-defend-bb 100bb                                                                    | +0.16 +/- 0.05            | -0.15 +/- 0.13            |
| wide 40/100bb, calibrated 40bb, mirror 40/100bb, nit with memory off, wide tournament 30bb | inert (0 divergent pairs) | inert (0 divergent pairs) |

Declared rule: SUPPORTED (nit pool z_conf +14.48, development +12.09; no no-harm cell at or below z -2; memory-off cell 0 divergent pairs; 0 illegal actions, truncated streets and brain fallbacks). Tournament branch kept (z_conf +17.36). Development evidence only: scripted personas on the calibrated profile and Horse mirrors, not human play; no rake in the league; empty solver stores; measured on a tree without huBbDefendsUnreadToPrice (the two options were never measured together).

## Limits stated by the exact-head review (Hand Analysis, 0039d2bc)

- The fold share 1 - 2 x VPIP is an estimate, not a strict bound: it uses the posterior mean VPIP, assumes exactly half of his counted hands were big blinds, and does not separate walks and limped pots in the hand count. The break-even gate is strict in practice (cash needs VPIP under about 0.17). A law case pinning these three assumptions is required before the option is ever proposed for activation.
- The receipt `hu_tight_big_blind_steal` counts qualifying spots (every hand considered for the open), including hands that would have opened anyway and hands a later layer still does not open; it is not a count of changed decisions.

## Not done here

D8 (the 26-35bb reshove and the limp branch skipping the tight respect) no longer reproduces as graded on main: Hold'em #10915 (in serving 7e8688d3) drops the bluff and blocker reshoves against a credibly tight 3-bettor and every remaining jam carries the respect receipt; the limp-reraise bluffs now call. No option was built for it.
