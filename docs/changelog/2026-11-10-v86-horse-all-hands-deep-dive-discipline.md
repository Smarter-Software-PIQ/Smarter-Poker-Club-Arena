# V86 All-Hands Human-vs-Horse Deep-Dive Discipline (`2026-11-10`)

## Summary

Following an exhaustive all-database analysis of `PokerIQ-Production` human-vs-Horse play through `2026-11-10T21:30:00Z` (`49,310` physical human-involved hands, `41,151` eligible included hands, `349,970` Horse decisions across the 8 target Cash & MTT NLH / PLO4 / PLO5 / PLO6 domains; PLO8 excluded), V86 (`server/src/engine/HorseDeepDiveDiscipline.ts`, wired behind `v86DeepDiveDiscipline`, default ON) permanently fixes the four highest-bleed structural leaks identified in current `HorseLogic` and `HorsePreflop`:

1. **Omaha Multiway Preflop & 5/6-Card Hand-Class Selectivity (`PLO4` / `PLO5` / `PLO6` Cash & MTT):**
   - Sanitizes presumed unknown-opener Omaha reads so `threeBetBar` value adaptation remains active while `flatBar` and `bbFlatBar` no longer override multiway cold-call / BB-defense thresholds; observed human reads remain untouched.
   - Caps `V24` Omaha price-defense relief and scales continue floors (`V24` and `V34` BB catch) plus cold-call bars by hole-card count (`4` vs `5` vs `6`) and caller count, tightening multiway Omaha limp-behind / SB-complete ranges.
   - Calibrates 5-card and 6-card `V46` hand-class reads to rescue playable trips containing a coordinated 4-card `aa_ds` or `broadway_ds` core while tightening self-blocked 4-to-a-suit hands and non-Ace-suited 5/6-card rundowns.
2. **Heads-Up Omaha River Position-Stab Selectivity (`PLO4` / `PLO5` / `PLO6`):**
   - Suppresses the unconditional 100%-pot river button stab (`heads_up_position_stab`) when hero holds medium showdown value or unblocked zero-equity air so the reference check-back is retained with valid worker policy receipts, while preserving strong/nut value and dry nut-flush-blocker bluffs.
   - The turn stab is deliberately unchanged: a paired duplicate-deal HandController street ablation (3,000 HU hands per street, development seeds only) measured turn suppression at `-8.96 +/- 3.34` bb/100, so it was removed before submission.

## Validation

- Replay of `4,582` real human-vs-Horse production spots (identical seeds, V86 off vs on): `171` action changes (`3.73%`), fold `+168`, call `-158`, `0` illegal actions, `0` Cash NLH changes, `0` PLO8 changes, all shadow and worker-backed receipts valid.
- Paired duplicate-deal league A/B, `16,000` hands over `32` cells on non-holdout development seeds: overall `+0.73 +/- 1.50` bb/100, human-calibrated and pressure fields `+12.32 +/- 5.58` bb/100, `0` illegal actions, `0` conservation errors.
- Evidence: `/Volumes/SmarterArchives/agent-evidence/extreme-archive/horse-deep-dive-77614b53/analysis/`.

3. **Postflop `PLO6` Big-Bet Call Discipline & Omaha Bet-Raised Sizing:**
   - Extends `>= 0.90`-pot non-HU `> 20bb` turn/river call-fold discipline to 6-card `PLO6` (two pair, vulnerable straights, non-nut / paired-board flushes, and dead-bottom underboats with `>= 3` higher boats and `0` lower boats).
   - Withholds the unconditional `+0.10` flop `V40` pressure-cap lift on drawless bare pair / air in Omaha and excludes hero's current-street bet from `committed` (with a raise-scaled call-or-fold shade) when a non-nut Omaha bet is raised without a nutty redraw.
4. **Ante / Multiway `pricedIn` Trash Floor & NLH Turn Cold-Raise / Multiway Shade:**
   - Adds a minimum preflop hand-strength floor to `V13`'s `pricedIn` pot-odds guard when facing a non-all-in raise in tournaments or non-HiLo Omaha (Cash NLH and all-in calls remain untouched).
   - Adds a turn equity shade in single-board Hold'em when facing a cold raise (`pressure20 >= 2`) or a multiway `>= 0.75`-pot barrel (`oppCount >= 2`) with bare one pair / board-paired two pair and no hole-card draw.
