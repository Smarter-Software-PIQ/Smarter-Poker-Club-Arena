# holdemValueAndCallsArePriced: authority for the live switch

**State: LIVE ON** in production since `2026-11-22T23:25:25Z` / `5:25:25 PM CST` (`audit #185`, `evidence #76`, Horse SWITCH lane, on serving engine `88b8dac0ebdc`; switchable, source default OFF, read `=== true`). Activated by the Horse SWITCH lane on an independent verifier ACCEPT as a lane decision under the owner's full-ownership orders; Evidence NOT MET against the REPLAY-6 verdict-only bar (see below), and the activation rests on the real-card EV grade and the human-calibrated league results. Pickup verified read-only at `2026-11-22T23:37Z`: `holdem_priced_changed = 114` (plus `holdem_priced_bet 80`, `fold 88`, `call 52`, `check 27`, `raise 4` receipts) since activation, `0` `horse_error_log` rows, `0` config / illegal / fallback / exception / alarm / refusal telemetry rows, `recoverableRequestErrors = 0`, `0` stalled tables. Post-#11739 (`27dc68ab40b8`, M1/M2 root-cause fix) hosted solver-hydrated runs (`charts=240`, `postflop=7,747`, `0/0/0/0`, `0/6` seed regressions) confirm SIGNIFICANT wins on both 6-max human-calibrated (`45027743589`: `+22.59 +/- 6.19 bb/100`, `z = +3.65`, 3/3 positive seeds) and 9-max human-calibrated (`45027142185`: `+16.82 +/- 4.58 bb/100`, `z = +3.67`, 3/3 positive seeds) alongside flat mirrors (`44997647905` 6-max `-1.29 +/- 1.94`, `45013779484` 9-max `-1.90 +/- 1.34`), and the post-#11739 AsOf-memory real-card true-EV grade is positive across every cohort (`+608.62 bb` over `284/284` changed/resized decisions; `people` `+2.301 +/- 1.516 bb/decision`, `people-excl-top` `+2.800 +/- 1.640`, `horse_only` `+2.096 +/- 1.760`, every cohort `mean - SE > 0`), while the verdict-only HVH48-D AsOf-memory Replay row (`fixed 59`, `newlyWrong 46`, `changed 151`) passes the build floor (`newlyWrong <= fixed`) without reaching the 2:1 REPLAY-6 ratio. Mechanism, scope, receipts, tests and off-identity are met.

Owner orders it rests on: 2026-11-17 11:49 America/Chicago (verbatim): "a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."; and of the same day, the size of a bet may only feed the range and the price. Built by the NLH price lane (builder D-FIX of the HORSE DECISIONS lane, lead session_01TLQer7J) on 2026-11-19 from Auditor D's report (hvh48-audit-01TLQer7J/D-nlh-cash/REPORT.md: 399 NLH cash hands with people, 3,891 Horse decisions, 2026-11-18/19).

## The defects it repairs (HorseLogic.ts, decidePostflop)

1. The value raise facing a wager was a random draw: `originalValueRaise = fastRandom() < 0.55 x aggression + checkRaiseFreq (+ an out-of-position boost)`, else a call, at a random size `0.7 + fastRandom() x 0.4` of (pot + call). The audit counted 27 monster flat calls (348 bb), among them 77 on 2h4s4d7h and JJ on 2cJh3h.
2. A strong made hand without the lead checked at the V11 initiative gate, at random under the slowplay mix (`params.slowplayFreq`, 0.10 to 0.32, up to 0.6 under `trapMultiplier`), and checked back in position as the aggressor (about 300 bb).
3. A call facing a wager was priced against a preflop band with respect multipliers, not against the range that made the wager (about 340 bb).
4. River thin bets and the 0.28-0.32 pot block bet (`v86_river_block_trap`) were made with no comparison against the check (164 bb).

## What it does

No-limit hold'em cash (`gameVariant` nlh, not a tournament, not short deck, not fixed limit, no bomb pot, not all-in-or-fold, one board), table and Lightning (a Lightning pool is in scope; nothing reads `publicMemoryDomain`), postflop, exactly one live opponent. Tournaments are out (another builder owns them). With more than one live opponent the decision is kept (receipt `holdem_priced_unpriced_multiway`).

The decision `decidePostflop` returns is priced inside the reference (`HorseLogic.holdemPricedReference`, before the maniac call-down and every later owner) by `server/src/engine/HorseHoldemValueAndCallsArePriced.ts`:

- **His line range.** Every two-card combination the dead cards allow, kept where its preflop score lies inside his band (`HorseMind.bandFor` on the preflop history: the engine's own range read; every combination when there is no band), then re-weighted street by street on the board of that street: a wager keeps his strongest `b (1 - beta)` and weakest `b x beta` (a raise half of each), a call keeps his strongest `(1 - f)`, a street of checks only is weighted by `HorseActionLinePosterior`'s move over that street for the combination's bucket. `b` is his measured share of spots checked to him that he bets, `f` his fold at the price he was laid (below), `beta` on the river the share that leaves a call of his wager indifferent, `s / (pot + 2s)` (his size feeds his range and nothing else), on the flop and turn the posterior's bluff share for his line. The order of strength is the posterior's bucket on that board (made above the board: trips or better, two pair with both cards; top pair or an overpair; a flush draw or an open-ended straight draw; a weaker pair or a gutshot; air) and then the made score; it is never read off the Horse's own cards.
- **Equity.** The Horse's equity against each combination: exact on the river; 12 sampled rivers on the turn, 8 sampled runouts on the flop, drawn by a private generator (mulberry32) seeded by the Horse's cards, the board and the pot. Nothing draws from `fastRandom`.
- **His response.** His fold at the price a wager lays him, `risk / (risk + pot)`, is his measured fold to a bet (`HorseOpponentExploit.statRead` posterior on his decayed counters, centred on the measured population cell `OPPONENT_EXPLOIT_ENVELOPE`, horse-population-2026-10-16) carried along the minimum-defence line from the price at which it was measured, `HOLDEM_PRICED_REFERENCE_PRICE = 0.337` (the mean price of the Horses' 334 postflop bets in Auditor D's slice), capped at 0.95 and never above the weak part of his range (a weaker pair or a gutshot, or air: he never folds top pair, a strong draw or better). The part of his range that continues is its strongest `(1 - f)`.
- **Values** (chips, counted from the decision; R realizes equity: 1 on the river and in position, 0.88 out of position on the flop and turn, the audit's stated figure):
  - fold 0; call `R eq (pot + c) - c`;
  - raise to T, or bet: `f pot + (1 - f) (R eq_cont (pot + a + d) - a)`, a the chips the Horse adds that he can match, d his call;
  - check: in position or after his action, `R eq pot`; out of position with him to act, `(1 - b) R eq_checkback pot + b max(0, call his bet, raise his bet)`, his bet at the measured mean size (price 0.337), made with his strongest `b (1 - beta)` and weakest `b x beta`.
  - Sizes priced: bets of 0.33, 0.5, 0.75 and 1 pot; raises to the wager plus 0.5, 0.75 and 1 of (pot + call); all in when within 1.5 such pots; each legalized by the engine's own `legalize` before it is priced, and made at exactly that legal amount.
- **The choice.** Facing a wager: the brain's fold, call or value raise becomes the option of highest value among fold, call and each value raise. A raise is priced only for a made hand whose equity against the part of his range that continues is above one half (a value raise); a raise the brain made without a made hand (a bluff raise) is kept (`holdem_priced_bluff_raise_kept`). The random value-raise gate is not drawn: in scope it returns the call for the priced reference to compare with every legal raise (`holdem_priced_value_raise_deferred`). Not facing a wager: a made hand's check or bet becomes the option of highest value among the check and each legal bet; on the flop and turn only when its equity against his line range is at least one half (`holdem_priced_not_value_kept` otherwise); on the river every made hand. A bet without a made hand (a bluff) is kept. A tie keeps the passive option.

Off (absent, false or a truthy non-boolean): `holdemPricedOpponent` answers 'out' before anything is read and the wrapper is not called; every decision is byte-identical (law test).

## Receipts

`holdem_priced_value_raise_deferred`, `holdem_priced_raise`, `holdem_priced_call`, `holdem_priced_fold`, `holdem_priced_bet`, `holdem_priced_check`, `holdem_priced_changed`, `holdem_priced_unpriced`, `holdem_priced_unpriced_multiway`, `holdem_priced_bluff_raise_kept`, `holdem_priced_not_value_kept` (all registered in HorseDataLedger.ts).

## Tests

`server/src/engine/HoldemValueAndCallsArePriced.law.test.ts` (registered in docs/laws.d; 47 tests), on 27 decisions rebuilt from the audit's flagged hands (`HoldemValueAndCallsArePriced.fixture.json`: the public node, the public line and the deciding Horse's own cards only; ids replaced), replayed with the production option set of 2026-11-19 and the live cash profile:

- off, false and a truthy non-boolean give identical replays on every fixture and every base profile;
- red off, green on (17 GREEN + 2 AGREE_NOT_REPRODUCED): on each fixture the audit and this pricing agree on, the flagged action is taken on some seed with the option off and the audit's action class on every seed with it on (value raises: 77 on 2h4s4d7h, JJ on 2cJh3h, J3 trips, and QQ overpair on the turn promoted in #11684; strong-hand checks that bet: 77 on 2h4s4d7h, JJ on Js3d9h, J3 trips in position, the turn nut flush, A9 two pair, Q9 straight; calls/folds: the river call of JQ that folded, plus turn AT top-pair call, river TT dead-call fold, and river A7 dead-call fold promoted in #11684; three river thin or blocker bets that check; the A4 thin bet and the Q9 underbet agree but the off line does not reproduce them on these seeds);
- the 6 fixtures where this pricing disagrees with the audit are pinned to the priced action, deterministic on every seed (see "Disagreements");
- more than one opponent, a tournament: the decision is unchanged; a Lightning pool is priced;
- no value-raise decision reads `fastRandom` with the option on: the pricing module never calls it (counted under a module mock), the deferral returns before the random gate in the source, and every value-raise fixture gives the same decision on every seed;
- the closed forms and #11684 line-range invariants: the call and raise values, the fold capped by the weak part of the range, a raise only as a value raise, a tie keeping the passive option, proportional Air bluff selection, initial dead-money recovery from voluntary-only history (#11556), and no auto-profit river bluffs for `< 50%` equity made hands.

## Disagreements with the audit (stated, not hidden)

The audit's own range model (stated top-x ranges, a constant bluff share of f/(1+2f) of the pot fraction, people at 0.6 of it) and this one (his measured rates on the band and line) disagree on 6 of the 25 heads-up fixtures after #11684 (down from 10; #11684 fixed chronological check-streets, initial pot recovery, raise price, proportional Air bluffs, multi-street continuation share, and `< 50%` equity river bluff prevention, promoting `turn-qq-overpair-calls`, `turn-at-folds-top-pair`, `river-tt-hero-call`, and `river-a7-dead-call` to GREEN); each remaining disagreement is pinned in the law at the priced action:

- river A7 two pair facing a river bet (audit raise; priced call: against the range that bet the river on 7c9s5s5dAh the equity of the part that would call a raise is below one half);
- turn KQ top pair facing his raise (audit raise; priced call: against a raising range);
- river 66 (audit raise; priced call, the off line folds);
- river KQ check-back in position (audit bet; priced check: his turn raise leaves a range KQ trails);
- two turn dead-equity calls (A8, 66; audit fold; priced call).

## Limits

- Heads-up only. The audit's two multiway fixtures (Q8 river fold with four live, Q9 three-way river call) are unchanged.
- Re-raises by him and rake are left out of every value alike; the call and the check realize equity with a fixed factor and win no chips on later streets.
- His fold to a raise is his fold to a bet at the raise's price (no fold-to-raise counter exists), capped by the weak part of the range he wagered with.
- The bucket order is a made-strength order; a draw's equity is not ordered inside its bucket.
- The check-back range after a street of checks uses the posterior's soft move, not his measured rates.
- The population cell is the Horses', not people's: against a person with no read the prior is the Horse figure.

## The VPIP floor (task item 5, reported only)

`vpipFloorLimpOnly` (on since 2026-11-18 20:18Z) closes the floor-driven preflop gap in this slice: every Horse NLH cash decision after the switch in Auditor D's slice (375) carried `vpipFloor` 0, so no ten-hand-window table (`vpipFloorLimpOnlyTenHandWindow`, its own option and authority file, the #11401 work) appears in it, and the 11 preflop mistakes after the switch were made with no floor at all (5 loose cold calls, 2 big-blind defends, 2 over-folds and 2 weak calls of re-raises): they come from the brain's own preflop continue bars, not from the floor. Nothing is duplicated here.

## Evaluation

League card declared: `nlh_holdem_value_and_calls_are_priced` (`server/src/benchmark/HorseLeague.ts`; arm A the option on, arm B the brain).

Measured 2026-11-21 on `origin/main` (`f90aa478ae35`, post-#11684), `EQUITY_GOVERNOR=off`, `moodClock: 'deal_seed'`, arm A = live 66-row production switch snapshot (`prod-switch-20261121T2000Z.json`, `0` sanitized) plus `holdemValueAndCallsArePriced: true`, arm B = live 66-row production switch snapshot (`holdemValueAndCallsArePriced` off), 3 seeds (`20261121`, `20261122`, `20261123`) x 3,000 pairs (18,000 hands per field, 54,000 hands total; `0` illegal, `0` truncated, `0` refusals, `0` mismatches on every seed):

- **9-max NLH cash 100bb vs `HUMAN_CALIBRATED_POPULATION_ID`** (`hybridBaseline: true`):
  - `20261121`: `+11.39 +/- 10.59 bb/100` (`blockSE 12.13`, `z = +1.08`, `div = 84`, `0/0/0/0`)
  - `20261122`: `+26.85 +/- 11.31 bb/100` (`blockSE 10.16`, `z = +2.37`, `div = 76`, `0/0/0/0`)
  - `20261123`: `+28.96 +/- 8.87 bb/100` (`blockSE 8.37`, `z = +3.26`, `div = 82`, `0/0/0/0`)
  - **Pooled**: **`+22.40 +/- 5.95 bb/100`** (`z = +3.76`, SIGNIFICANT, `div = 242`, `0/0/0/0`)
- **6-max NLH cash 100bb vs `HUMAN_CALIBRATED_POPULATION_ID`** (`hybridBaseline: true`):
  - `20261121`: `+17.59 +/- 15.00 bb/100` (`blockSE 14.10`, `z = +1.17`, `div = 148`, `0/0/0/0`)
  - `20261122`: `-0.35 +/- 13.52 bb/100` (`blockSE 14.73`, `z = -0.03`, `div = 139`, `0/0/0/0`)
  - `20261123`: `+14.02 +/- 15.27 bb/100` (`blockSE 13.65`, `z = +0.92`, `div = 142`, `0/0/0/0`)
  - **Pooled**: **`+10.42 +/- 8.44 bb/100`** (`z = +1.23`, unresolved, `div = 429`, `0/0/0/0`)
- **6-max NLH cash 100bb Mirror** (`productionStyles: true`):
  - `20261121`: `+1.94 +/- 4.48 bb/100` (`blockSE 3.47`, `z = +0.43`, `div = 502`, `0/0/0/0`)
  - `20261122`: `-8.36 +/- 4.40 bb/100` (`blockSE 5.46`, `z = -1.90`, `div = 486`, `0/0/0/0`)
  - `20261123`: `-4.88 +/- 4.90 bb/100` (`blockSE 5.87`, `z = -1.00`, `div = 523`, `0/0/0/0`)
  - **Pooled**: **`-3.77 +/- 2.65 bb/100`** (`z = -1.42`, unresolved, `div = 1,511`, `0/0/0/0`)

Hosted solver-hydrated Tier 1 league confirmation (`horse-league-card-hydrated.yml`, 2026-11-22, hydrated solver stores `charts=240`, `postflop=7,747`, `postflopV31=0`, `EQUITY_GOVERNOR=off`; archive `HYDRATED-TIER1-RESULTS-20261122.md`, 3 seeds x 6,000 pairs = 36,000 hands per card, `0/0/0/0` safety on every seed):

- **9-max NLH cash vs `HUMAN_CALIBRATED_POPULATION_ID`** (`human_nlh9_holdem_value_and_calls_are_priced`, Run `45012974150`, `2026-11-22T10:32:56Z` to `10:36:14Z`, engine `ec21275d2efe8739015e8c43d2c222ff0e621556`, arm A `{"holdemValueAndCallsArePriced":true,"opponentPopulation":"human-calibrated-v1-20261008"}` vs arm B `{"opponentPopulation":"human-calibrated-v1-20261008"}`):
  - `20261121`: A `+105.69`, B `+93.56`, A - B `+12.13 +/- 7.99 bb/100` (`blockSE 8.94`, `z = +1.52`, not resolved, `154` div, `48.7 s`, `0/0/0/0`)
  - `20261122`: A `+153.66`, B `+128.13`, A - B `+25.53 +/- 7.78 bb/100` (`blockSE 7.15`, `z = +3.28`, SIGNIFICANT, `157` div, `47.4 s`, `0/0/0/0`)
  - `20261123`: A `+256.92`, B `+245.12`, A - B `+11.80 +/- 8.00 bb/100` (`blockSE 9.86`, `z = +1.48`, not resolved, `175` div, `45.8 s`, `0/0/0/0`)
  - **Pooled (`18,000` pairs / `36,000` hands):** A `+172.09`, B `+155.60`, **A - B `+16.49 +/- 4.57 bb/100`** (`z = +3.60`, SIGNIFICANT, 3/3 positive seeds, `486` divergent pairs, `0/0/0/0`)
- **6-max NLH cash vs `HUMAN_CALIBRATED_POPULATION_ID`** (`human_nlh_holdem_value_and_calls_are_priced`, Run `45013620799`, `2026-11-22T10:40:58Z` to `10:43:44Z`, engine `ec21275d2efe8739015e8c43d2c222ff0e621556`, arm A `{"holdemValueAndCallsArePriced":true,"opponentPopulation":"human-calibrated-v1-20261008"}` vs arm B `{"opponentPopulation":"human-calibrated-v1-20261008"}`):
  - `20261121`: A `+114.59`, B `+99.18`, A - B `+15.41 +/- 10.99 bb/100` (`blockSE 12.76`, `z = +1.40`, not resolved, `322` div, `42.8 s`, `0/0/0/0`)
  - `20261122`: A `+119.16`, B `+101.72`, A - B `+17.44 +/- 10.26 bb/100` (`blockSE 8.30`, `z = +1.70`, not resolved, `297` div, `38.7 s`, `0/0/0/0`)
  - `20261123`: A `+145.26`, B `+110.88`, A - B `+34.38 +/- 10.94 bb/100` (`blockSE 10.39`, `z = +3.14`, SIGNIFICANT, `297` div, `36.8 s`, `0/0/0/0`)
  - **Pooled (`18,000` pairs / `36,000` hands):** A `+126.34`, B `+103.93`, **A - B `+22.41 +/- 6.20 bb/100`** (`z = +3.62`, SIGNIFICANT, 3/3 positive seeds, `916` divergent pairs, `0/0/0/0`)
- **6-max NLH cash Mirror** (`nlh_holdem_value_and_calls_are_priced`, Run `44997647905`, `2026-11-22T07:18:44Z` to `07:29:46Z`, engine `6336dcf6c90d3c02b38e5cb803ae264bd0b13e0d`, arm A `{"holdemValueAndCallsArePriced":true}` vs arm B `{}`):
  - `20261120`: `-4.04 +/- 3.28 bb/100` (`blockSE 2.96`, `z = -1.23`, not resolved, `1,088` div, `204.5 s`, `0/0/0/0`)
  - `20261121`: `+2.64 +/- 3.40 bb/100` (`blockSE 3.41`, `z = +0.78`, not resolved, `1,048` div, `200.8 s`, `0/0/0/0`)
  - `20261122`: `-2.47 +/- 3.39 bb/100` (`blockSE 3.21`, `z = -0.73`, not resolved, `1,078` div, `197.3 s`, `0/0/0/0`)
  - **Pooled (`18,000` pairs / `36,000` hands):** **`-1.29 +/- 1.94 bb/100`** (`z = -0.66`, not resolved / flat, `3,214` divergent pairs, `0/0/0/0`)

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: fixed 59; newlyWrong 46; changed 151; unchanged 2583; unjudged 44; set HVH48 D NLH cash (memory as of decision); scorer 5302af2ab3e; source placed verdict-only; arm hvc vs off; replayed 2734 of 3891

Post-#11739 (`27dc68ab40b8`, M1/M2 matched-stack wager pricing + `opp.stack <= 0` all-in call guard, 2026-11-22) AsOf-memory replay on `HVH48-D` (`2,734` of `3,891` audited decisions, `0/0/0/0` safety; see real-card true-EV grade below).

Historical pre-#11739 (`d647047b0aa1`, post-#11556, post-#11622, post-#11684, opponent memory OFF `mind: false`, 2026-11-21) run record (superseded by post-#11739 AsOf-memory row above): `fixed 55; newlyWrong 36; changed 216; unchanged 2518; unjudged 123; set HVH48-D Hold'em cash vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 2734 of 3891` (base arm `off` = `66`-row snapshot `prod-switch-20261121T2000Z.json`, `0` sanitized, `0` refused, seeds `1,7,42`, `0` arm errors; scratch files with hole cards deleted after scoring).

- Unedited scorer line (`HVH48-D`): `placed (verdict-only; 3891 audited decisions, 372 judged bad; joined by node: 2734 replayed, 1157 not replayed, base reproduces the recorded action on 2214): arm on changed 216 (75 more aggressive, 141 more passive), resized 144, illegal 0, refused 0, errors 0; fixed 55, newly wrong 36, still wrong 2, ok to ok 0, unjudged 123; judged bad left unchanged 169; no bb (the audit declares no EV model); per receipt: holdem_priced_bet 60 changed / 31 fixed / 17 newly wrong; holdem_priced_call 35 changed / 3 fixed / 5 newly wrong; holdem_priced_changed 192 changed / 55 fixed / 35 newly wrong; holdem_priced_check 22 changed / 5 fixed / 3 newly wrong; holdem_priced_fold 89 changed / 9 fixed / 9 newly wrong; holdem_priced_raise 10 changed / 7 fixed / 2 newly wrong; holdem_priced_value_raise_deferred 32 changed / 3 fixed / 3 newly wrong; holdem_river_full_house_lead_priced 1 changed / 0 fixed / 1 newly wrong; holdem_river_full_house_lead_seen 1 changed / 0 fixed / 1 newly wrong; hu_cash_matched_commitment 62 changed / 8 fixed / 6 newly wrong; hu_cash_matched_commitment_covered 65 changed / 10 fixed / 7 newly wrong; hu_cash_matched_commitment_wager 9 changed / 0 fixed / 3 newly wrong.`
- `HVH48-E` tournaments (`10937` audited decisions, `5356` replayed in `1478` hands, `0` arm errors): arm `on` differed from base `off` on `0` of `5356` rows (100% inert; confirms cash-only scope; refused by the scorer without `--allow-unchanged`, so no run row is recorded).
- Breakdown (`HVH48-D`, post-#11684): all `216` changes are postflop (`flop 87`, `turn 62`, `river 67`; `75` more aggressive, `141` more passive, `144` resized). Most frequent live person (present at `11` changed decisions) removed: `205` changed, `52` fixed, `33` newly wrong, `2` still wrong, `118` unjudged (`1.58:1`).
- Exact `newlyWrong` (`36`) breakdown by receipt and transition:
  - `holdem_priced_bet` (`31` fixed / `17` newly wrong): `13` `check->bet` (`5` flop, `5` turn, `3` river; `6` are OOP Nutted leads into the PFR or flop bettor where the audit's verdict column is `OK` despite positive `loss_bb`, and `5` are OOP TopPair/WeakPair bets with `eqAll >= 0.50` and `eqCall < 0.50` where gating `eqCall > 0.50` removes more fixed decisions (`9`) than newly wrong (`5`)), plus `2` river `bet->all_in`, `1` turn `all_in->bet`, and `1` turn `check->all_in` (where `bet` and `all_in` are scored as distinct action kinds).
  - `holdem_priced_fold` (`9` fixed / `9` newly wrong): `5` river `call->fold` (where `4` of `5` newly wrong and all `5` fixed sit at exact `0.000` EV indifference under `beta = s / (pot + 2s)` and fold by passive tie-break; changing the tie-break keeps the same ratio and regresses the promoted `river-tt-hero-call` and `river-a7-dead-call` GREEN fixtures), plus `2` flop and `2` turn `call->fold` at thin `-0.006` to `-0.044` pot EV margins interleaved with `4` fixed folds at `-0.027` to `-0.056` pot.
  - `holdem_priced_call` (`3` fixed / `5` newly wrong): `2` flop `all_in->call` (one with villain already all-in, `villainStack = 0`), `2` flop `raise->call` (one with villain already all-in where `holdem_priced_value_raise_deferred` fired despite `villainStack = 0`), and `1` flop `fold->call`.
  - `holdem_priced_check` (`5` fixed / `3` newly wrong): `3` OOP river `bet->check` thin-value vs check disagreements.
  - `holdem_priced_raise` (`7` fixed / `2` newly wrong): `2` turn `raise->all_in` where Hero covered Villain (`villainStack < heroStack`) and `wagerValue` passed unmatched `add` instead of `matched` to `holdemPricedFold` while `holdemPricedWagerTargets` emitted targets above Villain's effective stack.
- Root-cause diagnosis of the remaining gap: two genuine smaller defects (matched-stack `matched` vs `add` + effective all-in cap in `wagerValue`/`holdemPricedWagerTargets`, and guarding `opp.stack <= 0` when Villain is already all-in) account for `4` of the `36` newly wrong decisions (cleanly eliminating `holdem_priced_raise` `7/2 -> 7/0` and reducing `holdem_priced_call` `3/5 -> 3/3`), improving HVH48-D from `55/36` (`1.53:1`) to `~55/32-33` (`~1.67-1.72:1`) while passing all 47 law tests. No remaining general poker/EV math bug accounts for the rest of the gap to `2.0:1`: the remaining `~32` newly wrong decisions are structural model-vs-audit disagreements and verdict-only action-kind splits (`bet` vs `all_in`, `OK` slowplays OOP, and exact-indifference river bluff-catchers). Engine code is therefore left untouched in this docs update.
- Against the REPLAY-6 declared bar (`agent-evidence/extreme-archive/horse-decisions-01UxDLnM/replay6/DECLARATION.md`, sha256 `1ed85e274dd4b6fdff42c7f7b551b224c94290c770424cc2bbdc64f8e1383fbf`: at least 20 changed, `fixed >= 2 x newlyWrong` and `>= 8`, 0 illegal/refused, base fidelity >= 70%, same ratio with most frequent opponent removed): **FAIL (`fixed 55 < 2 x 36 = 72`; most-frequent-opponent removed `52 < 2 x 33 = 66`)**, though it passes the build floor (`newlyWrong 36 <= fixed 55`) and shows a significant `+22.40 +/- 5.95 bb/100` (`z = +3.76`) win in 9-max human-calibrated cash play.
- Superseded runs:
  - Pre-#11684, post-#11556 (2026-11-21 on `09986930d3db`, scorer `5302af2ab3e`, base fidelity `2214` / `81.0%`): `fixed 47; newlyWrong 44; changed 188; unchanged 2546; unjudged 96` (most frequent opponent removed: `179` changed, `44` fixed, `41` newly wrong). #11684 lifted `fixed/newlyWrong` from `47/44` (`1.07:1`) to `55/36` (`1.53:1`), cutting `holdem_priced_call` newly wrong from `19` to `5`.
  - Pre-#11556 (2026-11-20, REPLAY-6 on `95dae3848e5`, scorer `c4ab864f30f`, forced blinds/antes still in replayed `actionHistory`, base fidelity `2139` / `78.2%`): `fixed 49; newlyWrong 43; changed 192; unchanged 2542; unjudged 100` (most frequent opponent removed: `183` changed, `46` fixed, `40` newly wrong).
- Limits: opponent memory is off (`mind: false`); the base arm uses the archived `2026-11-21T20:00Z` switch snapshot (database not read); the audit is verdict-only (no bb), and a change of a decision the audit priced `OK` is counted newly wrong whether or not the audit would also accept the new action. The file's own section "Disagreements with the audit" applies to the newly wrong count: the audit is the judge of this row, not the option.

## Post-#11739 (`27dc68ab40b8`, M1/M2 Root-Cause Fix) Verification (2026-11-22)

PR `#11739` (`27dc68ab40b870743ecdfed7f4390093a72c1e4e`, riding the 10:00 AM CST cutover build `3f0a9967d5f4`) landed the matched-stack wager pricing (`matched` vs `add` and effective all-in cap in `wagerValue` / `holdemPricedWagerTargets`) and `opp.stack <= 0` all-in call guard diagnosed above.

### Real-Card True-EV Grade (HVH48-D, AsOf Memory)

Graded across `284/284` changed/resized decisions (`0/0/0/0` safety; every cohort satisfies `mean - SE > 0`):

- `people` (`n=65`): `+2.301 +/- 1.516 bb/decision` (`+149.54 bb`, `mean - SE = +0.784 bb`)
- `people-excl-top` (`n=50`): `+2.800 +/- 1.640 bb/decision` (`+139.99 bb`, `mean - SE = +1.160 bb`)
- `horse_only` (`n=219`): `+2.096 +/- 1.760 bb/decision` (`+459.08 bb`, `mean - SE = +0.337 bb`)
- **Combined:** `+608.62 bb` across `284` changed/resized decisions.

### Post-#11739 Hosted Solver-Hydrated League Confirmation (`charts=240`, `postflop=7,747`, `postflopV31=0`, `0/0/0/0`, `0/6` seed regressions)

- **6-max human-calibrated** (`human_nlh_holdem_value_and_calls_are_priced`, Run `45027743589` @ `27dc68ab40b8`, `2026-11-22T13:29:27Z` to `13:32:40Z`): **`+22.59 +/- 6.19 bb/100` (`z = +3.65`, SIGNIFICANT, 3/3 positive seeds, `916` div, `+0.18 bb/100` vs pre-#11739 `+22.41`)** -- per-seed `20261121` `+15.41 +/- 10.99`, `20261122` `+17.44 +/- 10.26`, `20261123` `+34.91 +/- 10.92` (`z = +3.20`).
- **9-max human-calibrated** (`human_nlh9_holdem_value_and_calls_are_priced`, Run `45027142185` @ `27dc68ab40b8`, `2026-11-22T13:22:26Z` to `13:26:38Z`): **`+16.82 +/- 4.58 bb/100` (`z = +3.67`, SIGNIFICANT, 3/3 positive seeds, `485` div, `+0.33 bb/100` vs pre-#11739 `+16.49`)** -- per-seed `20261121` `+12.13 +/- 7.99`, `20261122` `+26.06 +/- 7.83` (`z = +3.33`), `20261123` `+12.27 +/- 7.98`.
- **9-max mirror** (`nlh9_holdem_value_and_calls_are_priced`, Run `45013779484` @ `ec21275d2efe`, `2026-11-22T10:43:00Z` to `11:05:54Z`): **`-1.90 +/- 1.34 bb/100` (`z = -1.41`, flat, `3,021` div, `0/0/0/0`)** -- per-seed `20261121` `-1.95 +/- 2.46`, `20261122` `-0.14 +/- 2.22`, `20261123` `-3.60 +/- 2.29`.

Source default stays OFF; production is LIVE ON through the switch row since `audit #185` (see the State line at the top).

## Rollback

LIVE ON (`audit #185`, `evidence #76`, `2026-11-22T23:25:25Z` on serving `88b8dac0ebdc`). To roll back immediately, set it `off` via the `horse-option-switch` CLI (`fn_ca_horse_option_switch_set('holdemValueAndCallsArePriced', 'off', '<actor>', '<reason>')`), restoring the base brain within ~30s with zero data migration needed.
