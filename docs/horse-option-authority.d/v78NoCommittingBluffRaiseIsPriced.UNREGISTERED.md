# v78NoCommittingBluffRaiseIsPriced: authority for the live switch

**State: OFF in source (read `=== true`), held in `OPTION_SWITCH_REFUSED` (zero SQL migrations, zero switch rows; rename to `v78NoCommittingBluffRaiseIsPriced.md` only when a future registration PR moves it out of `OPTION_SWITCH_REFUSED`). Evidence NOT MET.** Mechanism, scope isolation, off-identity, public-info-only invariance, receipts, law tests, and hard safety (`0` illegal, `0` refusals, `0` errors across 8,090 deduplicated HVH48 AsOf-memory decisions) are met; activation-evidence bar is NOT MET (`n = 2 < 20` people-only changed decisions across HVH48 D + E, `fixed = 0 < newlyWrong = 1` people-only, `fixed = 0 < newlyWrong = 5` overall, and negative people-only real-card EV delta `-0.908 +/- 0.097 bb`). Do not register or switch on until flop/turn fold-to-raise priors and called-range equity conditioning are calibrated and re-graded.

Criteria declared before build or replay: `CRITERIA-V78-COMMITTING-BLUFF-RAISE-PRICED.md` (sha256 `fd504c6f3cac198dda396fbe8e9dba4e3db08087011302c1e9797af324c6b8f0`, 2026-11-22 03:52 CST, HORSE DECISIONS lead).

## What it replaces

Unowned blanket 40%-of-stack bluff-raise veto `v78NoCommittingBluffRaise` (`server/src/engine/HorseLogic.ts` `v78CommitsWithoutJam`, `added >= 0.4 * player.stack`, ~238 live fires/day, currently held in `holdemBlanketRulesOffList`) across all 7 NLH-reachable bluff-raise / semi-bluff-raise sites in `HorseLogic.ts`.

## How each decision is priced

Implemented in pure module `server/src/engine/HorseV78CommittingBluffRaisePriced.ts` (`priceCommittingBluffRaise`), wired into `HorseLogic.v78CommitsWithoutJam` behind strict `opts.v78NoCommittingBluffRaiseIsPriced === true` in single-board 2-card NLH (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isPotLimit && vi.holeCount === 2 && !gs.bombPot && !multiBoard36`):

- **Deterministic & public-info-only:** zero `fastRandom()` draws, zero opponent hole cards, zero direct import of `opponentHud/` (preserves `TheHudProviderChangesNoDecision.law.test.ts`).
- **Empirical fold probability (`F`):** product over live opponents using `server/src/engine/holdemEmpiricalPriors.ts`:
  - Any already all-in opponent folds `0` (`F = 0`).
  - River: `estimateHoldemRiverFoldToRaise` distinguishing `all_in_raise` (`29.9%` base) vs `non_allin_raise` (`53.7%` base) with `holdemVillainRaiseCallPrice` elasticity and HUD shrinkage (`r.fRaise` / `r.fBet`).
  - Flop / Turn: `estimateHoldemFlopCbetFold` (position, size band, flop texture `paired`/`unpaired_nonmono`/`mono`, small IP SPR band) and `estimateHoldemTurnBetFold` (position, size band), shrunk via structural `HudPacketOpponent` or `HorseMind.foldToBetCountersOf` (`ExploitCounters`).
- **EV comparison:** at legalized raise commitment `add` (capped to deepest live opponent's matchable commitment) and `callAdd = min(oppEffStack, max(0, effRaiseTo - oppBet))`, with risk utility `u(x) = x < 0 ? x * bf : x` (`bf = max(1, heroBubbleFactor ?? 1)` in tournaments, `1` in cash):
  - `EV(bluffRaise) = F * pot + (1 - F) * u(e * (pot + add + callAdd) - add)`
  - `baseline = max(0, u(e * (pot + toCall) - toCall))`
  - Allows iff `EV(bluffRaise) > baseline`; vetoes otherwise and fails closed to veto on unpriceable inputs.
- **Scope isolation:** OFF / unset / false is byte-identical to `origin/main`; Omaha (PLO4/PLO5/PLO6), Short Deck, Fixed Limit, Pot Limit, multi-board, and bomb pots are untouched even when ON.

## Receipts & Tests

- **Receipts (`HorseDataLedger.ts`):** `v78_committing_bluff_raise_priced_allowed`, `v78_committing_bluff_raise_priced_vetoed` (zero in production while default OFF / `OPTION_SWITCH_REFUSED`).
- **Law & Unit Tests:** `server/src/engine/AV78CommittingBluffRaiseIsPriced.law.test.ts` (registered in `docs/laws.d/server-src-engine-AV78CommittingBluffRaiseIsPriced.md`, 13/13 PASS), `HorseReferenceDecisionSources.test.ts`, `TheHudProviderChangesNoDecision.law.test.ts`, `everyUpgradeHasALiveSwitch.law.test.ts`, `everySwitchListNameIsRegistered.law.test.ts`, `aSwitchListIsNeverStale.law.test.ts`, `EveryHorseOptionRecordsItsReplay.law.test.ts`.

## Replay

Machine-read (README.md, "The Replay row"):

- Replay: fixed 0; newlyWrong 5; changed 8; unchanged 8082; unjudged 3; set HVH48-D+E NLH cash+tourney AsOf-memory (deduped); scorer 9ea7cd66536; source placed verdict-only; arm v78p vs off; replayed 8090 of 14828

### HVH48 D (Cash) + E (Tourney) AsOf-Memory Breakdown (2026-11-22)

Run on `origin/main` (`9ea7cd665362`) + `v78NoCommittingBluffRaiseIsPriced`, `EQUITY_GOVERNOR=off`, `AsOfOpponentMemory` (`76,098` retained public `has_human` hands), live 67-row production switch snapshot (`prod-switch-20261122T0336Z.json`), seeds `1, 7, 42`, deduplicated on `(hand, seat, decision time, toCall, currentBet)` (`0` duplicates dropped), zero hole cards or hand IDs recorded:

| Set & Slice                        |       Replayed | Base Fidelity | Changed | Fixed | Newly Wrong | Unjudged | Illegal / Refused / Err | Priced Receipts (allow / veto) | Real-Card EV Delta (bb)                                         |
| ---------------------------------- | -------------: | ------------: | ------: | ----: | ----------: | -------: | ----------------------- | ------------------------------ | --------------------------------------------------------------- |
| HVH48-D Cash (All)                 |  2,734 / 3,891 |        86.80% |       1 |     0 |           0 |        1 | 0 / 0 / 0               | 21 / 2                         | n=1 (horse-only): -57.76 bb                                     |
| HVH48-D Cash (People-only)         |            251 |        85.66% |       0 |     0 |           0 |        0 | 0 / 0 / 0               | 3 / 1                          | n=0                                                             |
| HVH48-D Cash (People excl. top)    |            251 |        85.66% |       0 |     0 |           0 |        0 | 0 / 0 / 0               | 3 / 1                          | n=0                                                             |
| HVH48-E Tourney (All)              | 5,356 / 10,937 |        86.20% |       7 |     0 |           5 |        2 | 0 / 0 / 0               | 33 / 3                         | people n=2: -0.908 +/- 0.097 bb; horses n=5: +3.88 +/- 6.542 bb |
| HVH48-E Tourney (People-only)      |            681 |        80.76% |       2 |     0 |           1 |        1 | 0 / 0 / 0               | 7 / 1                          | n=2: -0.908 +/- 0.097 bb (total -1.82 bb)                       |
| HVH48-E Tourney (People excl. top) |            670 |        80.60% |       1 |     0 |           0 |        1 | 0 / 0 / 0               | 6 / 1                          | n=1: -1.004 bb                                                  |

### Diagnosis for future calibration (why Evidence NOT MET)

1. **Insufficient people-only reach (`n = 2 < 20`):** across 8,090 replayed HVH48 D + E decisions, only 932 faced people-only opponents and only 2 changed action (both in E).
2. **Flop/turn fold-to-raise vs first-bet prior gap:** `holdemEmpiricalPriors.ts` supplies measured river fold-to-raise rates, but flop/turn only supply first-bet fold rates (`estimateHoldemFlopCbetFold`, `estimateHoldemTurnBetFold`). Facing a raise after already betting flop/turn, opponents fold materially less than facing a first bet, and hero's called equity `e` against a raise-continuing range is lower than unconditioned equity; as a result the priced check admitted 54 of 59 evaluations (flipping 6 previously-vetoed calls/folds into committing raises, `0` fixed vs `5` newlyWrong). Measuring dedicated NLH flop/turn fold-to-raise priors and conditioning called equity on villain's raise-continuing range is owed before any promotion or switch registration.
