# omahaOpponentLifetimeHudDecides: Authority For The Live Switch

Evidence NOT MET for a live switch-on: the consumer passed its sparring-bench record 2 (criteria CRITERIA-OPPONENT-HUD-8-RECORD-2.md sha256 31b1bc775a4cf3a5d6787b5d8cf4d970bcc3cb8ada28a6c39ee38bd441e41e31, seed 20261124) as omahaOpponentLifetimeHud on the graded tree lifetime-hud3 (wt4 0f011165c72); this rebuild on the list train inherits that verdict only if decision-identical on the record-2 replay (lead rulings 12:58 PM Chicago Nov 21, item 4). Its live trial follows the store being on and backfilled (EMERG/OPPONENT-HUD-ACTIVATION.md, consumer section). Grade of 2026-11-26 (lead-7 lane grading, "What Was Measured" below): not ready for live shadow; the prior is a 99.5% Horse population, 23 of the audit's protected strengths break in the real-hand replay and 2 decisions take over 50 ms (p95 21-22 ms whole, confirming the cost table of PR #12068): not ready until its cost fix lands. After the prior-anchor build (same day): prior anchored; still not ready (replay 93 / 73 with 16 strengths broken, speed).

## What It Does

PLO4/PLO5 cash (tables and Lightning), flop, turn and river only; never preflop, tournaments or PLO6. With this option AND `omahaOpponentLifetimeHud` on (that one arms the store and attaches each opponent's lifetime public profile to the decision), `HorseMind.opponentRead` takes the opponent's counters from his lifetime profile, shrunk n/(n+k) toward the population of his stake band and game, in place of the 30-hand decayed window and the shared presumed-aggressor read; the fold model's lifetime input carries its measured calibration (`HUD_EV_FOLD_CALIBRATION`), and the lifetime read alone never lowers an aggressive action. One mechanism for every opponent, person or Horse; public information only, never an unshown card.

Default OFF in source (read `=== true`). Off, or on without `omahaOpponentLifetimeHud`: the decision read options are exactly what they were (no key added), pinned by TheLifetimeHudConsumerIsTheOnlyDecisionReader.law. Registered in the option switch, switchable live, takes shadow (re-decided on PLO4/PLO5 flop, turn and river with `omahaOpponentLifetimeHud` as companion; a shadow re-decision reads the lifetime record only while the store option is on).

## Receipts

`opponent_hud_exploit_counters`, `opponent_hud_presumption_replaced_lifetime`, `opponent_hud_presumption_replaced_prior` and the other `opponent_hud_*` decision receipts; with the option off none of them fires (the store's own `opponent_hud_provider_armed_seen` is the provider's).

## Rollback

Set this option off (one switch row, lead only). The store keeps running on `omahaOpponentLifetimeHud`; nothing else changes.

## Prior anchor

NOT MET (grade of 2026-11-26). Every lifetime read is shrunk by n / (n + k) toward the population prior of the stored `'*'` row (`fitHudPriors`: the pooled rate over every stored profile, k by method of moments clamped to [2, 400]; a stake band's pooled rate replaces it with 200 or more opportunities). That population is the Horse field: in the stored rows read 2026-11-26, Horses hold 3,862,402 of 3,882,144 PLO5 preflop opportunities (99.5%; 1,019 Horse profiles against 40 person profiles) and 6,141,903 of 6,155,698 PLO4 (99.8%; 1,043 against 64). So an opponent with a short record is read as a Horse, not as equilibrium play. The opponent's own record does take over as it grows (weight n / (n + k), median k 116 PLO5, 170 PLO4), but on a few statistics k is so small that a thin record dominates: `pf.limp` k 4.4 (PLO5) and 2.6 (PLO4), `pf.f4bet` k 4.8 and 8.2, `pf.c4bet` k 8.0 (PLO5), `f.bsz.o` k 2 (PLO4): there 5 hands carry about half the weight. The exploit counters themselves are scaled to at most 300 hands and read by the consumers' own credibility rules.

After the prior-anchor build (same day): MET at the read. With this option on, every read shrinks toward the equilibrium anchor (`HorseEquilibriumAnchor.ts`: indifference points and stated reference frequencies, never Horse data) with k >= 20, so 5 opportunities carry at most 20% and 300 at least 94%; recency stays in the blended counts.

## What Was Measured (Grade 2026-11-26, Lead-7 Lane Grading)

Graded with the store `omahaOpponentLifetimeHud` on (as production holds it) in both arms: BASE = production, arm B = production + this option.

Method (lane grading, PLO-OWNER lead-7, 2026-11-26; scratch tools and every raw result in `$S7/grading/`, BUILD.md there). Production option set = the `ca_horse_style_switch` rows not off, read 2026-11-26 05:4xZ (55 rows; the seven style rows as the style switch applies them). Source: `origin/main` `211c4e9e`, whose engine files are unchanged since the serving build `d07cd7d7`.

- League mirror: the sparring bench (`SparringLeague.runSparringCell`) with the lifetime HUD learned per arm and deal (`SparringHud`, production's stored population priors), 100 bb, seed 20261126. Seat 0 is a Horse on the production option set; every other seat plays the arm (BASE = production, or production plus the option). Every arm plays the same deals; the figure is the paired same-deal change of seat 0's net, sign turned so that + means the option's seats won chips (bb/100 ± SE). Heads-up this is exactly ON against OFF; at six seats it is one OFF seat against five ON seats.
- Probes: the same bench with seat 0 scripted: always-caller (never bets or raises, calls every wager), over-folder (Horse, but folds to any wager without the top 15% preflop or 70% equity postflop), habitual 3-bettor (`threebet_every_open`), tight opener (Horse, but enters preflop only with the top 15%). Figure: the same paired change of seat 0's net with the sign turned (+ = the option's seats took more from the probe than production's seats did; a significant minus is an exploit), 4,000 hands per cell. Misleading lifetime record (HUD readers): a warm-up cell (seed 7, 3,000 hands, production arm) builds every seat's lifetime record while seat 0 plays one style; the measuring cell starts every arm's store from that export and seat 0 plays the opposite style.
- Real-hand replay: every tier-A (cards shown) Horse decision of the PLO hand audit (`$S6/hand-audit-plo/decisions.csv` 4,011 and `daily/2026-11-25T230000Z/decisions.csv` 1,216; 5,227 nodes in 1,064 hands), re-decided from the recorded public snapshot with the deciding Horse's own shown cards only (`hand_history.players[].cards` dropped on read, never used), real seat ids, mind on with an empty in-session memory, and the lifetime HUD packet production attaches (`buildHudPacket`, priors by stake) built from `opponent_hud_profiles` as read on 2026-11-26 (look-ahead stated: those public profiles also hold hands played after the decision). Seeds 1, 7, 42, majority action. Scored twice: by the committed scorer (`--placed`, verdict-only; row below, copied unedited) and on the audit's own EV table (its `options` column and tolerance rule, resizes included); the base arm reproduced the recorded action on 3,941 of 5,227 nodes. Strengths = the audit's "What the Horses do well" classes (section 5): 773 replayed decisions the base arm plays correctly in those classes.
- Speed: the engine's own `HorseLogic.decide` per decision on the same 5,227 real states (one seed, tsx build, Mac Studio at load 14 to 22), on the spots where the option applies.

Chips (bb/100, + = the option's seats won more than production's on the same deals):

| cell                                           | game          | hands | option seats bb/100 vs production (± SE) | z     | hands parted | illegal + fallbacks |
| ---------------------------------------------- | ------------- | ----- | ---------------------------------------- | ----- | ------------ | ------------------- |
| league mirror                                  | PLO5 heads-up | 12000 | +8.27 ± 5.09                             | +1.62 | 1824         | 0                   |
| league mirror                                  | PLO5 6-max    | 12000 | +8.08 ± 7.23                             | +1.12 | 4692         | 0                   |
| always-caller                                  | PLO5 6-max    | 4000  | -16.78 ± 25.70                           | -0.65 | 2671         | 0                   |
| over-folder                                    | PLO5 6-max    | 4000  | -11.65 ± 9.40                            | -1.24 | 1514         | 0                   |
| habitual 3-bettor                              | PLO5 6-max    | 4000  | +13.38 ± 37.29                           | +0.36 | 2024         | 0                   |
| always-caller                                  | PLO5 heads-up | 4000  | -1.32 ± 8.69                             | -0.15 | 1649         | 0                   |
| over-folder                                    | PLO5 heads-up | 4000  | -7.69 ± 5.24                             | -1.47 | 293          | 0                   |
| habitual 3-bettor                              | PLO5 heads-up | 4000  | +21.36 ± 18.12                           | +1.18 | 878          | 0                   |
| tight opener                                   | PLO5 heads-up | 4000  | +0.75 ± 4.40                             | +0.17 | 122          | 0                   |
| maniac (lifetime record built as tight opener) | PLO5 6-max    | 4000  | +97.98 ± 38.46                           | +2.55 | 1264         | 0                   |
| maniac (lifetime record built as tight opener) | PLO5 heads-up | 4000  | -0.42 ± 24.12                            | -0.02 | 467          | 0                   |
| tight opener (lifetime record built as maniac) | PLO5 heads-up | 4000  | +9.54 ± 6.76                             | +1.41 | 221          | 0                   |
| league mirror                                  | PLO4 heads-up | 12000 | -1.27 ± 3.60                             | -0.35 | 1425         | 0                   |

Probes and misleading records: no significant loss (largest minus: over-folder 6-max -11.7 ± 9.4, z -1.2; heads-up -7.7 ± 5.2, z -1.5). An opponent whose lifetime record says tight but who now plays as a maniac did not exploit the read (6-max +98.0 ± 38.5 for the option's seats, heads-up -0.4 ± 24.1); a lifetime maniac now playing tight: heads-up +9.5 ± 6.8. League mirror PLO5 heads-up +8.3 ± 5.1, 6-max +8.1 ± 7.2, PLO4 heads-up -1.3 ± 3.6 (none past 2 SE); PLO4 6-max not run (skipped for wall time). Chips: met (no significant loss).

Real-hand replay (5,227 tier-A nodes; 3,566 postflop where it applies): 880 decisions changed, 656 of them bet or raise resizes. Committed scorer: fixed 70, newly wrong 31. Audit EV table: fixed 94, newly wrong 91 (action changes alone 62 fixed / 48 newly wrong; resizes 32 / 43); net +1,421 bb on the audit model, of which 1,973 bb gained on fixes and 794 bb lost on new mistakes. Audit strengths: 138 of 773 protected decisions changed, **23 broken** (16 heads-up turn bets resized off the audited EV, 4 heads-up turn bets turned into checks, 3 flop calls turned into raises or a fold: the audit's "turn bets OOP heads-up" strength). Not met: not clearly more fixed than newly wrong on the audit's own EV table, and the strengths are not unchanged.

Correction (2026-11-26, same lane): the audit-EV scoring above put a bet resize at the nearest of the audit's 33/66/100% pot points (16 of the 23 "broken" rows were resizes of a few percent of the pot). Scored with the EV interpolated between those points: fixed 97, newly wrong 92, **19** protected strengths broken. The committed-scorer row is unchanged; the verdict is unchanged.

Speed (3,566 real postflop spots, one seed, two runs): whole decision p50 5.4 to 6.9 ms, p95 21.1 to 22.1 ms, max 93.5 to 98.6 ms, 133 to 148 over 25 ms, **2 over 50 ms**; added by the option p95 12.7 to 17.0 ms, max 32.7 to 70.9 ms. This confirms the cost table of PR #12068 (ON p95 34 ms, added p95 28 ms on 583 spots, under load): over the bar on p95, maximum and the 50 ms line. Where the time goes (V8 CPU profile, B arm against the production arm on the same 3,566 spots, 38.4 s against 34.0 s): 4.45 s of the 4.5 s added sits under `omahaHudPricedRaiseOverCall` (`HorseOmahaPricedWiring.ts`) -> `omahaPricedSampledRaise` (`HorseOmahaPricedRules.ts`) -> `omahaBigDrawEquities` (`HorseOmahaBigDrawAggression.ts`), a Monte Carlo equity per call that this option's lifetime read switches on: self time in `scoreOmahaHi` (+1.96 s) and `scoreFiveCards` (+1.80 s), plus `estimateRangeAdvantage` (+0.54 s), `omahaTurnRiverTables` (+0.45 s) and `fiveCardScoreOfMasks` (+0.40 s). The HUD packet itself is cheap (`buildHudPacket` 0.18 s in all).

Verdict: **NOT READY for live shadow until its cost fix lands**, regardless of chips. Also: prior anchored to a 99.5% Horse population, 23 protected strengths broken in the replay, 2 decisions over 50 ms. The league gains (+8.3 heads-up, +8.1 6-max, both under 2 SE) do not outweigh those.

## After The Prior-Anchor Build (2026-11-26, Lead-7)

What changed for this option: with it on (and the store on), every HUD read of the decision shrinks toward the equilibrium anchor with k >= 20 instead of the population row (`hudStat`), and the lifetime exploit counters' rates are shrunk the same way before any read's threshold sees them (`hudExploitCounters`: opportunities kept, hits moved toward the anchor), so a short record cannot pass a maniac or pressure threshold on its own. Same method, seeds and sets as the grade above, on the prior-anchor build (branch `agent/plo-lead7-01TLQer8/prior-anchor`; `HorseEquilibriumAnchor.ts`): flag-off check 0 differences in 28,000 decisions; tier-A replay on the audit EV table with resizes interpolated; speed one seed on the same 5,227 states.

| cell                                           | game          | hands | option seats bb/100 vs production (± SE) | z     | hands parted | illegal + fallbacks |
| ---------------------------------------------- | ------------- | ----- | ---------------------------------------- | ----- | ------------ | ------------------- |
| league mirror                                  | PLO5 heads-up | 12000 | +4.38 ± 4.83                             | +0.91 | 1704         | 0                   |
| league mirror                                  | PLO5 6-max    | 12000 | +8.08 ± 7.23                             | +1.12 | 4692         | 0                   |
| always-caller                                  | PLO5 6-max    | 4000  | -19.99 ± 27.82                           | -0.72 | 2646         | 0                   |
| over-folder                                    | PLO5 6-max    | 4000  | -10.92 ± 9.38                            | -1.16 | 1513         | 0                   |
| habitual 3-bettor                              | PLO5 6-max    | 4000  | +25.41 ± 37.21                           | +0.68 | 2003         | 0                   |
| always-caller                                  | PLO5 heads-up | 4000  | +9.69 ± 7.92                             | +1.22 | 1661         | 0                   |
| over-folder                                    | PLO5 heads-up | 4000  | +2.72 ± 5.60                             | +0.49 | 270          | 0                   |
| habitual 3-bettor                              | PLO5 heads-up | 4000  | -33.03 ± 18.43                           | -1.79 | 922          | 0                   |
| tight opener                                   | PLO5 heads-up | 4000  | +0.75 ± 4.40                             | +0.17 | 122          | 0                   |
| maniac (lifetime record built as tight opener) | PLO5 6-max    | 4000  | +115.21 ± 44.49                          | +2.59 | 1443         | 0                   |
| maniac (lifetime record built as tight opener) | PLO5 heads-up | 4000  | +5.99 ± 24.48                            | +0.24 | 464          | 0                   |
| tight opener (lifetime record built as maniac) | PLO5 heads-up | 4000  | +14.93 ± 7.66                            | +1.95 | 226          | 0                   |
| league mirror                                  | PLO4 heads-up | 12000 | -3.23 ± 3.57                             | -0.91 | 1414         | 0                   |

| measure                                                                  | before                     | after                       |
| ------------------------------------------------------------------------ | -------------------------- | --------------------------- |
| replay, committed scorer                                                 | 70 / 31                    | 62 / 22                     |
| replay, audit EV table (strengths broken)                                | 97 / 92 (19)               | 93 / 73 (**16**)            |
| misleading lifetime record (tight record, now a maniac) 6-max / heads-up | +98.0 ± 38.5 / -0.4 ± 24.1 | +115.2 ± 44.5 / +6.0 ± 24.5 |
| speed, whole decision p95 / max (ms)                                     | 21.1 / 93.5                | 20.3 / 93.0 (1 over 50)     |

Verdict after: **NOT READY.** Prior anchor met at the read (anchor, k >= 20; recency stays in the blended counts and the misleading-record probe does not beat it); chips met (no significant loss). Not met: the replay (93 fixed against 73 newly wrong, 16 protected strengths broken) and speed (p95 20 ms, one decision over 50 ms; the time is the Monte Carlo under `omahaHudPricedRaiseOverCall`, the speed lane's item). Cause of the replay result: the option swaps the presumed-aggressor read for each opponent's real read on every postflop decision, and the heads-up turn bets of the audit's strengths are sized and continued by rules keyed on that read; the anchor does not change which of those rules a long, real record reaches.

## Replay

- Replay: fixed 62; newlyWrong 22; changed 204; unchanged 5023; unjudged 100; set PLO audit tier A (cards shown) PLO4/PLO5 cash 2026-11-20..25; scorer 5302af2ab3e; source placed verdict-only; arm B vs off; replayed 5227 of 5227
