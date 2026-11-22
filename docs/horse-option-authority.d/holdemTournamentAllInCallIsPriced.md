# holdemTournamentAllInCallIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago (no blanket rules; every Horse decision priced by range, equity and EV; bet size never triggers a decision by itself). Built by the Horse Decisions lane (builder E-FIX, lead session_01TLQer7JfrrxcELJZV5XHPD) on 2026-11-19 from audit E (1,522 NLH tournament hands with humans, 10,937 Horse decisions). Switchable, default OFF. It changes preflop calling ranges, as committedStackPricedIn and nashPushFoldIcm do, so it was first registered under the owner preflop range hold; that hold was lifted for this option only (see "Owner authority" below). Evidence NOT MET: the declared mirror league card `mtt6_holdem_tournament_all_in_call_is_priced_12bb` is SIGNIFICANT positive on 3 of 3 seeds (`+3.07 +/- 0.51 bb/100`, `z = 6.03`, mirror field, empty solver stores), but the post-#11556 real-hand audited replay on HVH48-E (`fixed 86`, `newlyWrong 83`, `changed 302`) still fails its declared 2:1 bar (`fixed >= 2 x newlyWrong`) because the fold side adds `44` newly wrong against `2` fixed, and no human-field league card has been run. **Do not switch on until its evidence rows are met.**

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
- League card (mirror field, Horse-brain opponents, solver stores empty, 2026-11-21): `mtt6_holdem_tournament_all_in_call_is_priced_12bb` on 3 pre-chosen seeds (`20261121`, `20261122`, `20261123`; 6,000 pairs each, 36,000 hands total): `+3.93 +/- 0.89` (`z = 4.42`), `+2.63 +/- 0.89` (`z = 2.95`), `+2.65 +/- 0.86` (`z = 3.07`); pooled `+3.07 +/- 0.51 bb/100` (`z = 6.03`, SIGNIFICANT; 0 illegal, 0 truncated, 0 corrected, 0 fallbacks). Mirror field only, not a human-calibrated field.
- Value against people / replay on audited decisions: NOT MET. Post-#11556 + #11622 replay on HVH48-E gives `fixed 86`, `newlyWrong 83`, `changed 302`, `still wrong 21`, `unjudged 112` (meets the build floor `newlyWrong <= fixed`, fails the REPLAY-6 declared 2:1 bar `fixed >= 2 x newlyWrong`). HVH48-D cash is 100% inert (`0` of `2734` differed).

## League card runs (2026-11-21)

Card `mtt6_holdem_tournament_all_in_call_is_priced_12bb` (`server/src/benchmark/HorseLeague.ts`: NLH, 6 seats, 12 bb, big-blind-ante MTT with live M state, mirror field, `hybridBaseline`, `moodClock: deal_seed`, arm A `{"holdemTournamentAllInCallIsPriced":true}`, arm B `{}`, 6,000 pairs per seed). Run single-threaded on the operations Mac via `EQUITY_GOVERNOR=off npx tsx src/scripts/horseLeagueCard.ts --card=mtt6_holdem_tournament_all_in_call_is_priced_12bb --seed=20261121,20261122,20261123` at engine revision `09986930d3db5e08817a3d5183fc1eb707df3536` (solver stores empty: `charts=0 postflop=0 postflopV31=0`).

| seed             | pairs (hands)   | bb/100 (A - B) | stderr | block stderr (40 blocks) | z    | verdict     | divergent pairs | wall    | illegal / truncated / corrected / fallbacks |
| ---------------- | --------------- | -------------- | ------ | ------------------------ | ---- | ----------- | --------------- | ------- | ------------------------------------------- |
| 20261121         | 6,000 (12,000)  | +3.93          | 0.89   | 0.71                     | 4.42 | SIGNIFICANT | 539             | 182.7 s | 0 / 0 / 0 / 0                               |
| 20261122         | 6,000 (12,000)  | +2.63          | 0.89   | 0.91                     | 2.95 | SIGNIFICANT | 574             | 183.3 s | 0 / 0 / 0 / 0                               |
| 20261123         | 6,000 (12,000)  | +2.65          | 0.86   | 0.93                     | 3.07 | SIGNIFICANT | 568             | 177.8 s | 0 / 0 / 0 / 0                               |
| Pooled (3 seeds) | 18,000 (36,000) | +3.07          | 0.51   | n/a                      | 6.03 | SIGNIFICANT | 1,681           | 543.8 s | 0 / 0 / 0 / 0                               |

## Limits

- Ranges are population and Nash models, not reads of the opponent; the re-jam, 3-bet and caller widths are stated constants.
- Side pots are priced as one pot: the Horse must beat every opponent in the pot to win W; a side pot it could win against one of them alone is not credited (a call is priced slightly too tight in multiway pots with unequal stacks).
- Bounty value is not added to the call.
- The overcall model prices only the widest player behind waking up, not two.
- Postflop it uses the engine's equity as it stands, and only facing a jam (see 0f7c778b and 2b5b823c above).

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: fixed 86; newlyWrong 83; changed 302; unchanged 5054; unjudged 112; set HVH48-E Hold'em tournaments vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 5356 of 10937

Re-run 2026-11-21 on the corrected replay history (#11556, no forced posts in `actionHistory`) and ledger-attributed receipt keeping (#11622) at checkout `09986930d3db`, scorer `5302af2ab3e`, base arm `off` = the `66`-row archived production switch snapshot of `2026-11-21T15:00Z` (`horse-decisions-01UxDLnM/holdem-offlist/prod-switch-20261121T1500Z.json`, `0` sanitized, `0` refused), arm `on` = base plus `holdemTournamentAllInCallIsPriced`, seeds `1,7,42`, opponent memory OFF (`mind: false`), `0` arm errors (scratch files with hole cards deleted after scoring).

- Unedited scorer line (`HVH48-E`): `placed (verdict-only; 10937 audited decisions, 244 judged bad; joined by node: 5356 replayed, 5581 not replayed, base reproduces the recorded action on 4420): arm on changed 302 (199 more aggressive, 103 more passive), resized 2, illegal 0, refused 0, errors 0; fixed 86, newly wrong 83, still wrong 21, ok to ok 0, unjudged 112; judged bad left unchanged 78; no bb (the audit declares no EV model); per receipt: holdem_premium_preflop_raise 7 changed / 0 fixed / 6 newly wrong; holdem_tournament_all_in_call_priced_call_seen 232 changed / 84 fixed / 39 newly wrong; holdem_tournament_all_in_call_priced_fold_seen 70 changed / 2 fixed / 44 newly wrong.`
- `HVH48-D` cash (`3891` audited decisions, `2734` replayed in `394` hands, `0` arm errors): arm `on` differed from base `off` on `0` of `2734` rows (100% inert; confirms tournament-only scope; refused by the scorer without `--allow-unchanged`, so no run row is recorded).
- Breakdown (`HVH48-E`): all `302` changes are preflop (`199` more aggressive, `103` more passive). Most frequent live person (present at `26` changed decisions) removed: `276` changed, `83` fixed, `68` newly wrong, `19` still wrong, `106` unjudged. The call receipt (`holdem_tournament_all_in_call_priced_call_seen`) is `232` changed / `84` fixed / `39` newly wrong / `20` still wrong (with `fold -> call` specifically `84` fixed / `8` newly wrong / `69` unjudged), while the fold receipt (`holdem_tournament_all_in_call_priced_fold_seen`) is `70` changed / `2` fixed / `44` newly wrong / `1` still wrong (`call -> fold` `34` newly wrong, `all_in -> call` `18` newly wrong, `all_in -> fold` `9` newly wrong, `all_in -> raise` `6` newly wrong).
- Against the REPLAY-6 declared bar (`agent-evidence/extreme-archive/horse-decisions-01UxDLnM/replay6/DECLARATION.md`, sha256 `1ed85e274dd4b6fdff42c7f7b551b224c94290c770424cc2bbdc64f8e1383fbf`: at least 20 changed, `fixed >= 2 x newlyWrong` and `>= 8`, 0 illegal/refused, base fidelity >= 70%, same ratio with most frequent opponent removed): **FAIL (`fixed 86 < 2 x 83 = 166`)**, though it passes the build floor (`newlyWrong 83 <= fixed 86`).
- Superseded pre-#11556 run (2026-11-20, REPLAY-6 on `95dae3848e5`, scorer `c4ab864f30f`, forced blinds/antes still in replayed `actionHistory`, base fidelity `4381` / `81.8%`): `fixed 87; newlyWrong 81; changed 367; unchanged 4989; unjudged 178` (most frequent opponent removed: `339` changed, `84` fixed, `66` newly wrong). Removing forced posts in #11556 raised base fidelity to `4420` (`82.5%`) and cut spurious changes (`367 -> 302`) and unjudged (`178 -> 112`) without changing the FAIL verdict on the declared 2:1 bar.
- Limits: opponent memory is off (`mind: false`); the base arm uses the archived `2026-11-21T15:00Z` switch snapshot (database not read); the audit is verdict-only (no bb), and a change of a decision the audit priced `OK` is counted newly wrong whether or not the audit would also accept the new action.
