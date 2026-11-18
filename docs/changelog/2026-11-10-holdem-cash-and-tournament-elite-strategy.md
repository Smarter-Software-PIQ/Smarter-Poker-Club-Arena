# V87: Hold'em Cash (25%-30% VPIP) & Tournament Elite Strategy + Ecosystem Overhaul (2026-11-10)

## Overview

V87 upgrades Horse decision quality across 2-Card No-Limit Hold'em Cash Games (locking 9-handed VPIP inside `25%-30%` at `100bb` and `250bb`, expanding Early Position opening ranges and board coverage, and maintaining strict seat-count monotonicity from 9-max through heads-up) and No-Limit Hold'em Tournaments (Early, Middle, Money Bubble, In-The-Money, Final Table ICM, and PKO/Mystery Bounty formats), alongside all seven Hold'em Ecosystem upgrades and the Anti-LAG Bully-Breaker counter-strategy.

All V87 behavior is gated by `v87HoldemOverhaul` (default `true` in live play and `HorseDataLedger` snapshots, `false` only in historical frozen-digest neutrality corpora) and uses pure deterministic spot hashing so decision mixing and Hollywood timing never shift `fastRandom()` PRNG streams.

---

## 1. NLH Cash 25%-30% VPIP & Early Position Deception (`HorseGtoOpeningRanges`, `HorsePreflop`, `HorseHoldemPremiumAggression`)

- **9-Max 25%-30% VPIP Calibration & Early Position Board Coverage**:
  - Updates `V85_CASH_OPEN_TARGET` and exports `gtoCashActionOpenStrength` (exact `gtoOpenStrength` at `<= 50bb` so `45bb` short-stack invariance holds, blending upward above `50bb` via `v85DepthWeight`).
  - Elevates implied-odds and board-coverage hands in Early and Middle Position (`22+`, suited connectors `54s-T9s`, suited one-gappers `86s-J9s`, suited wheel/mid Aces `A2s-A9s`, suited Kings `K7s-K9s`, and `Q9s`) ahead of dominated offsuit traps (`ATo`, `KJo`, `QJo`).
  - Lands 9-max NLH Cash VPIP cleanly inside `[25%, 30%]` at both `100bb` and `250bb`, keeps 6-max cash VPIP inside `[29%, 38%]`, and preserves strict monotonicity across `9 < 8 < 7 < 6 < 5 < 4 < 3 < 2` active seats.
- **Stake-Scaled Multiway Cold-Call / Overcall Widening & Elevated 3-Bet Frequency (`HorseGtoDefenceRanges`, `HorsePreflop`)**:
  - Widens single-open cold-calls, BTN/CO overcalls behind a caller (`callers >= 1`), and SB/BB defense with suited connectors/gappers, suited `Ax`/`Kx`, set-mine pocket pairs, and playable broadways so `3`-handed and `4`-handed flops occur regularly in cash games.
  - Scales calling width by stake level (widest at low stakes `bb <= 2`, moderate at `bb = 5`, baseline V87 at `bb >= 10`) while raising linear + suited-blocker `3-bet%` (`~8%-11%` cash, `~7.5%-10%` MTT) and preserving `45bb` / `v85CashAction: false` solver-base pins and `HorseHoldemPremiumAggression` Rule 4.
- **Early Position Limp-Reraise Trap (`QQ, KK, AA`) & Suited-Connector Limp Mix (`54s-T9s`) in Cash & Tournaments**:
  - Exports `classifyHoldemEpLimpCandidate` (`'big_pair_trap'` for `QQ, KK, AA`; `'suited_connector'` for `54s-T9s`).
  - Mixes deterministic, zero-PRNG-shift Early Position open-limps in unopened 6+-handed pots in both Hold'em Cash (`>= 55bb`) and Hold'em Tournaments (`>= 35bb`), recording `v87_ep_limp_trap` and `v87_ep_limp_suited_connector` authority receipts while keeping `0%` open-limps on weak/junk hands (`72o`, `94o`, `K9o`, etc.).
  - `HorseHoldemPremiumAggression` honors `epLimpTrap: true` ONLY on the unopened EP limp (`raises === 0`, `callersSinceLastRaise === 0`) and **100% limp-reraises** (`v87_ep_limp_reraise_value`) whenever any opponent iso-raises behind.
  - Suited-connector EP limps (`54s-T9s`) defend standard iso-raises via calls (`v87_ep_limp_call_iso`) plus mixed limp-3-bet bluffs (`v87_ep_limp_reraise_bluff`), eliminating weak limp-fold giveaways.
- **Limp-Isolation, Straddle Depth Normalization, `<35bb` 4-Bet Reshoves, & Ante Trash Floor**:
  - Keeps `gtoOpen70` active over `1-2` limpers in cash and enables `isoW` limp-isolation from Early Position (`UTG+1`, `UTG+2`) as well as Middle and Late Position.
  - Normalizes `straddleActive` stack depth (`effectiveStack / (2 * bb)`) so positional `gtoOpen70`, `gtoDefend72`, and `gtoVs3Bet73` ranges stay live in straddled cash games instead of reverting to legacy tight bars.
  - Executes `<35bb` 4-bet bluffs and high-equity pressure hands (`A5s-A2s`, `ATs+`, `KQs`, `77-JJ`) as **all-in 4-bet reshoves**, complying 100% with `HorseHoldemPremiumAggression` Rule 4 ("No 4-bet is ever made to fold").
  - Enforces a `strength >= 0.26` floor on `pricedIn` calls facing a raise (`raises >= 1 && !callIsAllIn`), stopping big-blind-ante pot-odds auto-calls with trash (`72o`, `83o`, `92o`).

---

## 2. Hold'em Postflop Arsenal & Multi-Board Discipline (`HorseLogic`)

- **SPR-Driven Gameplan (`Low SPR <= 3.5` vs `Deep Cash SPR >= 8` at `150bb-250bb+`)**:
  - Commits decisively in low-SPR 3-bet/4-bet pots with TPTK+, overpairs, and `12+` out combo draws.
  - Applies deep-stack cash pot control (`150bb+` / `160bb+` effective stacks, `SPR >= 8`) on bare one-pair hands (`cat === 2`, including bare overpairs and TPTK on coordinated turns/rivers or facing multi-street `>= 65%` pot barrels and postflop raises) so Horses do not stack off `200bb` with one pair against non-maniacs.
- **Small-Ball `30%-38%` Dry Range C-Bets & Multiway Wet-Board Discipline**:
  - Fires crisp `30%-38%` pot range c-bets heads-up IP as preflop aggressor on dry/paired static boards while tightening air c-bets multiway (`oppCount >= 2`) on wet coordinated flops.
- **Deceptive `25%` IP Non-`QQ+` Check-Back Traps**:
  - Mixes `~25%` IP flop check-back traps on dry boards strictly with non-`QQ+` pocket-pair sets (`22-JJ`), disguised two-pair, straights, and flushes (never slowplaying `QQ/KK/AA` overpairs or top sets where `HorseHoldemPremiumAggression` Rule 3 requires betting).
- **`12+` Out Combo-Draw Pump, IP Flop Float + Turn Scare-Card Takeaway, & `V64` Nut-Blocker River Raises**:
  - Fast-plays `12+` out combo draws (`comboDrawAggro`) via check-raises OOP and raises IP (`< 38%` stack or clean all-in jam per `v78NoCommittingBluffRaise`).
  - Floats dry/medium flop c-bets IP with backdoor/gutshot/overcard equity against `highFlopStab` / `turnGiveUp` opponents and fires `62%-72%` pot turn takeaways when checked to (`checkedTurnAfterFlopStab`).
  - Preserves `V64` bluff-catcher call caps on `cat === 2` one-pair hands while unlocking disciplined `8%-12%` river bluff-raises with `cat <= 1` nut-blocker missed draws (`blockerScore >= 0.65`) against non-stations.
- **NLH Double-Board Bomb Pot Anti-Dead-Half Discipline**:
  - Folds Hold'em multi-board (`communityCards2` / `extraCommunityBoards`) turn and river spots facing `>= 60%` pot pressure when holding `<= 1 pair` (`cat <= 2`) on one board without locking or nutting the other board.

---

## 3. Anti-LAG Bully-Breaker & Ecosystem Upgrades #1-#4 (`HorseWinnerRead`, `HorseMind`, `HorseOpponentExploit`, `HorseExploitHydrator`, `HorseLogic`)

- **Ecosystem #1 - Eliminate the `28%-33%` OOP River Block-Bet Sizing Tell (`V12`)**:
  - Balances OOP `28%-33%` pot river block-bets by mixing `~22%` nutted hands (`cat >= 4` / `adjEq >= 0.85`, designed to bet-3-bet trap aggressive raisers) plus `~10%-12%` nut-blocker river bluffs (`cat <= 1`, `blockerScore >= 0.5`).
  - Suppresses fragile `1-pair` (`cat === 2`) river block-bets into identified `isLagBully` opponents (preferring check-call bluff-catching), and prevents `committed` / `maniacCallDown` from auto-calling big river raises with bare one-pair after block-betting while value 3-betting nut traps.
- **Ecosystem #2 - Eliminate `"Fast = Nuts / Tank = Marginal"` Timing Tell (`computeThinkTime`)**:
  - Adds a deterministic `25%-35%` Hollywood tank mix (purely derived from `think` / spot hash with **zero `fastRandom()` calls**) on nutted postflop check-raises, `>= 20bb`-pot river value bets/raises (`adjEq >= 0.80`), and preflop 4-bets / limp-reraises.
- **Ecosystem #3 - LAG-Aware `HorseWinnerRead` & Restart Hydration (`HorseExploitHydrator`)**:
  - Updates `respectWinner(profile, userId, isLagBully)` with `WINNER_LAG_VALUE_THIN_FLOOR = 1.12`: proven TAG winners still receive `0.60x` bluff and `0.85x` thin-value throttling, whereas high-VPIP / high-stab LAG winners keep full bluff playback (`1.0x`) and boosted thin value (`>= 1.12x`).
  - Hydrates `HorseWinnerRead` from recent `hand_history` net results on startup via `HorseExploitHydrator` so winner and LAG-bully memory is active on Hand #1 after any engine restart.
- **Ecosystem #4 - Street-Specific Bully Detection (`isLagBully`, `streetBullyRead`) & `maniacCallDown` Decay**:
  - Exports `isPostflopManiac` (`HorseOpponentExploit`), `HorseMind.isLagBully`, and `HorseMind.streetBullyRead` (`{ highFlopStab, stabRate, turnGiveUp, checkedTurnAfterFlopStab }`) using replay-safe read-frame stats and public action history.
  - Powers `40%-45%` OOP check-raise traps with TPTK+/2p/sets/combo-draws against high flop-stabbers, extends anti-stab defense to 3-way pots (`oppCount <= 2`), softens `V80` `AK/AQ` TPTK fold shade by `+0.05` against triple-barrel LAG bullies, and decays `maniacCallDown` on Turn (`* 0.65`) and River (`* 0.35`) when a flop stabber's late-street barrel rate drops.

---

## 4. Hold'em Tournament Mastery & Ecosystem Upgrades #5-#7 (`ServerTableEngineTurns`, `HorsePersona`, `HorseSelfTuner`, `HorseHandReview`, `HorseSessionRotator`)

- **Tournament Bubble Pressure, Reshove Wedges, PKO Pricing, & Full-Table ICM Overlay**:
  - Widens covering big-stack CO/BTN/SB opens and 3-bets (`+6%-8%`) and postflop turn/river probe pressure (`+10%-14%`) against ICM-handcuffed medium stacks (`15-45bb`) near the bubble and pay jumps across full `2..9`-seat tables.
  - Shifts covered medium stacks away from dominated offsuit call-offs into `16-26bb` 3-bet all-in reshove wedges (`A5s-A2s`, `22-88`, `KQs`, `QJs`) and postflop pot control on bare one-pair hands.
  - Applies PKO / Mystery Bounty chip-equivalence odds boosts when covering all-in short stacks.
- **`F06` Tournament Time-Bank Tank Preservation (`ServerTableEngineTurns`)**:
  - Guards `resumeContinuationTimeBankActivation` (`!this.horseActionTimer && (this.horseDecisionAbortController === null || this.horseDecisionAbortController.signal.aborted)`) so live Horse Hollywood/deep tanks survive transition into `CONTINUATION_TIME_BANK` without aborting or restarting the timer, while unscheduled recovery continuations still schedule normally (`HorseTournamentTimeBankF06.test.ts`).
- **Ecosystem #5 - Tuner-Immune `holdemPersonaFor`, Isolated `HorseSelfTuner` Cash VPIP Envelope, & 4 Hold'em Leak Detectors**:
  - Adds deterministic, tuner-immune `holdemPersonaFor` archetypes (`lag_shark`, `tricky_trap`, `tag_crusher`, `nit_hunter`) in `HorsePersona.ts` while leaving `HorsePersonaV2` and `personaFor` untouched.
  - Isolates NLH Cash (`25%-30.5%` VPIP), NLH Tournament (`BENCH.vpip`), and Omaha Cash (`0.42`) tuning envelopes in `HorseSelfTuner.ts` (`BENCH` export preserved untouched) so tournament tightness never drags Cash Horses below `25%` VPIP.
  - Adds and registers 4 Hold'em leak detectors in `HorseHandReview.ts` and `EveryLeakTagHasADenominator.law.test.ts`: `nlh_deep_onepair_stackoff`, `nlh_passive_oop_coldcall_bleed`, `nlh_ep_limp_passivity`, and `nlh_bubble_covered_calloff`.
- **Ecosystem #6 - `$2/$5+` `80-100bb` Working Stack Maintenance (`HorseSessionRotator`)**:
  - Updates `topUpSeatedHorses` at `$2/$5+` (`bb >= 5`) NLH and PLO cash tables so `lag_shark`, `tag_crusher`, and `tricky_trap` archetypes maintain `80-100bb` working stacks (`effectiveTopUpFrac = 0.8`) within `topUpAllowance` stop-loss caps while leaving `HorseTopUpStyle.ts` untouched.
- **Ecosystem #7 - 50,000-Hand Hold'em Cash & Tournament Proving Ground (`HorseHoldemEliteOverhaul.test.ts`)**:
  - End-to-end deterministic proving ground suite verifying NLH Cash `25%-30%` VPIP at `100bb` and `250bb`, `9..2` seat monotonicity, Cash & MTT EP `QQ/KK/AA` limp-reraise traps and `54s-T9s` limp-mix defense, limp-isolation, straddle normalization, `<35bb` 4-bet reshoves, `pricedIn` `72o` folds, Ecosystem #1-#6 invariants, `200bb` deep pot control, Double-Board Bomb Pot dead-half folds, MTT bubble asymmetry, and a `>= 50,000`-hand simulation benchmark across 9-max Cash, 6-max Deep Cash vs a `65/38/18/68%-stab` LAG Bully, and NLH MTT `40bb` + Bubble `25bb` in under `8s` with zero illegal actions.
