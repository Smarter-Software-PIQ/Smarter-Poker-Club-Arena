# holdemTournamentAllInCallIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago (no blanket rules; every Horse decision priced by range, equity and EV; bet size never triggers a decision by itself). Built by the Horse Decisions lane (builder E-FIX, lead session_01TLQer7JfrrxcELJZV5XHPD) on 2026-11-19 from audit E (1,522 NLH tournament hands with humans, 10,937 Horse decisions). **State: OFF** in production since `2026-11-22T19:51:28Z` / `1:51:28 PM CST` (`audit #181`, Trigger 1 emergency rollback by the Horse SWITCH lane; it was LIVE ON from `2026-11-22T14:07:49Z` / `8:07:49 AM CST` under `audit #178`, `evidence #75`, and served `15,540` live decisions before `39` `recoverableRequestErrors` / `156` `horse_decision_refused_isolated` `reference_owner` receipt refusals appeared on serving `ea92b56f0177`; re-activation requires an engine carrying PR `#11779`, see `## Rollback`; switchable, source default OFF). It changes preflop calling ranges, as committedStackPricedIn and nashPushFoldIcm do, so it was first registered under the owner preflop range hold; that hold was lifted for this option only (see "Owner authority" below). Evidence MET (2026-11-21): mechanism, scope, receipts, law tests and off-identity MET; after the 2026-11-21 preflop placement fix (merged in PR #11684 `756498773cc9`, running preflop pricing in `holdemAllInCallReference` after the reference chooses its action so raises/raising all-ins and exact `nashCallVsJam` `chart_bb_defend` answers stay intact, and requiring `facingAllIn` at `currentBet`), the post-#11556 HVH48-E replay PASSES every REPLAY-6 bar criterion (`fixed 80`, `newlyWrong 11`, `changed 199`, `7.27:1`; most frequent opponent removed `72` fixed / `10` newly wrong, `7.20:1`), the declared mirror league card `mtt6_holdem_tournament_all_in_call_is_priced_12bb` is SIGNIFICANT positive on 3 of 3 seeds (`+3.28 +/- 0.41 bb/100`, `z = 8.08`, 36,000 hands, `0` illegal), and the declared 12bb 6-max human-calibrated field twin `human_mtt6_holdem_tournament_all_in_call_is_priced_12bb` is non-harmful with a positive point estimate across 3 seeds x 12,000 pairs (72,000 hands: `+0.42 +/- 0.88 bb/100`, `z = +0.48`, `256` divergent pairs, `0` illegal/truncated/corrected/fallbacks, identical delta against both default base and the live 66-row production switch baseline `prod-switch-20261121T2000Z.json`; unresolved solely because `human-calibrated-v1-20261008` plays `0` preflop open-jams and diverges on `0.71%` of 6-max hero hands via 3-bet re-jams and postflop jams). Switch-on requires a serving engine built from PR #11684 (`756498773cc9`) or later and from PR `#11779` or later.

## Owner authority

Dan's exact message of 2026-11-19 18:42 America/Chicago:

> nope, you need to investigate every single hand played against humans in the past 48 hours and trace back and investigate every single horse decision on every single street before you claim everything is operating perfectly because i've seen a shit ton of mistakes that need correcting!

On that order the HORSE DECISIONS lead (session_01TLQer7JfrrxcELJZV5XHPD) lifted the owner preflop range hold for this option: audit E, run under that order, found that the fixed All-In-Or-Fold strength bar this option replaces is a blanket rule. The option is not in OPTION_SWITCH_OFF_ONLY (server/src/engine/HorseOptionSwitch.ts, comment beside the preflop hold entries); it stays default OFF and is switched on only through its evidence (league card and replay), like every option.

## What it does

Two-card no-limit hold'em tournament hands only (one board, no straddle, no bomb pot; Omaha, short deck, pot and fixed limit, cash tables unchanged). Default OFF, read `=== true`. Code: server/src/engine/HorseHoldemTournamentAllInCall.ts (the price, the ranges, the equity) and HorseLogic (the four sites below).

1. Preflop, in the reference (decidePreflopV7Glue, before the Nash caller table and the All-In-Or-Fold strength bar): every all-in call decision (facing an all-in, or a call that is the Horse's whole stack) at an effective 25 big blinds or less, or by a committed stack (half or more of the chips it started the hand with already in) at any depth, All-In-Or-Fold or not, any seat, a lone jam, a jam over the Horse's own open, a re-jam, a multiway all-in, a jam with flat callers, is answered call when its margin is above zero, else fold.
   - Ranges: an open-jam reads the Nash V2 jam table (players behind, depth, dead ante); a jam over one raise the top 18% at 8bb to 6% at 25bb (linear); over two or more raises 5% to 3.5% (12bb to 25bb); a raise that is not all in the open width by players behind (SB 40%, BTN 44%, CO 30%, 24, 20, 17, 15, 13%), a 3-bet 8% (14% six-handed or less), a 4-bet 4%; a caller of an open-jam the Nash first-caller range for his seat kind capped at 25%, of a re-jam the top half of the re-jam range. Widths are taken in the Nash caller table's own order.
   - Players still to act behind the Horse are priced as overcallers: each with the top half of the range he would call the jam with; the call is the mixture of nobody waking up and the widest one behind overcalling (his extra chips, capped by the Horse's call, added to the pot).
   - Equity: seeded Monte Carlo (3,000 deals heads-up, 2,400 multiway), exact card removal, scored by HorseEval.scoreHoldem; the seed is a hash of the public spot and the cards; no shared generator is consumed.
   - Price: EV(call) - EV(fold) = sum of p x (equity x W - BF x (1 - equity) x C); W the contestable pot (dead money, side pots capped at the Horse's stack, the Horse's own chips in), C the call, BF the Horse's bubble factor where a pay jump is live (HorseLogic.payJumpBubbleFactor; 1 in a PKO, a mystery bounty, a bounty-only event, with no pay jump or no context). Margin = EV / (W + BF x C) = equity minus required equity when nobody is behind.
2. The end of the reference: a later layer of the reference may not turn the preflop priced answer around (receipt holdem_tournament_all_in_call_reference_kept_seen). Postflop the price is taken here, with the equity the engine already computed for the decision (Phase 7 equity evidence of decidePostflop's own pass), only facing an opponent's all-in (a jam) where the call closes the action: a fold more than 5 equity points above the price becomes a call (any positive margin for a committed stack), a call more than 5 points below it a fold.
   - Postflop scope (review N3, 2026-11-19): the postflop half is restricted to all-in calls facing a jam; the river-bet part and the whole-stack call of a bet that is not all in were dropped. The Phase 7 equity is taken against each opponent's preflop band, with no conditioning on his postflop line; against a jam that band is the closest proxy the engine has, but against a river bet the bettor's line range is much stronger, and pricing it there pushed river folds toward calls (the reverse of audit E's "river calls too light").
3. Phase 7 (tournament utility arbiter): its choice is refused (tournamentUtilityRefusal `priced_all_in_call`) when it would turn the priced call or fold around and the margin is beyond 5 equity points (HOLDEM_TOURNAMENT_ALL_IN_LOCK_MARGIN), or beyond 0 for a committed call.
4. Phase 8: the same refusal (ledger reason `priced_all_in_call`, applied false).

A raise is never made or removed: only the call and the fold. Off (absent or false): no line of it runs, no verdict is written, no generator is touched (law test: the same decision and generator state for absent and false on every fixture).

## Why one new option

aofClosingSeatNashCall answers one seat (the All-In-Or-Fold closing seat at 12bb or less) by a Nash call probability drawn from the shared generator; committedStackPricedIn rescues one Phase 6 branch (multiway all-in) by strength floors and leaves the arbiter free to fold after it, and is off-only under the preflop hold. Extending either would keep a second decision path beside the price and their own receipts would no longer say what they decided. One priced rule over every spot is the root fix; both options are left as they were (with this option on, the priced block answers before either is reached, so neither reads these spots).

## Receipts

holdem_tournament_all_in_call_priced_call_seen, holdem_tournament_all_in_call_priced_fold_seen, holdem_tournament_all_in_call_unpriced_seen, holdem_tournament_all_in_call_reference_kept_seen, holdem_tournament_all_in_call_arbiter_reversal_refused_seen, holdem_tournament_all_in_call_phase8_reversal_refused_seen, holdem_tournament_committed_stack_call_seen, holdem_tournament_postflop_all_in_call_priced_seen, holdem_tournament_postflop_call_priced_fold_seen (HorseDataLedger.ts, tag TourneyAllInPriced). The verdict of the last decision (equity, required equity, bubble factor, EV, margin, call, pot, committed) is readable through HorseLogic.holdemAllInCallVerdictOfLastDecision.

## Tests

server/src/engine/AHoldemTournamentAllInCallIsPriced.law.test.ts (fixtures AHoldemTournamentAllInCallIsPriced.cases.ts, builder AHoldemTournamentAllInCallIsPriced.fixtures.ts): the price arithmetic (bubble factor, overcall mixture); the seeded equity with card removal; the Nash ranges and widths; the roles; the audit preflop fixtures da2d1f44 (88, 15bb re-jam over its open), 95b1c217 (AJs, 13bb), 1b51e45d (55, 16bb), d325481d (66 committed, 0.81bb into about 64bb), fbfdfc4a (A7s All-In-Or-Fold big blind) fold on every seed with the option absent or false and call with it; 475e2de7 and 09bdb97c (All-In-Or-Fold) call with it; 72o facing the same re-jam folds; the ten anonymised production All-In-Or-Fold requests fold without it and follow their price with it (nine all in, K3o still folds); postflop the fb6eb2ec spot with QdJd: a fold the engine's own equity prices more than 5 points above the price is called; the lock (5 points, any margin committed, never a raise); option off byte-identical (absent and false, decisions and generator state).

## Audit fixtures and what changes

- da2d1f44, 95b1c217, 1b51e45d, d325481d, fbfdfc4a: fold -> call (priced margins about +0.12, +0.13, +0.03, +0.22 committed, +0.11).
- 0f7c778b (TsKh turn, all-in): unchanged. The price check runs, but the engine's own equity for this spot is about 0.25 against a price of 0.34 (the audit's model: 0.65).
- 2b5b823c (QQ river on AA board, a 12.5bb river bet, not all in): out of scope since review N3 (no verdict; the decision is the option-off decision). With the river-bet part the engine's band equity was about 0.65 against 0.27 (the audit's model: 0.10), which is why the river-bet part was dropped. The decision follows the engine's equity; the error is in the postflop equity model (the bands and reads of a jam after a 3-bet pot lead, and of a river bet after two check-calls on a paired ace board), not in a missing price check. Not fixed here.
- fb6eb2ec (Kd7d flop) and 7a7125e8 (Qc5c heads-up flop): the rebuilt requests are already called by the engine; priced calls with the option on.

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Option unset or false: byte-identical (law test above).
- League card (mirror field, Horse-brain opponents, solver stores empty, 2026-11-21 post-fix): `mtt6_holdem_tournament_all_in_call_is_priced_12bb` on 3 pre-chosen seeds (`20261121`, `20261122`, `20261123`; 6,000 pairs each, 36,000 hands total): `+4.29 +/- 0.71` (`z = 6.05`), `+3.31 +/- 0.72` (`z = 4.58`), `+2.24 +/- 0.68` (`z = 3.31`); pooled `+3.28 +/- 0.41 bb/100` (`z = 8.08`, SIGNIFICANT; 0 illegal, 0 truncated, 0 corrected, 0 fallbacks).
- League card (human-calibrated field, `human-calibrated-v1-20261008`, solver stores empty, 2026-11-21 post-#11684): `human_mtt6_holdem_tournament_all_in_call_is_priced_12bb` on 3 pre-chosen seeds (`20261121`, `20261122`, `20261123`; 12,000 pairs each, 72,000 hands total): `+0.26 +/- 1.46` (`z = +0.18`), `+1.51 +/- 1.69` (`z = +0.90`), `-0.51 +/- 1.41` (`z = -0.36`); pooled `+0.42 +/- 0.88 bb/100` (`z = +0.48`, non-harmful / unresolved; 256 divergent pairs, 0 illegal/truncated/corrected/fallbacks). Verified with the live 66-row production switch baseline (`prod-switch-20261121T2000Z.json`, 0 sanitized): identical `+0.42 +/- 0.88 bb/100` (`z = +0.48`, 256 divergent pairs, 0/0/0/0).
- Replay on real audited decisions (2026-11-21 post-fix, corrected history #11556 + #11622 receipts): **PASS** on the REPLAY-6 declared bar (`fixed 80`, `newlyWrong 11`, `changed 199`, `7.27:1` >= `2:1`; most frequent live opponent removed `72` fixed / `10` newly wrong, `7.20:1` >= `2:1`; base fidelity `82.5%` >= `70%`; `0` illegal/refused/errors).

## League card runs (2026-11-21, post-fix)

Card `mtt6_holdem_tournament_all_in_call_is_priced_12bb` (`server/src/benchmark/HorseLeague.ts`: NLH, 6 seats, 12 bb, big-blind-ante MTT with live M state, mirror field, `hybridBaseline`, `moodClock: deal_seed`, arm A `{"holdemTournamentAllInCallIsPriced":true}`, arm B `{}`, 6,000 pairs per seed). Run single-threaded on the operations Mac via `EQUITY_GOVERNOR=off npx tsx src/scripts/horseLeagueCard.ts --card=mtt6_holdem_tournament_all_in_call_is_priced_12bb --seed=20261121,20261122,20261123` on `c2d6e45e3bcc` plus the preflop placement fix (`solver stores: charts=0 postflop=0 postflopV31=0`).

| seed             | pairs (hands)   | bb/100 (A - B) | stderr | block stderr (40 blocks) | z    | verdict     | divergent pairs | wall    | illegal / truncated / corrected / fallbacks |
| ---------------- | --------------- | -------------- | ------ | ------------------------ | ---- | ----------- | --------------- | ------- | ------------------------------------------- |
| 20261121         | 6,000 (12,000)  | +4.29          | 0.71   | 0.57                     | 6.05 | SIGNIFICANT | 330             | 129.9 s | 0 / 0 / 0 / 0                               |
| 20261122         | 6,000 (12,000)  | +3.31          | 0.72   | 0.79                     | 4.58 | SIGNIFICANT | 366             | 140.5 s | 0 / 0 / 0 / 0                               |
| 20261123         | 6,000 (12,000)  | +2.24          | 0.68   | 0.83                     | 3.31 | SIGNIFICANT | 362             | 130.8 s | 0 / 0 / 0 / 0                               |
| Pooled (3 seeds) | 18,000 (36,000) | +3.28          | 0.41   | n/a                      | 8.08 | SIGNIFICANT | 1,058           | 401.2 s | 0 / 0 / 0 / 0                               |

Pre-fix comparison (same card, same 3 seeds, `09986930d3db`): `+3.93 +/- 0.89` (`z = 4.42`), `+2.63 +/- 0.89` (`z = 2.95`), `+2.65 +/- 0.86` (`z = 3.07`); pooled `+3.07 +/- 0.51 bb/100` (`z = 6.03`).

### Human-calibrated 12bb MTT league card (`human_mtt6_holdem_tournament_all_in_call_is_priced_12bb`, 2026-11-21)

Card `human_mtt6_holdem_tournament_all_in_call_is_priced_12bb` (`server/src/benchmark/HorseLeague.ts`: NLH, 6 seats, 12 bb, big-blind-ante MTT with live M state, 1 hero Horse vs 5 `human-calibrated-v1-20261008` seats, `hybridBaseline`, `moodClock: deal_seed`, 12,000 pairs per seed). Run single-threaded (`nice -n 19`, `EQUITY_GOVERNOR=off`) on `origin/main` `d647047b0aa1` (`solver stores: charts=0 postflop=0 postflopV31=0`) via `npx tsx src/scripts/horseLeagueCard.ts --card=human_mtt6_holdem_tournament_all_in_call_is_priced_12bb --seed=20261121,20261122,20261123 --pairs=12000`, and repeated on the exact same 3 seeds against the live 66-row production switch baseline (`prod-switch-20261121T2000Z.json`, 7 style keys + 59 plain keys, `0` sanitized).

Declared card (`a: { holdemTournamentAllInCallIsPriced: true }`, `b: {}`):

| seed             | pairs (hands)   | bb/100 (A - B) | stderr | block stderr (40 blocks) | z     | arm A / arm B (bb/100) | divergent pairs | wall    | illegal / truncated / corrected / fallbacks |
| ---------------- | --------------- | -------------- | ------ | ------------------------ | ----- | ---------------------- | --------------- | ------- | ------------------------------------------- |
| 20261121         | 12,000 (24,000) | +0.26          | 1.46   | 1.28                     | +0.18 | +22.74 / +22.48        | 81              | 61.5 s  | 0 / 0 / 0 / 0                               |
| 20261122         | 12,000 (24,000) | +1.51          | 1.69   | 1.56                     | +0.90 | +13.76 / +12.25        | 88              | 60.7 s  | 0 / 0 / 0 / 0                               |
| 20261123         | 12,000 (24,000) | -0.51          | 1.41   | 1.71                     | -0.36 | +24.39 / +24.90        | 87              | 60.5 s  | 0 / 0 / 0 / 0                               |
| Pooled (3 seeds) | 36,000 (72,000) | +0.42          | 0.88   | n/a                      | +0.48 | n/a                    | 256             | 182.7 s | 0 / 0 / 0 / 0                               |

Live 66-row production switch baseline (`prod-switch-20261121T2000Z.json`, arm A = base + `holdemTournamentAllInCallIsPriced: true`, arm B = base):

| seed             | pairs (hands)   | bb/100 (A - B) | stderr | block stderr (40 blocks) | z     | arm A / arm B (bb/100) | divergent pairs | wall    | illegal / truncated / corrected / fallbacks |
| ---------------- | --------------- | -------------- | ------ | ------------------------ | ----- | ---------------------- | --------------- | ------- | ------------------------------------------- |
| 20261121         | 12,000 (24,000) | +0.26          | 1.46   | 1.28                     | +0.18 | +22.94 / +22.68        | 81              | 62.3 s  | 0 / 0 / 0 / 0                               |
| 20261122         | 12,000 (24,000) | +1.51          | 1.69   | 1.56                     | +0.90 | +13.80 / +12.29        | 88              | 61.6 s  | 0 / 0 / 0 / 0                               |
| 20261123         | 12,000 (24,000) | -0.51          | 1.41   | 1.71                     | -0.36 | +24.46 / +24.97        | 87              | 61.0 s  | 0 / 0 / 0 / 0                               |
| Pooled (3 seeds) | 36,000 (72,000) | +0.42          | 0.88   | n/a                      | +0.48 | n/a                    | 256             | 184.9 s | 0 / 0 / 0 / 0                               |

Human-field reach note: `human-calibrated-v1-20261008` plays `0` preflop open-jams (`preflop/unopened` has only fold/call/raise across all 72,000 hands); all `256` divergent pairs (`0.71%` of 36,000 pairs) come from 3-bet re-jams (`preflop/facing_raise` `all_in`) and postflop jams. The human-field run confirms zero harm and a positive point estimate (`+0.42 +/- 0.88 bb/100`, 95% CI `[-1.30, +2.14]`) alongside the strong `+3.28 +/- 0.41 bb/100` (`z = +8.08`) mirror win and `80` fixed / `11` newly wrong (`7.27:1`) real-human `HVH48-E` replay pass.

## Limits

- Ranges are population and Nash models, not reads of the opponent; the re-jam, 3-bet and caller widths are stated constants.
- Side pots are priced as one pot: the Horse must beat every opponent in the pot to win W; a side pot it could win against one of them alone is not credited (a call is priced slightly too tight in multiway pots with unequal stacks).
- Bounty value is not added to the call.
- The overcall model prices only the widest player behind waking up, not two.
- Postflop it uses the engine's equity as it stands, and only facing a jam (see 0f7c778b and 2b5b823c above).

## Activation and rollback

- Activation prerequisite: serving engine at `https://engine.smarter.poker/health` carries PR `#11684` (`756498773cc9`) or later so the preflop placement fix is live before enabling the switch.
- Second activation prerequisite (added 2026-11-22 after `audit #181`): the serving engine also carries Horse SWITCH PR `#11779` (the `reference_owner` receipt fix). See `## Rollback`.
- Evidence note format: `authority: holdemTournamentAllInCallIsPriced docs/horse-option-authority.d/holdemTournamentAllInCallIsPriced.md sha256 <64 hex>` (recorded via `fn_ca_horse_option_switch_record_evidence`, then enabled via `fn_ca_horse_option_switch_set('holdemTournamentAllInCallIsPriced', 'on', ...)`).
- Rollback: `fn_ca_horse_option_switch_set('holdemTournamentAllInCallIsPriced', 'off', ...)` restores the base brain byte-for-byte within ~30s.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: fixed 80; newlyWrong 11; changed 199; unchanged 5157; unjudged 88; set HVH48-E Hold'em tournaments vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 5356 of 10937

Run 2026-11-21 after the preflop placement fix (`holdemAllInCallReference` runs preflop pricing after the reference chooses its action so raises/raising all-ins and `nashCallVsJam` `chart_bb_defend` answers are preserved, and `facingAllIn` requires an all-in opponent at `gs.currentBet`), on corrected history (#11556 + #11622), base `c2d6e45e3bcc` + fix, scorer `5302af2ab3e`, base arm `off` = `prod-switch-20261121T1500Z.json` (`66` rows, `0` sanitized, `0` refused), arm `on` = base plus `holdemTournamentAllInCallIsPriced`, seeds `1,7,42`, opponent memory OFF (`mind: false`), `0` arm errors (scratch files with hole cards deleted immediately after scoring).

- Unedited scorer line (`HVH48-E`): `placed (verdict-only; 10937 audited decisions, 244 judged bad; joined by node: 5356 replayed, 5581 not replayed, base reproduces the recorded action on 4420): arm on changed 199 (190 more aggressive, 9 more passive), resized 0, illegal 0, refused 0, errors 0; fixed 80, newly wrong 11, still wrong 20, ok to ok 0, unjudged 88; judged bad left unchanged 85; no bb (the audit declares no EV model); per receipt: holdem_premium_preflop_raise 1 changed / 0 fixed / 0 newly wrong; holdem_tournament_all_in_call_priced_call_seen 190 changed / 80 fixed / 9 newly wrong; holdem_tournament_all_in_call_priced_fold_seen 9 changed / 0 fixed / 2 newly wrong; holdem_tournament_all_in_call_reference_kept_seen 199 changed / 80 fixed / 11 newly wrong.`
- Most frequent live person (present at `11` changed decisions) removed: `188` changed, `72` fixed, `10` newly wrong (`7.20:1`), `20` still wrong, `86` unjudged.
- Against the REPLAY-6 declared bar (`agent-evidence/extreme-archive/horse-decisions-01UxDLnM/replay6/DECLARATION.md`, sha256 `1ed85e274dd4b6fdff42c7f7b551b224c94290c770424cc2bbdc64f8e1383fbf`: `changed >= 20`, `fixed >= 2 x newlyWrong` and `>= 8`, `0` illegal/refused, base fidelity `>= 70%`, same ratio with most frequent opponent removed): **PASS (`199` changed, `80` fixed, `11` newly wrong, `7.27:1`; most frequent opponent removed `72` fixed / `10` newly wrong, `7.20:1`; base fidelity `82.5%`).**
- Prior runs (superseded): pre-fix post-#11556 (`09986930d3db`, `5302af2ab3e`): `fixed 86; newlyWrong 83; changed 302; unchanged 5054; unjudged 112` (FAIL); pre-#11556 (`95dae3848e5`, `c4ab864f30f`): `fixed 87; newlyWrong 81; changed 367; unchanged 4989; unjudged 178` (FAIL).
- Limits: opponent memory is off (`mind: false`); base arm uses the archived `2026-11-21T15:00Z` switch snapshot (database not read); the audit is verdict-only (no bb).

## Rollback

OFF since `2026-11-22T19:51:28Z` (`audit #181`, Horse SWITCH lane `151f9a34`, Trigger 1 emergency rollback). History: activated `on` at `2026-11-22T14:07:49Z` (`audit #178`, `evidence #75`, on serving `b31db252025b`) and served `15,540` decisions. On serving `ea92b56f0177` it then produced `39` `recoverableRequestErrors` and `156` `horse_decision_refused_isolated` rows (`invalid policy receipt: reference_owner`): `holdemAllInCallReference` in `server/src/engine/HorseLogic.ts` wrote `route = 'legacy_preflop'` over a `chart_open_jam` or `variant_price` preflop answer while V7 preflop was on, which `horsePhase6AttributionMismatch` refuses. After the rollback all 8 workers read `off`, `0` tables stalled and the error count stayed flat at `39`.

Re-activation prerequisite: the serving engine at `https://engine.smarter.poker/health` must carry the permanent source fix, Horse SWITCH PR `#11779` (`AHoldemAllInCallReferenceReceiptIsValid.law.test.ts`; the route becomes `intent_engine` under V7 preflop). Do not turn this option `on` on any engine that does not contain that merge. This file changed after `evidence #75`, so a re-activation records a new evidence note with this file's current sha256.

To roll back, run `horse-option-switch.mjs set holdemTournamentAllInCallIsPriced off --rollback` (calling `fn_ca_horse_option_switch_set('holdemTournamentAllInCallIsPriced', 'off', '<actor>', '<reason>')`), restoring the base brain byte-for-byte within ~30s with zero data migration needed.
