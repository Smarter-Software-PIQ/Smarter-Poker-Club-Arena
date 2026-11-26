# omahaPreflopReadIsPricedFromLifetime: Authority For The Live Switch

Evidence NOT MET for a live switch-on: B4 six-max preflop lifetime HUD read (retiring the preflop half of `plo_opponent_presumed_aggressive`) requires its own sparring-bench + symmetric M5 person grade after LIST TRAIN, FIX-1, and HUD-9 land on `main`. Grade of 2026-11-26 (lead-7 lane grading, "What Was Measured" below): not ready for live shadow; on the audited real hands more decisions are newly wrong than fixed (83 against 50) and the prior is the Horse field.

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, single board, non-bomb-pot, non-AoF, PREFLOP only, 3–6 dealt seats (`sh`). Strictly excludes heads-up (`dealt === 2`, owned by `omahaButtonOpenIsPriced`), tournaments, PLO6, and hi-lo.

With this option AND `omahaOpponentLifetimeHud` on:

1. `HorseMind.opponentRead` on 3–6 seat PLO4/PLO5 cash preflop reads each opponent's lifetime public HUD counters (`hudExploitCounters`) instead of `presumedAggressorRead` (`plo_opponent_presumed_aggressive` fires drop to 0 on 6-max preflop).
2. At the `maniac_pressure_preflop` site (`HorseLogic.ts`), whenever retiring the presumption removes a maniac-pressure width (`widened === true`), `priceOmahaPreflopHudSixMax` prices the raise against call/fold directly on six-max (`sh`) HUD cells (`hudStatIn(..., 'sh')`, exact `pf.lr` for limpers facing iso, exact `pf.bvo` for blinds facing open) with continuous `n / (n + k)` shrinkage, SRP vs 3-bet realization, zero sample cliff, zero person-vs-Horse key, and zero unshown hole cards.
3. Strictly silent (`null` -> keeps legacy width) when `pf.lr` / `pf.bvo` is missing on limped/unopened blinds, or when `raises >= 2` is owned by `omahaPreflopReraiseDefencePricedInPosition` / `omahaFourBetFoldPricedCall`.

Default OFF in source (read `=== true`). Registered in `OPTION_SWITCH_RELEASE_DEFAULT_OFF` and `OPTION_SHADOW_STAGE` (`streets: ['preflop']`, companion `omahaOpponentLifetimeHud`).

## Receipts

`opponent_hud_exploit_counters`, `opponent_hud_presumption_replaced_lifetime`, `opponent_hud_presumption_replaced_prior`, `opponent_hud_preflop_priced_{fold,call,raise}`, `opponent_hud_preflop_unpriced_legacy`.

## Rollback

Set `omahaPreflopReadIsPricedFromLifetime` off (one switch row, lead only).

## Prior anchor

NOT MET (grade of 2026-11-26). The priced comparison reads six-max HUD cells (`hudStatIn(..., 'sh')`, `pf.lr`, `pf.bvo`) shrunk by n / (n + k) toward the stored population prior, and that population is 99.5% Horse play in PLO5 and 99.8% in PLO4 (stored `'*'` rows read 2026-11-26: 3,862,402 of 3,882,144 and 6,141,903 of 6,155,698 preflop opportunities). A new or thin opponent is therefore priced as the Horse field, not as equilibrium play. Preflop statistics carry the smallest k in the store (`pf.limp` k 4.4 PLO5 / 2.6 PLO4, `pf.f4bet` 4.8 / 8.2, `pf.c4bet` 8.0 PLO5, `pf.vpip@d3` 11.9 / 13.6), so on them a record of five to ten hands already carries about half the weight.

## What Was Measured (Grade 2026-11-26, Lead-7 Lane Grading)

Graded with the store `omahaOpponentLifetimeHud` on (as production) and `omahaOpponentLifetimeHudDecides` off (as production) in both arms: BASE = production, arm C = production + this option. Scope: 3 to 6 dealt seats preflop; heads-up is out of scope: the PLO5 heads-up mirror cell (1,500 hands) parts on 0 hands.

Method (lane grading, PLO-OWNER lead-7, 2026-11-26; scratch tools and every raw result in `$S7/grading/`, BUILD.md there). Production option set = the `ca_horse_style_switch` rows not off, read 2026-11-26 05:4xZ (55 rows; the seven style rows as the style switch applies them). Source: `origin/main` `211c4e9e`, whose engine files are unchanged since the serving build `d07cd7d7`.

- League mirror: the sparring bench (`SparringLeague.runSparringCell`) with the lifetime HUD learned per arm and deal (`SparringHud`, production's stored population priors), 100 bb, seed 20261126. Seat 0 is a Horse on the production option set; every other seat plays the arm (BASE = production, or production plus the option). Every arm plays the same deals; the figure is the paired same-deal change of seat 0's net, sign turned so that + means the option's seats won chips (bb/100 ± SE). Heads-up this is exactly ON against OFF; at six seats it is one OFF seat against five ON seats.
- Probes: the same bench with seat 0 scripted: always-caller (never bets or raises, calls every wager), over-folder (Horse, but folds to any wager without the top 15% preflop or 70% equity postflop), habitual 3-bettor (`threebet_every_open`), tight opener (Horse, but enters preflop only with the top 15%). Figure: the same paired change of seat 0's net with the sign turned (+ = the option's seats took more from the probe than production's seats did; a significant minus is an exploit), 4,000 hands per cell. Misleading lifetime record (HUD readers): a warm-up cell (seed 7, 3,000 hands, production arm) builds every seat's lifetime record while seat 0 plays one style; the measuring cell starts every arm's store from that export and seat 0 plays the opposite style.
- Real-hand replay: every tier-A (cards shown) Horse decision of the PLO hand audit (`$S6/hand-audit-plo/decisions.csv` 4,011 and `daily/2026-11-25T230000Z/decisions.csv` 1,216; 5,227 nodes in 1,064 hands), re-decided from the recorded public snapshot with the deciding Horse's own shown cards only (`hand_history.players[].cards` dropped on read, never used), real seat ids, mind on with an empty in-session memory, and the lifetime HUD packet production attaches (`buildHudPacket`, priors by stake) built from `opponent_hud_profiles` as read on 2026-11-26 (look-ahead stated: those public profiles also hold hands played after the decision). Seeds 1, 7, 42, majority action. Scored twice: by the committed scorer (`--placed`, verdict-only; row below, copied unedited) and on the audit's own EV table (its `options` column and tolerance rule, resizes included); the base arm reproduced the recorded action on 3,941 of 5,227 nodes. Strengths = the audit's "What the Horses do well" classes (section 5): 773 replayed decisions the base arm plays correctly in those classes.
- Speed: the engine's own `HorseLogic.decide` per decision on the same 5,227 real states (one seed, tsx build, Mac Studio at load 14 to 22), on the spots where the option applies.

Chips (bb/100, + = the option's seats won more than production's on the same deals):

| cell                                           | game          | hands | option seats bb/100 vs production (± SE) | z     | hands parted | illegal + fallbacks |
| ---------------------------------------------- | ------------- | ----- | ---------------------------------------- | ----- | ------------ | ------------------- |
| league mirror                                  | PLO5 6-max    | 12000 | +7.78 ± 4.86                             | +1.60 | 2169         | 0                   |
| always-caller                                  | PLO5 6-max    | 4000  | +19.36 ± 23.91                           | +0.81 | 1220         | 0                   |
| over-folder                                    | PLO5 6-max    | 4000  | -8.08 ± 3.98                             | -2.03 | 689          | 0                   |
| habitual 3-bettor                              | PLO5 6-max    | 4000  | -22.63 ± 38.08                           | -0.59 | 1815         | 0                   |
| maniac (lifetime record built as tight opener) | PLO5 6-max    | 4000  | +54.29 ± 55.79                           | +0.97 | 1662         | 0                   |
| league mirror                                  | PLO5 heads-up | 1500  | +0.00 ± 0.00                             | +0.00 | 0            | 0                   |

Probes: **a significant loss to the over-folder at 6-max: -8.1 ± 4.0 bb/100 (z -2.0)**; the always-caller (+19.4 ± 23.9), the habitual 3-bettor (-22.6 ± 38.1) and the misleading record (lifetime tight, now a maniac: +54.3 ± 55.8) show nothing past 2 SE. League mirror PLO5 6-max +7.8 ± 4.9 (z +1.6). PLO4 6-max and the 6-max tight-opener probe not run (skipped for wall time). Chips: not met (one probe beats it).

Real-hand replay (5,227 tier-A nodes; 1,661 preflop where it applies): 346 decisions changed (fold to call 184, call to raise 73, fold to raise 35). Committed scorer: fixed 2, **newly wrong 11** (308 unjudged). Audit EV table: fixed 50, **newly wrong 83** (call to raise 48 newly wrong against 9 fixed); net +77 bb on the audit model (503 gained, 566 lost). Audit strengths: 25 of 773 protected decisions changed, **19 broken** (all heads-up-pot preflop calls in position turned into raises: the audit's "preflop calls IP heads-up" strength). Not met on either scorer: more decisions newly wrong than fixed.

Speed (1,661 real preflop spots, one seed): whole decision p50 2.5 ms, p95 8.0 ms, max 34.0 ms, 2 over 25 ms, 0 over 50 ms; added p95 6.7 ms, max 29.2 ms. p95 and the 50 ms line met, the 25 ms maximum not.

Verdict: **NOT READY for live shadow.** Newly wrong exceeds fixed on the real audited decisions (83 against 50; committed scorer 11 against 2), the over-folder probe beats it at 6-max (-8.1 ± 4.0 bb/100), and the prior is the Horse field.

## Replay

- Replay: fixed 2; newlyWrong 11; changed 322; unchanged 4905; unjudged 308; set PLO audit tier A (cards shown) PLO4/PLO5 cash 2026-11-20..25; scorer 5302af2ab3e; source placed verdict-only; arm C vs off; replayed 5227 of 5227
