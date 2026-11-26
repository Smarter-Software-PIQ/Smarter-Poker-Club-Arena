# holdemOpeningValueBetIsPriced: Authority For The Live Switch

**State: default OFF in source** (registered, never switched). Evidence NOT MET. NOT READY: it fails the league grade heads-up (ON - OFF -12.4 ± 4.8 bb/100 per seat over 60,000 hands, seed 3303; -12.4 ± 4.6 without the turn resize; six-max +0.5 ± 3.3); it passes the exploit probes (heads-up, with the superseded fold cap) and the real-hand audit replay (fixed 16 / newly wrong 6 with no opponent memory, 12 / 4 with memory as of each decision). Keep it OFF; this file does not authorize switching it on.

## What It Does

Not facing a wager, heads-up, on the flop, turn or river: the brain's check becomes a bet at the legal priced size of highest EV when (1) the Horse's equity against the part of his range that calls at that size is above one half (the hands that call lose chips to it on balance) and (2) the bet prices above the check. A turn bet the brain made is resized to that size when the bet is a value bet at its own size and the priced size prices higher. A bet is never taken back and nothing facing a wager is touched.

Receipts: `holdem_opening_value_bet`, `holdem_opening_value_resized`, `holdem_opening_priced_unpriced`.

Default OFF in source (`OPTION_SWITCH_RELEASE_DEFAULT_OFF`, read `=== true`), registered in the option switch (`off / shadow / on_shadow / on`), switchable live; scoped to NLH cash tables and Lightning by its own gate and by its shadow-stage games.

## How It Prices

Scope: no-limit hold'em cash, table and Lightning (never tournaments, Short Deck, fixed limit, bomb pots, all-in-or-fold tables, run-it-twice boards), one board, heads-up, the Horse NOT facing a wager. The hook sits in the reference node right after `holdemValueAndCallsArePriced` (`HorseLogic.holdemOpeningPriced`); later graph nodes still apply. The math is `server/src/engine/HorseHoldemOpeningIsPriced.ts`:

- His range: his public line range (the hvc line model, extracted unchanged into `HorseLogic.holdemPricedLineRead`): his preflop band re-weighted street by street by his public actions. Read twice: with the Horse's own two cards removed (for the Horse's equity) and with no hole card removed (for who folds: he cannot see the Horse's cards).
- His fold to a bet B into pot P: `holdemPricedFold(foldRef, B, P)` (fold = foldRef x (B / (B + P)) / 0.337, at most 0.95; never capped by the modelled weak share of his range, which would override his own record). `foldRef = (his folds + 20 x 0.337) / (his opportunities + 20)`: on the river his river response record (riverCallOpp - riverCall of riverCallOpp), else his fold to a bet (foldToBet of foldToBetOpp).
- Who folds: the weakest f of the range read without the Horse's cards (a strength cutoff). With the Horse's cards removed, the share under that cutoff is his fold given the Horse's hand (f'); the Horse's equity against the rest is eqCall.
- EV(bet) = f' P + (1 - f') (r eqCall (P + B + B') - B), B' his matched call; EV(check) = r eq P; r = 1 on the river or in position, else 0.88 (`HOLDEM_PRICED_REALIZATION_OOP`, the hvc constant; a stated limit).
- Sizes: the legal priced bet sizes of the hvc module (1/3, 1/2, 3/4, pot, and all in within 1.5 pots), legalized by the engine; the size of highest EV is taken. No random draw anywhere: the turn and flop equities use the hvc module's seeded private generator (keyed on the Horse's cards, the board and the pot); the same state gives the same answer on every seed.

## Prior anchor

- Baseline: with no record his fold at the reference price is 0.337, so his fold to any bet equals the bettor's break-even price B / (B + P) (equilibrium minimum defence): a pure bluff with no blockers is worth exactly nothing; his bet share when checked to (line shape only) is anchored at one half.
- Population weight: zero. No population rate of any kind is read (not the Horse field, not people); the anchor carries 20 pseudo-opportunities and nothing else.
- Own record: his own decayed counters (river response record on the river, fold to a bet otherwise) dominate as they grow, weight n / (n + 20); with the mind off or no counters the anchor stands.
- No unshown cards: nothing was fitted; his range is read from public actions only and the only hole cards read are the deciding Horse's own.

## How To Trial It (Live Shadow Stage)

Staged in `HorseOptionShadowStage.OPTION_SHADOW_STAGE` (`holdemStage(['nlh_cash', 'nlh_lightning'], ['flop', 'turn', 'river'])`): set the switch row to `shadow` (`node scripts/ops/horse-option-switch.mjs set <option> shadow`), and read the per-direction watch with `node scripts/ops/horse-option-shadow-watch.mjs <option> --since <ISO>` (the per-direction counters `option_shadow_<option>_dir_<from>_to_<to>_seen` count each would-be change: from a check to a wager is the only direction this option takes, plus `_dir_size_seen` for the turn resize). The acted decision is unchanged in shadow.

## Grades (chips), 2026-11-25

Harness scripts are in the lane's scratch folder (`plo-lead7-01TLQer8/chooser/src`: `mirror.mjs`, `probe.mjs`, `rc.mjs`), on this branch's source, with the production options of `docs/horse-option-switch-state.json` (asOf 2026-11-25T23:38Z, 73 decide options) in both arms and the option added in ON. No database; jobs niced, one at a time.

League mirror (every seat a Horse on the hybrid cash profile; each deal played twice with the ON and OFF seats swapped; one memory sandbox per pass; bb/100 per seat, ± standard error):

| table           | seed | deals (hands)   | ON - OFF bb/100 per seat | code                                                |
| --------------- | ---- | --------------- | ------------------------ | --------------------------------------------------- |
| heads-up 100 bb | 1101 | 10,000 (20,000) | -3.9 ± 9.0               | superseded: with the weak-share fold cap            |
| 6-max 100 bb    | 1101 | 10,000 (20,000) | -0.7 ± 3.0               | superseded: with the weak-share fold cap            |
| heads-up 100 bb | 3303 | 30,000 (60,000) | -21.9 ± 4.7              | superseded: with the weak-share fold cap            |
| 6-max 100 bb    | 3303 | 10,000 (20,000) | -0.7 ± 3.4               | superseded: with the weak-share fold cap            |
| heads-up 100 bb | 3303 | 30,000 (60,000) | -12.4 ± 4.8              | this code                                           |
| heads-up 100 bb | 3303 | 30,000 (60,000) | -12.3 ± 4.6              | development variant: no turn resize (not committed) |
| 6-max 100 bb    | 3303 | 10,000 (20,000) | +0.5 ± 3.3               | this code                                           |

Exploit probes (heads-up, 100 bb, 12,000 hands per arm on the same deals, the script in seat 0 with memory on; the script is the production Horse with the options OFF except: caller never folds to a postflop bet; over-folder folds every turn and river bet unless its equity against a random hand is at least 0.8; balanced bluffer, when first to act or checked to on the river, bets 2/3 pot with equity 0.8+ and bluffs air (equity under 0.3) on a seeded quarter, a measured bluff share of 22% of its river bets against 28.6% balanced at that size):

| probe      | Horse OFF bb/100 | Horse ON bb/100 | ON - OFF (hand by hand) | code                                      |
| ---------- | ---------------- | --------------- | ----------------------- | ----------------------------------------- |
| caller     | +367.0 ± 20.1    | +523.4 ± 23.6   | +156.4 ± 15.1           | with the weak-share fold cap (superseded) |
| overfolder | +3.1 ± 7.6       | -2.2 ± 7.7      | -5.3 ± 5.8              | with the weak-share fold cap (superseded) |
| bluffer    | +6.6 ± 8.5       | -3.2 ± 9.1      | -9.8 ± 6.5              | with the weak-share fold cap (superseded) |

Real-hand audit replay (the daily NLH cash audit of 2026-11-24/25, 390 hands with people, `decisions.csv`, exact tier = the deciding Horse's own cards known; 67 hands pulled read-only with `complaint-extract.sql`, which returns no person's cards; each decision re-decided at its recorded public snapshot, live hybrid cash profile, seeds 1/7/42; this code). A decision is fixed when the option-off replay is not the audit's best action and the option-on replay is (kind, and a bet within max(1 bb, 15% of the pot) of the best size, or for a decision the audit judged correct the recorded action), newly wrong the reverse:

- Opponent memory OFF: fixed 16, newly wrong 6, changed but still not the audit's best 6 (right kind, size outside the tolerance or the wrong kind), changed ok to ok 4, unchanged 287, of 319 exact-tier postflop decisions placed (the base reproduces the recorded action kind in 241); recorded cost of the fixed decisions 211 bb.
- Opponent memory AS OF EACH DECISION (every retained hand with a person settled before it learned into a private sandbox; history: the REPLAY-V2 pull of has_human hands before 2026-11-20 plus a read-only pull of 5,132 has_human NLH hands 2026-11-20 06:00Z to 2026-11-26 01:17Z, public columns only, no hole cards): fixed 12, newly wrong 4, changed but still not the audit's best 6 (right kind, size outside the tolerance or the wrong kind), changed ok to ok 6, unchanged 291, of 319 exact-tier postflop decisions placed (the base reproduces the recorded action kind in 252); recorded cost of the fixed decisions 170.5 bb.

Horse strengths (the audit's river bets and in-position calls): river bets 20, changed 1; in-position calls 24, changed 0

Both options together (superseded code with the weak-share fold cap): league mirror

| table    | seed | hands  | ON - OFF bb/100 per seat |
| -------- | ---- | ------ | ------------------------ |
| heads-up | 4404 | 40,000 | +21.9 ± 7.0              |
| 6-max    | 4404 | 16,000 | +13.2 ± 4.5              |

real-hand replay: fixed 17, newly wrong 8, changed but still not the audit's best 10 (right kind, size outside the tolerance or the wrong kind), changed ok to ok 5, unchanged 279, of 319 exact-tier postflop decisions placed (the base reproduces the recorded action kind in 241); recorded cost of the fixed decisions 212.1 bb.

## Speed

Per-decision cost of HorseLogic.decide where the option applies: production options, heads-up league hands, every postflop spot where the production decision is a check or a turn bet with nothing to call, timed OFF and ON on the same state, the first 50 dropped. 100 bb: 947 spots, ON p50 / p95 / max 1.13 / 1.72 / 2.56 ms (OFF 0.62 / 1.47 / 2.10). 300 bb: 962 spots, 1.10 / 1.68 / 2.40 ms (OFF 0.63 / 1.47 / 2.21). The stage bar is p95 <= 10 ms and max <= 25 ms.

## Why It Loses Heads-Up (Diagnosis)

Two heads-up probes against a fixed production Horse (memory on, 15,000 hands per arm, ON - OFF) separate the cause. Against the plain production Horse the result is -17.1 ± 6.4 bb/100, the league loss reproduced. Against the same Horse with every postflop raise turned into a call it is -3.4 ± 5.8. The chips go to his raises of the Horse's new value bets. The bet's EV prices his folds and calls only.

Fixing that needs his raise share facing a bet. No per-opponent counter of it exists in the read frame the live worker reads (ExploitCounters has none; HorseOpponentStyle lists it as not available). With no record, the raise share would need an equilibrium anchor that is not measured here. That is the next step: a memory counter and a read-frame field for postflop raises per opportunity, then the bet EV priced with his raise branch and the Horse's answer to it. Earlier root-cause fix, in this branch: the fold cap at his modelled weak share (river value bets -12.0 -> -1.7 bb/100).

## Limits

- Heads-up only: multiway opening spots (several of the audit's missed bluffs and flop value bets were multiway) are not touched.
- Cash only: tournaments are out of scope (no tournament grade was run; no ICM modelling).
- The real-hand replay ran with opponent memory off, so every opponent read the no-record anchor; live, a person's own record moves his fold (the audit's missed river bluffs were judged against people who fold more than the equilibrium).
- The realization factor out of position on the flop and turn (0.88) is the hvc module's constant, not computed.
- The check's value is its showdown value (his bet behind an out-of-position check is not priced).
- The replay row below is NOT RUN: the committed audited-decision scorer (`audited-decision-replay.ts`) has no adapter for the daily audit's `decisions.csv`; the replay above is the lane harness `rc.mjs`.

## Replay

- Replay: NOT RUN (the committed scorer has no adapter for the daily NLH cash audit decisions.csv; the lane harness rc.mjs result is recorded in Grades)
