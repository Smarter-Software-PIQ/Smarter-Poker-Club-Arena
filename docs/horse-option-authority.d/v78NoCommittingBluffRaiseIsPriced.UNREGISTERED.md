# v78NoCommittingBluffRaiseIsPriced: authority for the live switch

**State: OFF in source (read `=== true`), held in `OPTION_SWITCH_REFUSED` (zero SQL migrations, zero switch rows; rename to `v78NoCommittingBluffRaiseIsPriced.md` only when a future registration PR moves it out of `OPTION_SWITCH_REFUSED`). Evidence NOT MET.** v2 (2026-11-22) prices on the Wave 5.4 NLH fold-to-raise priors of #11759. Mechanism, scope isolation, off-identity, public-info-only invariance, receipts, law tests, and hard safety (`0` illegal, `0` refusals, `0` errors across 8,090 deduplicated HVH48 AsOf-memory decisions) are met; the activation-evidence bar is NOT MET (`n = 0 < 20` people-only changed decisions across HVH48 D + E). Do not register or switch on until (a) a real-human sample reaches `n >= 20` changed decisions and passes, and (b) a per-opponent Hold'em fold-to-raise read is wired: today every opponent is priced on the population prior (see "Open limit").

Criteria declared before build or replay: `CRITERIA-V78-COMMITTING-BLUFF-RAISE-PRICED.md` (sha256 `fd504c6f3cac198dda396fbe8e9dba4e3db08087011302c1e9797af324c6b8f0`, 2026-11-22 03:52 CST, HORSE DECISIONS lead); v2 criteria `CRITERIA-V78-WAVE54-PRICED.md` (sha256 `6c997bf6dc1fcee3`..., 2026-11-22 13:43 CST, declared before the v2 edit or run).

## What it replaces

Unowned blanket 40%-of-stack bluff-raise veto `v78NoCommittingBluffRaise` (`server/src/engine/HorseLogic.ts` `v78CommitsWithoutJam`, `added >= 0.4 * player.stack`, ~238 live fires/day, currently held in `holdemBlanketRulesOffList`) across all 7 NLH-reachable bluff-raise / semi-bluff-raise sites in `HorseLogic.ts`.

## How each decision is priced

Implemented in pure module `server/src/engine/HorseV78CommittingBluffRaisePriced.ts` (`priceCommittingBluffRaise`), wired into `HorseLogic.v78CommitsWithoutJam` behind strict `opts.v78NoCommittingBluffRaiseIsPriced === true` in single-board 2-card NLH (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isPotLimit && vi.holeCount === 2 && !gs.bombPot && !multiBoard36`):

- **Deterministic & public-info-only:** zero `fastRandom()` draws, zero opponent hole cards, zero direct import of `opponentHud/` (preserves `TheHudProviderChangesNoDecision.law.test.ts`).
- **Measured fold-to-raise probability (`F`):** `estimateHoldemFoldToRaisePrior` in `server/src/engine/holdemEmpiricalPriors.ts` (#11759): flop / turn / river fold-to-raise over raise-to-bet and raise-to-pot geometry, SPR, the bettor's commitment, the all-in shift and multiway tightening. Any opponent already all-in, or already matched, gives `F = 0`.
- **Called equity:** `conditionEquityAgainstRaiseCallRange` conditions the Horse's equity on the range that continues against the raise.
- **EV comparison:** `priceHoldemRaiseEv` (fold / call / 3-bet response) at the legalized commitment, capped to what the deepest live opponent can match, under true expected utility per outcome branch `E[u(X)]` with `u(x) = x < 0 ? x * bf : x` (`bf = max(1, heroBubbleFactor ?? 1)` in tournaments, `1` in cash). The raise is allowed only when its utility beats `max(0, e * pot - (1 - e) * bf * toCall)`; otherwise it is vetoed, and unpriceable inputs fail closed to the veto.
- **Open limit:** the module accepts a per-opponent fold-to-raise sample (`opponentSample`) and a HUD packet (`hudOpp`), and `HorseLogic.ts` passes neither. `HorseMind` holds no Hold'em fold-to-raise counter (fold-to-bet counts are a different quantity and are deliberately not used), so live pricing is hand-, size- and stack-dependent but not player-dependent. Owed before activation, with the Horse SWITCH lane's NLH HUD.
- **Scope isolation:** OFF / unset / false is byte-identical to `origin/main`; Omaha (PLO4/PLO5/PLO6), Short Deck, Fixed Limit, Pot Limit, multi-board, and bomb pots are untouched even when ON.

## Receipts & Tests

- **Receipts (`HorseDataLedger.ts`):** `v78_committing_bluff_raise_priced_allowed`, `v78_committing_bluff_raise_priced_vetoed` (zero in production while default OFF / `OPTION_SWITCH_REFUSED`).
- **Law & Unit Tests:** `server/src/engine/AV78CommittingBluffRaiseIsPriced.law.test.ts` (registered in `docs/laws.d/server-src-engine-AV78CommittingBluffRaiseIsPriced.md`, 15/15 PASS), `HorseReferenceDecisionSources.test.ts`, `TheHudProviderChangesNoDecision.law.test.ts`, `everyUpgradeHasALiveSwitch.law.test.ts`, `everySwitchListNameIsRegistered.law.test.ts`, `aSwitchListIsNeverStale.law.test.ts`, `EveryHorseOptionRecordsItsReplay.law.test.ts`.

## Replay

Machine-read (README.md, "The Replay row"):

- Replay: fixed 0; newlyWrong 0; changed 3; unchanged 8087; unjudged 3; set HVH48-D+E NLH cash+tourney AsOf-memory (deduped); scorer 59d700196f6; source placed verdict-only; arm v78p vs off; replayed 8090 of 14828

### HVH48 D (Cash) + E (Tourney) AsOf-Memory Breakdown, v2 (2026-11-22)

Run on `59d700196f6f` + v2 `v78NoCommittingBluffRaiseIsPriced`, `EQUITY_GOVERNOR=off`, `AsOfOpponentMemory` (`76,098` retained public `has_human` hands), live 67-row production switch snapshot (`prod-switch-20261122T0336Z.json`), seeds `1, 7, 42`, deduplicated on `(hand, seat, decision time, toCall, currentBet)` (`0` duplicates dropped), zero hole cards or hand IDs recorded:

| Set & Slice                        |       Replayed | Base Fidelity | Changed | Fixed | Newly Wrong | Unjudged | Illegal / Refused / Err | Priced Receipts (allow / veto) | Real-Card EV Delta (bb)       |
| ---------------------------------- | -------------: | ------------: | ------: | ----: | ----------: | -------: | ----------------------- | ------------------------------ | ----------------------------- |
| HVH48-D Cash (All)                 |  2,734 / 3,891 |        86.80% |       1 |     0 |           0 |        1 | 0 / 0 / 0               | 1 / 22                         | horses n=1: -5.35 bb          |
| HVH48-D Cash (People-only)         |            251 |        85.66% |       0 |     0 |           0 |        0 | 0 / 0 / 0               | 0 / 4                          | n=0                           |
| HVH48-D Cash (People excl. top)    |            251 |        85.66% |       0 |     0 |           0 |        0 | 0 / 0 / 0               | 0 / 4                          | n=0                           |
| HVH48-E Tourney (All)              | 5,356 / 10,937 |        86.20% |       2 |     0 |           0 |        2 | 0 / 0 / 0               | 2 / 34                         | horses n=2: +1.56 +/- 1.56 bb |
| HVH48-E Tourney (People-only)      |            681 |        80.76% |       0 |     0 |           0 |        0 | 0 / 0 / 0               | 1 / 7                          | n=0                           |
| HVH48-E Tourney (People excl. top) |            681 |        80.76% |       0 |     0 |           0 |        0 | 0 / 0 / 0               | 1 / 7                          | n=0                           |

All 3 changed decisions are Horse-vs-Horse and more passive (a raise or all-in became a call). v1 on the same sets (first-bet flop/turn priors, unconditioned called equity): changed 8, fixed 0, newly wrong 5, people-only `-0.908 +/- 0.097 bb` at `n = 2`.

### Why Evidence NOT MET

1. **No people-only reach (`n = 0 < 20`):** of 8,090 replayed decisions, 932 faced people-only opponents and none changed action under v2.
2. **Population prior only:** see "Open limit" above. A per-opponent fold-to-raise read is owed before any registration or switch-on.
