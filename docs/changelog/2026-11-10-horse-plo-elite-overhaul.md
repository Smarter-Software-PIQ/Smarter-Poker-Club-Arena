# V86: Horse PLO4 / PLO5 / PLO6 / PLO8 & Cross-Variant Elite Strategy Overhaul (2026-11-10)

## Overview

V86 upgrades Horse decision quality across PLO4, PLO5, PLO6, PLO8 (Hi-Lo), Double-Board Bomb Pots, Short Deck (6+), Pineapple, and deep/straddled NLH cash and tournament play, while introducing the Bully-Breaker counter-strategy against high-VPIP / high-stab loose-aggressive opponents (`80% VPIP / 46% PFR / 66% Flop Stab` archetype).

All V86 behavior is controlled by `v86PloOverhaul` (default `true` in live play and `HorseDecisionWorkerRuntime`, `false` only in historical frozen-digest neutrality corpora) and uses pure deterministic FNV/Murmur spot hashing (`v86Hash01`) so decision mixing and Hollywood timing never shift `fastRandom()` PRNG streams.

---

## 1. PLO4 / PLO5 / PLO6 / PLO8 Preflop Architecture

- **Variant-Aware Hand Classification (`HorseHandClasses.omahaEliteClassRead`)**:
  - Classifies 4-, 5-, and 6-card Omaha and PLO8 hands into structural classes: `aa_ds`, `aa_dry`, `plo8_scoop`, `broadway_conn_ds`, `rundown_ds`, `ax_nut_suited`, `kk_ds`, `rundown_ss`, `pair_support`, `dangler`, `trips`, `trash`, and `other`.
  - Tracks clean 2-card suits (`cleanSuits`), 3+-of-a-suit self-blockers (`selfBlockedSuits`), nut-Ace suits, secondary King suits, and tightest 4-card connected rank windows.
  - Unlocks `canThreeBet`, `canFourBetShallow`, and `canSqueeze` for double-suited rundowns (`JT98ds`, `T987ds`), connected double-suited broadways (`KQJTds`, `AQJTds`), suited-`Ax` nut bridges, `KKQQds`, and two-way PLO8 scoop hands (`AA2x`, `AA3x`, `A23x` suited, `A2KQds`) instead of flattening every non-`AA` Omaha hand under `neverThreeBet: true`.
- **De-Saturated Multi-Card Strength (`HorseEval.omahaElitePreflopStrength`)**:
  - Preserves `omahaPreflopStrength` and `omahaReservoirs` unchanged for range construction while lifting clean double-suited rundowns and nut+King suit combinations, penalizing 3-suit and 4-suit self-blockers in PLO5/PLO6, penalizing disconnected 5/6-card danglers, and boosting two-way `A2` PLO8 scoop hands.
- **Active 3-Betting, Pot-Squeezing, Shallow 4-Betting, & Limp Isolation (`HorsePreflop`, `HorseLogic`)**:
  - **Elite PLO 3-Bets (`v86_plo_elite_three_bet`)**: Horses 3-bet pot with double-suited rundowns, connected broadways, nut-suited `Ax`, `KKds`, and `plo8_scoop` hands (boosted IP and against wide openers via `aggressiveOpenerPressure`).
  - **Pot-Sized PLO Squeezes (`v86_plo_squeeze`)**: Attacks open + cold-call dead money in pot-limit Omaha with squeeze-eligible multi-way nut hands.
  - **Non-`AA` Shallow/Mid-SPR 4-Betting (`v86_plo_shallow_four_bet`)**: At `<= 130bb` effective stacks (`SPR <= 4` in 4-bet pots), `canFourBetShallow` hands pot-4-bet so the Horse 4-bet range is no longer `AAxx`-only.
  - **3-Bettor / 4-Bettor Continuation (`v86_plo_three_bettor_continues`)**: Prevents raise-folding `40%+` equity rundowns and nut-suit hands when facing a 4-bet at `<= 0.45` pot odds.
  - **Limper Isolation & PLO MTT Aggression**: Enables `isoWiden` (`0.05`) in Omaha for `canThreeBet` / double-suited hands over limpers, and enables `tAggroPlo` late/blind steal and re-steal pressure in PLO tournaments.

---

## 2. Postflop Commitment, River Discipline, & Deceptive Sizing

- **Underboat, PLO6, & Multiway River Call Discipline (`HorseOmahaBigBetCalls.v86OmahaUnderboatOrDominatedFold`)**:
  - **Underboat Fold (`v86_plo_underboat_fold`)**: Folds the lowest full house when beaten by two or more higher full-house combinations (`lowerBoats === 0 && boats >= 2`) facing `>= 0.78` pot river bets or `>= 0.65` pot river raises.
  - **PLO6 Big-Bet Parity (`v86_plo6_big_bet_fold`)**: Extends `>= 0.90` pot river fold protection to `plo6` for non-nut straights, bare two pair, and dominated or second-nut flushes.
  - **Multiway Medium-Big River Folds (`v86_plo_multiway_dominated_fold`)**: Folds bare two pair and dominated flushes facing `0.65-0.89` pot bets in `3+`-way cash rivers at `35bb+` effective depth.
  - Retains calls against verified postflop over-bluffers (`bettorOverBluffs`).
- **Street Commitment & Turn Implied-Odds Guards (`HorseLogic`)**:
  - Excludes hero's current-street wager (`investedBefore86`) when evaluating `committed` on bet-then-raised Omaha streets so deep-stack bet-folding remains intact.
  - Applies `v68NoRoomToBePaid` on Omaha turns (`v86_omaha_no_room_implied`) to zero phantom implied-odds credit on non-nutty draws when remaining stacks cannot pay off on the river.
  - Scales postflop Omaha value thresholds by SPR (`spr <= 3`: `-0.04` commitment shift; `spr >= 7` non-nut: `+0.035` pot-control shift) and refines `omahaMwStep` from `0.045` to `0.026` to eliminate multiway value paralysis.
- **Nut-Combo-Draw Pump & Jam, Traps, & Block-Bet Balance (`HorseLogic`)**:
  - **Combo-Draw Pump & Jam (`v86_plo_combo_draw_pump`)**: Leads and pot-raises `nutFlushDraw` + `6+` nut-straight-out wraps in heads-up and 3-way (`oppCount <= 2`) pots.
  - **PLO8 Scoop Freeroll (`v86_multiboard_or_plo8`)**: Leads and raises nut-low + high-equity redraw freerolls (`lo >= 0.42-0.45` with scoop/high backup).
  - **OOP River Block-Bet Balance (`v86_river_block_trap`)**: Mixes `22%` nut-class hands into the `28%-32%` OOP river block-bet sizing while suppressing unprotected medium river block-bets against LAG bullies.
  - **IP Flop Nut Check-Back Trap (`v86_ip_nut_checkback_trap`)**: Checks back `25%` of nutted sets/boats IP on dry static Omaha flops to protect checking ranges and induce turn stabs.
  - **Range C-Bets & Turn Probes (`v86_range_cbet_or_probe`)**: Fires `33%-40%` pot stabs on dry/high boards and checked-through turns across solverless variants while scaling flop c-bets by `HorseMind.foldToCbetOf`.

---

## 3. Bully-Breaker Anti-LAG Counter-Attack System

- **LAG-Aware Winner Respect (`HorseWinnerRead.respectWinner`)**:
  - Disciplined TAG winners continue to receive `WINNER_BLUFF_MOD = 0.6` and `WINNER_VALUE_THIN_MOD = 0.85`.
  - High-VPIP / high-stab LAG winners (`isLagBully = true`) keep `1.0x` bluff playback and expand thin value to at least `WINNER_LAG_VALUE_THIN_FLOOR = 1.12` so wide stabs and loose calldowns are punished rather than rewarded with passivity.
- **Street-Specific Bully Detection (`HorseMind.isLagBully` & `HorseMind.streetBullyRead`)**:
  - Identifies high-VPIP / high-aggression bullies and tracks high flop stabbers (`betCheckedTo >= 52%`) who check-give-up on turns (`turnGiveUp` / `checkedTurnAfterFlopStab`).
  - Powers OOP check-to-trap check-raises with sets/nutted hands (`v86_lag_bully_counter`) and `68%+` turn takeaway probes when a flop stabber checks back the turn.
- **Multi-Street Maniac Barrel Narrowing (`HorseLogic.maniacCallDown`)**:
  - Adds street-by-street `priorBarrelNarrow86` (`0.065` per earlier postflop barrel street in Omaha, `0.05` in Hold'em; receipt `v86_lag_bully_barrel_narrow`) so triple-barrels from preflop-wide LAGs are priced against progressively narrowed ranges rather than raw preflop air.
- **Durable Boot Hydration (`HorseExploitHydrator`)**:
  - Replays historical `hand_history` net outcomes (`net`, `stackEnd - stackStart`, or `winners - invested`) into `HorseWinnerRead.observeHandResults` on startup so proven-winner and LAG-bully memory survives every engine restart.

---

## 4. Cross-Variant, Timing, Persona, Top-Up, & Self-Tuner Enhancements

- **Double-Board & Bomb Pots (`multiBoard36`)**:
  - Folds dead-half spots facing `>= 0.60` pot bets when `minBoardEq < 0.18` and `maxBoardEq < 0.88` (`v86_multiboard_dead_half_fold`, guarded by `continuationGuard: 'dominated_commitment_floor'` so `maniacCallDown` never overrides it).
  - Leads and pot-raises when locking/dominating one board (`>= 0.78-0.80`) with a live redraw (`>= 0.32`) on the second board (`v86_multiboard_or_plo8`), and restores multi-street/raised per-board range reads.
- **NLH Straddle, `160bb+` Deep-Stack, & Cash Polarized 3-Bets**:
  - Normalizes `effectiveStackBB` by the active straddle unit when `gs.straddleActive === true`.
  - Applies `shadeDeep86` (`0.08`, `v86_nlh_deep_pot_control`) pot control with bare one-pair/two-pair hands facing raises or `>= 0.85` pot bets at `120bb+` commitment depth (`160bb+` starting stacks).
  - Widens IP Ace-blocker (`A5s-A2s`) polarized 3-bet bluffs (`bluffFloor - 0.04`).
- **Short Deck (`6+`) & Pineapple**:
  - Adds `shortDeckElitePreflopStrength` (boosting suited Aces and suited connectors while shading `66-99`) while keeping `v46ShortDeck` opt-in, and extends `V61/V65` turn/river one-pair bluff-catch shades to Short Deck and post-discard Pineapple.
- **Zero-PRNG Hollywood Timing (`HorseLogic.computeThinkTime`)**:
  - Adds a deterministic `28%` Hollywood tank (`+2.4s..4.8s` via `v86Hash01`) on postflop raises facing a bet and river bets in `25bb+` pots with zero extra `fastRandom()` draws.
- **Tuner-Immune PLO Personas, `$2/$5+` Top-Ups, & Leak Review**:
  - `HorsePersona.ploPersonaFor` assigns deterministic, tuner-immune PLO archetypes (`lag_shark`, `tricky_trap`, `tag_crusher`, `nit_hunter`) without touching `profiles.horse_profile.persona`.
  - `HorseSessionRotator` reloads active PLO personas (`lag_shark`, `tag_crusher`, `tricky_trap`) below `80%` buy-in (`0.80` vs `0.45`) at `$2/$5+` (`bb >= 5`) PLO cash tables within `topUpAllowance`.
  - `HorseHandReview` emits `plo_underboat_stackoff`, `plo_multiboard_dead_half_call`, and `plo_passive_rundown_oop` (registered in `HorseDataLedger`), and `HorseSelfTuner` scales the ring-cash VPIP ceiling up to `OMAHA_CASH_VPIP_HI = 0.44` by `omahaShare` so winning 6-max PLO Horses are never over-tightened to NLH VPIP ceilings.

---

## Verification

- `npx vitest run src/engine/HorsePloEliteOverhaul.test.ts`: deterministic unit, live `HorseDecisionWorkerRuntime` integration, PRNG stream-parity, leak/tuner/hydrator, and multi-variant Horses vs LAG Bully simulation benchmarks all green.
- Full TypeScript compilation (`npx tsc --noEmit`) and Engine / Neutrality / Postflop / Tuner / Hydrator Law suites verified green.
