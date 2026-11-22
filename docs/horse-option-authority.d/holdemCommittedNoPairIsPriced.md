# holdemCommittedNoPairIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Measured harm, locked off-only as measured harm. Evidence NOT MET: the option is off-only in the registry (`OPTION_SWITCH_OFF_ONLY`, status `harm`, Antigravity Coordinator ruling of 2026-11-21 on PR #11634: value-only harm control `-0.21 +/- 0.07 bb/100`, `z = -3.02`, both seeds significant; pot barreler not resolved) and the database refuses `on` for it once list migration 20261121184749 is installed (read `=== true`, release default off, no switch row). This file proposes no switch row. Decided 2026-11-21 on the recorded league runs (the Horse mirror and the scripted barreler not significant; the value-only harm control significantly negative, `z = -3.02`) and a replay on real audited decisions (`1` changed of `2734`); see Verdict.

Built by the Hold'em Strategy lane (2026-11-20, building on helper session_01TLQer8xSzdhPzuDRJXTPag) as the priced rebuild of the "Ace-High jamming gate" in Antigravity commits `633eec005d5` (HOLDEM STRATEGY) and `6496e1610f0` (HEADS UP), preserved locally as `archive/holdem-strategy/ace-high-jam-board-discipline-633eec0` and `archive/heads-up/bb-overfold-6496e16`. Those drafts (`if (aceHighJammingGate && cat === 1 && !holdemHoleDrawPresent && potFrac >= 0.40) return all_in`) forced a jam by hand class and an unmeasured `0.40` pot fraction; the brief and witness hands (`#59784826`, `#59784258`) asked for the opposite, that committed unpaired high-card hands stop jamming and calling off without positive expected value. This option drops the unmeasured `0.40` threshold and prices the spot by EV.

## What it does

No-limit hold'em cash, one board, no bomb pot, no All-In-Or-Fold, not Lightning, not a tournament; heads-up; the committed branch of the facing-bet logic; the Horse holds no pair (made category 1) and no real hole draw (`holdemHoleDrawPresent` false). It takes the best of:

    EV(fold) = 0
    EV(call) = E (P + C)(1 - r) - C
    EV(jam)  = f P (1 - r) + (1 - f)(Ec (P + 2R - C)(1 - r) - R)      (only when R > C)

- `P` the pot with his bet, `C` hero's effective call, `R` the most hero can put in (his stack behind plus the call, capped by hero's stack), `r` the engine's call rake fraction (`callDeductionFraction`, else `rakeMarg`).
- `E` the engine's equity against the bettor's range (`eq15`, after every cap).
- `f` MEASURED: the share of people who fold a postflop bet to a Horse raise, by the price the raise lays them, `(R - C)/(P + 2R - C)`: under `0.20`, `0` of `5`; `0.20-0.30`, `24` of `55`; `0.30` and above, `28` of `64` (NLH cash with a person seated, `2026-10-20 05:00Z` to `2026-11-19 06:00Z`; `HOLDEM_RAISE_FOLD_SHARE_BY_PRICE`, Laplace posterior means; SQL in `scripts/horse-measure/sql/nlh-vpip-floor-and-danger-baseline.sql`). No per-player counter of folds to a postflop raise exists, so every bettor gets his price class's population figure.
- `Ec` hero's exact equity against the strongest `(1 - f)` of the bettor's range, where his range is the strongest prefix (by made strength now) of the unseen two-card combos whose mean hero equity first reaches `E` (`holdemCalledRangeEquity`: calibrated to the engine's own read). River exact, turn every river card, flop a fixed stride of 45 turn-river runouts; no random number.

Stated assumptions and sample limitations, not unconditioned range measurements: the empirical raise-fold curve (`n = 124` person responses to Horse postflop raises across `<0.20`: `0/5`, `0.20-0.30`: `24/55`, `>=0.30`: `28/64`; pooled `52/124`) measures observed responses to raises Horses actually made rather than the bettor's full betting range, and `HOLDEM_DANGER_BOARD_BETTOR_SHOWN` (`n = 50` showdowns) in the companion module is likewise a called-hand showdown distribution biased toward hands that reached showdown rather than the bettor's unconditioned betting range; future betting after a call is not priced (the committed branch is the stack decision); the bettor is modeled as folding the weakest part of his range; a Horse bettor is priced at the people's fold curve. Off (absent, false or a truthy non-boolean): never entered, byte-identical.

## Measurements behind it (read-only, 2026-11-19/20, SQL in `scripts/horse-measure/sql/nlh-vpip-floor-and-danger-baseline.sql`)

- How the Horses play the spot now (30 days, person bettor, NLH cash): Horses that faced a person's postflop bet and showed down high card made 26 calls (flop 12, turn 13, river 1) and won 6; no Horse all-in over a person's bet showed down high card.
- How people answer Horse raises: the price curve above (124 answers; pooled 52 folds).

## Receipts

`holdem_committed_no_pair_jam_priced`, `holdem_committed_no_pair_call_priced`, `holdem_committed_no_pair_fold_priced`, `holdem_committed_no_pair_unpriced` (`HorseDataLedger.ts`).

## Tests

`server/src/engine/HoldemCommittedAndDangerBoardArePriced.law.test.ts` (registered in `docs/laws.d/server-src-engine-HoldemCommittedAndDangerBoardArePriced.md`):

- fails if the `holdemCommittedNoPairIsPriced` wiring in `HorseLogic.ts` is removed;
- fixed-input before/after replay across 40 seeds with live NLH cash options: on a committed unpaired Ace-high spot where the off line calls or jams off without positive EV, `holdemCommittedNoPairIsPriced: true` flips those negative-EV calls/jams to priced folds and emits the exact `holdem_committed_no_pair_*_priced` receipts;
- off, unset and non-boolean values are byte-identical with zero receipts; pairs, draws, deep uncommitted stacks, multiway pots, tournaments and Lightning are untouched;
- closed-form EV arithmetic, deterministic combo enumeration (`fastRandom` untouched), and measured constant citations verified.

## Replay

Machine-read (README.md, "The Replay row"); the run row is written by the scorer and copied unedited.

- Replay: fixed 0; newlyWrong 0; changed 1; unchanged 2733; unjudged 1; set HVH48-D Hold'em cash vs people 48h; scorer d6b032d3204; source placed verdict-only; arm committed vs off; replayed 2734 of 3891

Unedited scorer line: `placed (verdict-only; 3891 audited decisions, 372 judged bad; joined by node: 2734 replayed, 1157 not replayed, base reproduces the recorded action on 2214): arm committed changed 1 (0 more aggressive, 1 more passive), resized 0, illegal 0, refused 0, errors 0; fixed 0, newly wrong 0, still wrong 0, ok to ok 0, unjudged 1; judged bad left unchanged 226; no bb (the audit declares no EV model); per receipt: holdem_committed_no_pair_call_priced 1 changed / 0 fixed / 0 newly wrong.`

Reach: the option's receipts fired at `2` of `2734` replayed nodes. It changed `1` decision (turn, all-in to call, `holdem_committed_no_pair_call_priced`, unjudged) and left `1` unchanged (river, a fold either way, `holdem_committed_no_pair_fold_priced`). No audited-bad decision was fixed and none was made wrong.

How the row was produced (2026-11-21, on the operations Mac, checkout `5bfaa38d0e0`, run from `server/`; work directory `shared-capacity/holdem-replay-01Gw7aDt`, which holds Horse hole cards and stays on the Mac):

1. Audit set: HVH48 Auditor D (`shared-capacity/hvh48-audit-01TLQer7J/D/decisions.csv`, sha256 `0e36700096a0906d07a5e1ecd0829c35f1ad6abe423f16543103541899c521f0`): every Horse decision in no-limit hold'em cash hands with a person dealt in, `hand_history.created_at` 2026-11-17 18:45 to 2026-11-19 18:45 America/Chicago, `tournament_id is null`. Placed with `python3 scripts/hvh48-audit-nodes.py --set D`: `3891` audited decisions, `3891` placed, `0` not placed; bad `372`, ok `1542`, unjudged `1977`; `2734` replayable (the Horse's own cards known) in `394` hands. The `1157` decisions not replayed are the rows the auditor left unpriced because the Horse's cards were not known.
2. `npx tsx scripts/audited-node-option-replay.ts --job D.job.json --switch <switch rows> --arms committed=holdemCommittedNoPairIsPriced,danger=holdemDangerBoardEquityIsPriced --out D.replay.jsonl` (seeds `1,7,42`; `2734` nodes, `0` arm errors; replay sha256 `b0b02b7a3916b5028b799bd3ea1cd0134728467f03fb8b23dc21ef1829c446c8`). Each arm is the base rows plus its one option.
3. `npx tsx scripts/audited-decision-replay.ts --placed D.nodes.jsonl --replay D.replay.jsonl --line ARM --row ARM --set "HVH48-D Hold'em cash vs people 48h"`, the row above copied unedited.

Limits of this replay. The base arm is the production switch rows as archived at 2026-11-20T21:15Z (`prod-switch-20261120T2115Z.json`, 63 rows, the file `huBbDefendsUnreadToPrice.md` used) plus the three rows the coordinator handoff of 2026-11-21 06:21Z lists as switched on after it (`huBbDefendsUnreadToPrice`, `holdemRiverFullHouseValueIsPriced`, `omahaRiverCurrentNutsCallFloor`); the database was not read for this run. `0` rows were sanitized. Opponent memory is off in replay (`replayAt` passes `mind: false`). The base arm reproduces the recorded action on `2214` of `2734` nodes; a changed decision at a node where it does not is unjudged. The audit is verdict-only (no bb). The two-player tournament sets `HU30D` and `HU14D` were not replayed: this option does not act in a tournament.

## League

Card `nlh_committed_no_pair_is_priced` (`HorseLeague.ts`; arm `a` `{"holdemCommittedNoPairIsPriced":true}`, arm `b` `{}`, 6-seat 100bb NLH cash mirror, `6,000` pairs / `12,000` hands per seed on engine `eca4fd3abcca`):

- Seed `20261120`: `-0.49 +/- 0.77 bb/100` (`20` divergent pairs, `0` illegal actions)
- Seed `20261121`: `-1.01 +/- 0.84 bb/100` (`34` divergent pairs, `0` illegal actions)
- Seed `20261122`: `-0.00 +/- 1.10 bb/100` (`80` divergent pairs, `0` illegal actions)
- Combined (`36,000` hands): `-0.50 +/- 0.53 bb/100` (`z = -0.95`, not resolved). A Horse mirror is not the human bettor field (`n = 124` raise responses) the fold curve was measured on.

### Scripted no-limit field (2026-11-21)

The mirror cannot resolve the option, so it was dealt against scripted heads-up opponents that put a Horse with no pair into the committed branch (`server/src/benchmark/NlhScriptedField.ts`, `docs/changelog/2026-11-21-holdem-scripted-no-limit-field.md`). Arm `a` `{"holdemCommittedNoPairIsPriced":true}`, arm `b` `{}`, heads-up NLH cash, 40bb (two pot-sized bets after a single-raised pot leave a stack-to-pot ratio under 1.2), hybrid cash persona, deal-seeded mood clock; `60,000` pairs per seed, declared from a 3,000-pair probe on seed `20261115` before the measured seeds were dealt; engine `af27d76821c`; `npx tsx src/scripts/horseLeagueCard.ts --card=<card> --seed=20261120,20261121 --pairs=60000`.

Card `nlh_committed_no_pair_is_priced_vs_pot_barreler` (bets the pot every street with any two cards; DESIGN VALUE):

- Seed `20261120`: `-0.74 +/- 1.01 bb/100` (`z = -0.74`, `576` divergent pairs; illegal `0`, truncated `0`, corrected `0`, brain fallbacks `0`)
- Seed `20261121`: `+0.33 +/- 0.98 bb/100` (`z = +0.33`, `520` divergent pairs; illegal `0`, truncated `0`, corrected `0`, brain fallbacks `0`)
- Seeds together: `-0.21 +/- 0.70 bb/100` (`z = -0.30`, not resolved).

Card `nlh_committed_no_pair_is_priced_vs_value_barreler` (the harm control: bets the pot only with two pair or better, never bluffs; DESIGN VALUE):

- Seed `20261120`: `-0.20 +/- 0.10 bb/100` (`z = -2.02`, `10` divergent pairs; illegal `0`, truncated `0`, corrected `0`, brain fallbacks `0`)
- Seed `20261121`: `-0.22 +/- 0.10 bb/100` (`z = -2.26`, `6` divergent pairs; illegal `0`, truncated `0`, corrected `0`, brain fallbacks `0`)
- Seeds together: `-0.21 +/- 0.07 bb/100` (`z = -3.02`, SIGNIFICANT harm). Both seeds are significant on their own. The option acts rarely against a value-only bettor (`16` of `120,000` pairs), but when it acts it loses: against a bettor who never folds a strong hand and never bluffs, a committed no-pair hand is behind, and the measured people's fold share the jam is priced with does not hold.

## Evidence rows

- Mechanism, scope, receipts, law test, byte-identical off: MET.
- Value against people: NOT MET (Horse mirror `-0.50 +/- 0.53 bb/100`, `z = -0.95`, not significant; scripted pot barreler `-0.21 +/- 0.70 bb/100`, `z = -0.30`, not significant; replay on HVH48-D changed `1` of `2734` decisions, unjudged; see Verdict).
- Harm: MEASURED against the value-only harm control (`-0.21 +/- 0.07 bb/100`, `z = -3.02`, both seeds significant). Reported to the coordinator, who locked it off-only as measured harm on 2026-11-21 (list migration 20261121184749).
- Do not switch on.

## Verdict (2026-11-21)

Evidence NOT MET. The option stays OFF and no switch row is written.

- League: the three recorded seeds combine to `-0.50 +/- 0.53 bb/100` (`z = -0.95`). That is not significant (`|mean|` is under 2 standard errors), no single seed is significant, and no significant positive run exists, so the bar of three significant positive runs is not reached. It is not measured harm either.
- Real-hand replay: the row passes the build's bar (`newlyWrong 0 <= fixed 0`) but carries no information on value: `1` changed decision in `2734`, unjudged.
- Scripted field (2026-11-21): against the pot barreler, where the option acts on about `1` pair in `110`, the two seeds are `-0.74 +/- 1.01` and `+0.33 +/- 0.98` (together `-0.21 +/- 0.70`, `z = -0.30`): not resolved, no significant positive run. Against the value-only harm control both seeds are significantly negative (together `-0.21 +/- 0.07`, `z = -3.02`): measured harm.
- Missing, exactly (before the harm result): a significant positive league result (`|mean| > 2` standard errors, positive) on a field where the option acts, three such runs for a default-on promotion. The Horse mirror diverged on `20`, `34` and `80` pairs of `6,000`; a card against the person-like bettor field that the fold curve was measured on (`n = 124` raise responses) is the run that can resolve it. A larger audited hold'em cash set would also be needed before the Replay row says anything: 48 hours of play reached the spot twice.
