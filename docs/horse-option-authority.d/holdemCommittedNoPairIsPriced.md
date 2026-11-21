# holdemCommittedNoPairIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Evidence NOT MET: the option stays OFF (read `=== true`, release default off, no switch row).

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

Stated assumptions, not measurements: future betting after a call is not priced (the committed branch is the stack decision); the bettor folds the weakest part of his range; a Horse bettor is priced at the people's fold curve. Off (absent, false or a truthy non-boolean): never entered, byte-identical.

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

- Replay: NOT RUN (no journaled NLH decision records exist in the repository scorer format for `server/scripts/audited-decision-replay.ts --row`; fixed-input before/after replay on the live cash profile is recorded in `HoldemCommittedAndDangerBoardArePriced.law.test.ts`)

## League

Card `nlh_committed_no_pair_is_priced` (`HorseLeague.ts`; arm `a` the option, arm `b` live), declared, not run. A Horse field is not the people the fold curve was measured on.

## Evidence rows

- Mechanism, scope, receipts, law test, byte-identical off: MET.
- Value against people: NOT MET (cannot compute `eq15` from `hand_history` without journaled NLH decision records).
- Do not switch on.
