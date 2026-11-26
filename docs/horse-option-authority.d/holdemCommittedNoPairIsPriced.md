# holdemCommittedNoPairIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. **State: OFF**, locked off-only as measured harm, and it stays so after the 2026-11-22 repair and grade below. Evidence NOT MET: the option is off-only in the registry (`OPTION_SWITCH_OFF_ONLY`, status `harm`, Antigravity Coordinator ruling of 2026-11-21 on PR #11634: value-only harm control `-0.21 +/- 0.07 bb/100`, `z = -3.02`, both seeds significant; pot barreler not resolved) and the database refuses `on` for it once list migration 20261121184749 is installed (read `=== true`, release default off, no switch row). This file proposes no switch row. Update 2026-11-22: the EV pricing was repaired (`bf38179622d8`, `0878ee69f45e`; code in the dark Hold'em bundle PR #11812, stacked on the HORSE DECISIONS combo, open, not merged, read 2026-11-22) and the repaired code PASSED its pre-registered offline league grade `committed-no-pair-priced` (PRIMARY 6-max cash `+0.083 +/- 0.324 bb/100`, `z = +0.257`, equal-weight pooled over 4 seeds, a not-worse bar, not a measured gain; worst guarded cell `-0.561 +/- 0.619`, `z = -0.906`; CONTROL inert; `0` illegal, `0` truncated, `0` brain fallbacks; see `## Grade (2026-11-22)`). The lock is not lifted by that grade: its own Criterion 5 asks first for the scripted harm-control re-run (`nlh_committed_no_pair_is_priced_vs_value_barreler` and `_vs_pot_barreler`, seeds `20261120` and `20261121`) showing the `-0.21` harm gone, and an HVH48 Auditor D replay of the repaired code; neither is recorded. Only then may a separate switch-list migration, with the Coordinator's clearance, take it out of `OPTION_SWITCH_OFF_ONLY`. The 2026-11-21 text below (decided on the recorded league runs and a replay on real audited decisions, `1` changed of `2734`) is kept as history; it describes the code before the repair.

Built by the Hold'em Strategy lane (2026-11-20, building on helper session_01TLQer8xSzdhPzuDRJXTPag) as the priced rebuild of the "Ace-High jamming gate" in Antigravity commits `633eec005d5` (HOLDEM STRATEGY) and `6496e1610f0` (HEADS UP), preserved locally as `archive/holdem-strategy/ace-high-jam-board-discipline-633eec0` and `archive/heads-up/bb-overfold-6496e16`. Those drafts (`if (aceHighJammingGate && cat === 1 && !holdemHoleDrawPresent && potFrac >= 0.40) return all_in`) forced a jam by hand class and an unmeasured `0.40` pot fraction; the brief and witness hands (`#59784826`, `#59784258`) asked for the opposite, that committed unpaired high-card hands stop jamming and calling off without positive expected value. This option drops the unmeasured `0.40` threshold and prices the spot by EV.

## What it does

As built on 2026-11-20 (history: the repair of 2026-11-22, in the next section, replaces the fold share `f` and the value of the call).

No-limit hold'em cash, one board, no bomb pot, no All-In-Or-Fold, not Lightning, not a tournament; heads-up; the committed branch of the facing-bet logic; the Horse holds no pair (made category 1) and no real hole draw (`holdemHoleDrawPresent` false). It takes the best of:

    EV(fold) = 0
    EV(call) = E (P + C)(1 - r) - C
    EV(jam)  = f P (1 - r) + (1 - f)(Ec (P + 2R - C)(1 - r) - R)      (only when R > C)

- `P` the pot with his bet, `C` hero's effective call, `R` the most hero can put in (his stack behind plus the call, capped by hero's stack), `r` the engine's call rake fraction (`callDeductionFraction`, else `rakeMarg`).
- `E` the engine's equity against the bettor's range (`eq15`, after every cap).
- `f` MEASURED: the share of people who fold a postflop bet to a Horse raise, by the price the raise lays them, `(R - C)/(P + 2R - C)`: under `0.20`, `0` of `5`; `0.20-0.30`, `24` of `55`; `0.30` and above, `28` of `64` (NLH cash with a person seated, `2026-10-20 05:00Z` to `2026-11-19 06:00Z`; `HOLDEM_RAISE_FOLD_SHARE_BY_PRICE`, Laplace posterior means; SQL in `scripts/horse-measure/sql/nlh-vpip-floor-and-danger-baseline.sql`). No per-player counter of folds to a postflop raise exists, so every bettor gets his price class's population figure.
- `Ec` hero's exact equity against the strongest `(1 - f)` of the bettor's range, where his range is the strongest prefix (by made strength now) of the unseen two-card combos whose mean hero equity first reaches `E` (`holdemCalledRangeEquity`: calibrated to the engine's own read). River exact, turn every river card, flop a fixed stride of 45 turn-river runouts; no random number.

Stated assumptions and sample limitations, not unconditioned range measurements: the empirical raise-fold curve (`n = 124` person responses to Horse postflop raises across `<0.20`: `0/5`, `0.20-0.30`: `24/55`, `>=0.30`: `28/64`; pooled `52/124`) measures observed responses to raises Horses actually made rather than the bettor's full betting range, and `HOLDEM_DANGER_BOARD_BETTOR_SHOWN` (`n = 50` showdowns) in the companion module is likewise a called-hand showdown distribution biased toward hands that reached showdown rather than the bettor's unconditioned betting range; future betting after a call is not priced (the committed branch is the stack decision); the bettor is modeled as folding the weakest part of his range; a Horse bettor is priced at the people's fold curve. Off (absent, false or a truthy non-boolean): never entered, byte-identical.

## The repair of 2026-11-22 (what the graded code does)

Commits `bf38179622d8` (repair holdemCommittedNoPairIsPriced EV pricing and add dev grade cards) and `0878ee69f45e` (apply `smallPriceScale` once in `holdemCommittedJamFoldShare` with a HUD present), both in `server/src/engine/HorseHoldemCommittedPricing.ts`, with the wiring in `HorseLogic.decidePostflop` strictly inside the `opts.holdemCommittedNoPairIsPriced === true` gate (no default-on change, no SQL migration, no switch-list change). They repair the two defects named as the cause of the value-barreler harm:

- **The jam's fold share** (`holdemCommittedJamFoldShare`). The three-bucket step (`HOLDEM_RAISE_FOLD_SHARE_BY_PRICE`, with its Laplace floor of `1/7` as the price goes to 0 and its cliff at `0.20`) is replaced by a smooth curve anchored on `HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.all_in_raise` in `holdemEmpiricalPriors.ts` (`88/294 = 29.93%` at `avgVillainCallPrice = 0.1855`): below that price it falls quadratically (`(p / avg)^2`, so a near-free min-jam earns no fold equity), above it it rises linearly to at most `1.5x` (capped at `0.45`); with a HUD packet (`r.fRaise`, else the street's `fBet`) it is shrunk by `empiricalBayesShrink` (no `opponentHud/` import).
- **The call's value** (`holdemCommittedContinuationBarrelShare` and `holdemCommittedNoPairPrice`). A call that is not all in on the flop or turn, with chips left behind (`remainingEff = min(stack - toCall, oppBehind) > 0`), no longer assumes a free showdown: his chance to bet the later street(s) is `estimateHoldemBetWhenCheckedTo` (river `1,619 / 5,180 = 31.25%` on the turn; on the flop `1 - (1 - pTurn)(1 - pRiver)`, the module's figure `58.03%`), shrunk with HorseMind `ExploitCounters`, and `EV(call) = max(0, E - pBar x Ebar) x (P + C)(1 - r) + pBar x max(0, Ebar x (P + C + 2B)(1 - r) - B) - C`, with `B = min(remainingEff, P + C)` and `Ebar` the equity against the barrelling part of his range. On the river, or when the call is all in, it is the closed form above.

## Grade (2026-11-22, `committed-no-pair-priced`)

Evidence: `/Volumes/SmarterWork/agent-work/extreme-capacity/horse-switch-013U37bWhV/grade-runs/committed-no-pair-priced/` (`VERDICT.md`, `verdict.json`, `results.jsonl` sha256 `fce00c5db3a0983eaf10d334e743502c1a86c69eadaeac0195f8c6ecefa3834f`). Pre-registered manifest `grade-manifests/committed-no-pair-priced.manifest.json` (sha256 `66f9629e6f5072af19006a5f6666e60c231e7532cabfbaa367425b874739a914`, the sha the verdict records) and criteria `grade-manifests/CRITERIA-holdem-committed-no-pair-is-priced.md` (sha256 `bbf60bf9a25944bc1411d21c6f1df77202974f059644457b1644f09377e21fc6`; the file's sha256, recomputed 2026-11-22, matches). Harness `scripts/ops/grade-holdem-option.mjs` (schema `holdem-grade-harness/v1`, runner sha256 `a10e3a07f494868446854b812cbd2946af30a03b221078e4fdeea3207d80d6e5`, library sha256 `0be911c9b6414562b985f6510d9a097800dad6971dfc8cd8bdf530e2a69572de`), pinned HEAD `0878ee69f45e278ca67c455187a3efa324edcacf` (merged into the bundle by `729bf4c9151f`; `HorseHoldemCommittedPricing.ts` in the bundle is byte-identical to it), offline solver stores, 6,000 pairs per seed, seeds `20261122` to `20261125`.

Arms: A `{ holdemCommittedNoPairIsPriced: true }` vs B `{}`. Bars (pre-registered): PRIMARY equal-weight pooled `z >= -1.0` (not worse); every PRIMARY and GUARD seed and the pooled GUARD above `-2.0 x` its own SE; CONTROL inert; no illegal, truncated or fallback action.

- **Verdict: PASS.** All `9` cell exit codes `0`.
- PRIMARY `cash6_holdem_committed_no_pair_is_priced` (6-max NLH cash): equal-weight pooled **`+0.083 +/- 0.324 bb/100` (`z = +0.257`)**; inverse-variance cross-check `+0.105 +/- 0.189` (`z = +0.555`). Seeds: `+0.238 +/- 0.677` (`z = +0.351`), `+0.509 +/- 0.889` (`+0.573`), `-0.561 +/- 0.619` (`-0.906`), `+0.147 +/- 0.213` (`+0.690`). `106` divergent pairs.
- GUARD `hu_holdem_committed_no_pair_is_priced` (heads-up NLH cash): pooled inverse-variance `+0.857 +/- 0.952` (`z = +0.900`), equal-weight `+2.924 +/- 1.805`. Seeds: `+0.325 +/- 1.040`, `+2.368 +/- 3.857`, `+6.946 +/- 4.359`, `+2.058 +/- 4.144`.
- Worst guarded cell: `cash6_holdem_committed_no_pair_is_priced` seed `20261124`, `-0.561 +/- 0.619` (`z = -0.906`), inside the `-2.0` bar.
- CONTROL (`a = b = {}`, seed `20261122`): `0` parted hands, `0` divergent pairs, `0.000 bb/100` (inert).
- Hard flags: `0` illegal, `0` truncated, `0` brain fallbacks.
- VERIFIER-10 recompute: the verdict names the command (`node scripts/ops/grade-holdem-option.mjs recompute ... --criteria-sha=bbf60bf9... --compare=<verdict.json>`); no recompute result is recorded in the grade folder (not measured).
- Not in this grade: the scripted harm-control field (the value barreler that measured the harm, and the pot barreler) and any human field. On the repaired code those are not measured.

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
- since 2026-11-22 (`bf38179622d8`): the smooth all-in fold curve anchored on `HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.all_in_raise` (quadratic below the reference price), the continuation-barrel value of a non-all-in flop or turn call, the wiring inside the `=== true` gate, and the dev grade cards `cash6_holdem_committed_no_pair_is_priced` and `hu_holdem_committed_no_pair_is_priced` in `DEVELOPMENT_LEAGUE_CARDS` (`server/src/benchmark/HorseLeague.ts`, never `LEAGUE_MATCHUPS`).

## Replay

Machine-read (README.md, "The Replay row"); the run row is written by the scorer and copied unedited.

The run row below is of the code before the 2026-11-22 repair (checkout `5bfaa38d0e0`). The repaired code has not been replayed on real audited decisions (not measured); its grade's Criterion 5 asks for that replay before the lock can be lifted.

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
- League grade of the repaired code (2026-11-22, offline, pre-registered): PASS on its not-worse bar (`+0.083 +/- 0.324 bb/100`, `z = +0.257`; see `## Grade (2026-11-22)`). Scripted harm-control re-run and replay of the repaired code: not measured.
- Do not switch on: it is off-only, and the lock stands until the harm-control re-run and the replay of the repaired code are recorded and the Coordinator clears a switch-list migration.

## Verdict (2026-11-21)

Evidence NOT MET. The option stays OFF and no switch row is written.

- League: the three recorded seeds combine to `-0.50 +/- 0.53 bb/100` (`z = -0.95`). That is not significant (`|mean|` is under 2 standard errors), no single seed is significant, and no significant positive run exists, so the bar of three significant positive runs is not reached. It is not measured harm either.
- Real-hand replay: the row passes the build's bar (`newlyWrong 0 <= fixed 0`) but carries no information on value: `1` changed decision in `2734`, unjudged.
- Scripted field (2026-11-21): against the pot barreler, where the option acts on about `1` pair in `110`, the two seeds are `-0.74 +/- 1.01` and `+0.33 +/- 0.98` (together `-0.21 +/- 0.70`, `z = -0.30`): not resolved, no significant positive run. Against the value-only harm control both seeds are significantly negative (together `-0.21 +/- 0.07`, `z = -3.02`): measured harm.
- Missing, exactly (before the harm result): a significant positive league result (`|mean| > 2` standard errors, positive) on a field where the option acts, three such runs for a default-on promotion. The Horse mirror diverged on `20`, `34` and `80` pairs of `6,000`; a card against the person-like bettor field that the fold curve was measured on (`n = 124` raise responses) is the run that can resolve it. A larger audited hold'em cash set would also be needed before the Replay row says anything: 48 hours of play reached the spot twice.

## Verdict update (2026-11-22)

Evidence NOT MET, unchanged. The repaired code's offline league grade is PASS on a not-worse bar (no measured gain, no measured harm in the Horse cash fields it played). What the 2026-11-21 lock rests on, the value-only harm control, has not been re-run on the repaired code, and the repaired code has not been replayed on real audited decisions. Until both are recorded here and the Coordinator clears a switch-list migration, the option stays in `OPTION_SWITCH_OFF_ONLY` and the database refuses `on`.

## Rollback

It is OFF, off-only, with no switch row, so nothing is rolled back today. If it is ever unlocked and switched on with the note `authority: holdemCommittedNoPairIsPriced docs/horse-option-authority.d/holdemCommittedNoPairIsPriced.md sha256 <64 hex>` (this file's sha256 at that time; `HorseOptionSwitch.optionSwitchOnNote`), roll back by switching it off: `node scripts/ops/horse-option-switch.mjs set holdemCommittedNoPairIsPriced off --rollback --reason <text> --authority <ref> --changed-by <actor>` (`fn_ca_horse_option_switch_set('holdemCommittedNoPairIsPriced', 'off', '<actor>', '<reason>')`). Off is byte-identical to the base brain (law test); no data migration.

Rollback triggers (any one, while it is on):

- any `horse_decision_refused_isolated` row;
- any `phase15_execution_fallback` row;
- `recoverableRequestErrors` above `0`;
- new `horse_error_log` rows tied to it (a decision carrying one of its receipts, or an error in `HorseHoldemCommittedPricing.ts` or its `HorseLogic` site).
