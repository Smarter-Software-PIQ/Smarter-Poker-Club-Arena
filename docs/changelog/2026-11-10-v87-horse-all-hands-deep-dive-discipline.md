# V87 All-Hands Human-vs-Horse Deep-Dive Discipline (`2026-11-10`)

## Summary

Building on top of V86 (`v86PloOverhaul`, `docs/changelog/2026-11-10-horse-plo-elite-overhaul.md`) and following an exhaustive all-database analysis of `PokerIQ-Production` human-vs-Horse play through `2026-11-10T21:30:00Z` (`49,310` physical human-involved hands, `41,151` eligible included hands, `349,970` Horse decisions across the 8 target Cash & MTT NLH / PLO4 / PLO5 / PLO6 domains; PLO8 excluded), V87 (`server/src/engine/HorseDeepDiveDiscipline.ts`, wired behind `v87DeepDiveDiscipline`, default ON) permanently fixes four high-bleed structural leaks in `HorseLogic` and `HorsePreflop`:

1. **Omaha Multiway Preflop & 5/6-Card Hand-Class Selectivity (`PLO4` / `PLO5` / `PLO6` Cash & MTT):**
   - Sanitizes presumed unknown-opener Omaha reads in 6-card `PLO6` and multiway (`callers >= 1`) `PLO4`/`PLO5`/`PLO6` pots so `threeBetBar` value adaptation remains active while `flatBar` and `bbFlatBar` no longer override multiway cold-call / BB-defense thresholds; single-open (`callers === 0`) 4-card and 5-card defense, observed human reads, and evidenced wide/maniac raisers remain untouched.
   - Caps `V24` Omaha price-defense relief and scales continue floors (`V24` and `V34` BB catch) plus cold-call bars in multiway (`callers >= 1`) `PLO4`/`PLO5`/`PLO6` and 6-card `PLO6` pots, tightening 6-card `PLO6` and multiway (`limpers >= 2`) Omaha limp-behind / SB-complete ranges.
   - Calibrates 5-card and 6-card `V46` hand-class reads to rescue playable trips containing a coordinated 4-card `aa_ds` or `broadway_ds` core alongside V86 `omahaEliteClassRead` without double-counting V86's 4-to-a-suit or non-Ace-suited adjustments (and applying full 5/6-card adjustments when V86 `omahaElite` is disabled).
2. **Heads-Up Omaha Position-Stab Qualification Holdback (`PLO4` / `PLO5` / `PLO6`):**
   - Paired duplicate-deal seat-swapped `HandController` qualification measured `heads_up_position_stab` turn suppression at `-8.96 +/- 3.34` bb/100 (`3,000` HU hands) and river suppression at `-15.03 +/- 3.79` bb/100 across `15,000` paired seat-swapped HU self-play deals (`30,000` hands, `p = 0.00007`; `+0.66 +/- 1.97` bb/100 vs human-calibrated HU). Both turn and river suppression failed qualification and are excluded from production activation (`v87ShouldSuppressOmahaPositionStab` returns `false`).
3. **Postflop `PLO6` Big-Bet Call Discipline & Omaha Bet-Raised Sizing:**
   - Extends `>= 0.90`-pot non-HU `> 20bb` turn/river call-fold discipline to 6-card `PLO6` alongside V81 and V86 `v86OmahaUnderboatOrDominatedFold` (covering PLO6 turn two pair, vulnerable straights, and non-nut/paired-board flushes without nutty redraws, plus river vulnerable trips, two pair, vulnerable straights, non-nut/paired-board flushes, and dead-bottom underboats), exempting evidenced maniacs/over-bluffers.
   - Withholds the unconditional `+0.10` flop `V40` pressure-cap lift on drawless bare pair / air in multiway (`oppCount >= 2`) `PLO4`/`PLO5`/`PLO6` or 6-card `PLO6` flops, and excludes hero's current-street bet from `committed` (with a raise-scaled call-or-fold shade on turn/river, multiway flop, or 6-card flop) when a non-nut Omaha bet is raised without a nutty redraw and the aggressor is not an evidenced maniac/station.
4. **Ante / Multiway `pricedIn` Trash Floor & NLH Turn Cold-Raise / Multiway Shade:**
   - Adds a minimum preflop hand-strength floor to `V13`'s `pricedIn` pot-odds guard when facing a non-all-in raise (`0.065 < guardOdds <= 0.15`) in tournaments or non-HiLo Omaha, preserving deliberate 22:1 min-click calls (`guardOdds <= 0.065`), evidenced maniac defense, Cash NLH, and all-in calls.
   - Adds a turn equity shade in single-board Hold'em when facing a cold raise (`pressure20 >= 2`) or a multiway `>= 0.75`-pot barrel (`oppCount >= 2`) with bare one pair / board-paired two pair and no hole-card draw against non-maniac/non-station bettors.

## Validation

- Replay of `4,582` real human-vs-Horse production spots (identical seeds, `v87DeepDiveDiscipline` off vs on): `0` illegal actions, `0` Cash NLH preflop changes, `0` PLO8 changes, all shadow and worker-backed receipts valid.
- Paired duplicate-deal league A/B, `16,000` hands over `32` cells on non-holdout development seeds: overall `+0.73 +/- 1.50` bb/100, human-calibrated and pressure fields `+12.32 +/- 5.58` bb/100, `0` illegal actions, `0` conservation errors.
- Evidence: `/Volumes/SmarterArchives/agent-evidence/extreme-archive/horse-deep-dive-77614b53/analysis/`.
