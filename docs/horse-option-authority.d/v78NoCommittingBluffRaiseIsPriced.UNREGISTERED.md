# v78NoCommittingBluffRaiseIsPriced: authority for the live switch

**State: OFF in source (read `=== true`), held in `OPTION_SWITCH_REFUSED` (zero SQL migrations, zero switch rows; rename to `v78NoCommittingBluffRaiseIsPriced.md` only when a future registration PR moves it out of `OPTION_SWITCH_REFUSED`). Evidence NOT MET.** v2 (2026-11-22) prices on the Wave 5.4 NLH fold-to-raise priors of #11759. Mechanism, scope isolation, off-identity, public-info-only invariance, receipts, law tests, and hard safety (`0` illegal, `0` refusals, `0` errors across 8,090 deduplicated HVH48 AsOf-memory decisions) are met; the activation-evidence bar is NOT MET (`n = 0 < 20` people-only changed decisions across HVH48 D + E). Do not register or switch on until (a) a real-human sample reaches `n >= 20` changed decisions and passes, (b) the honest harness grade passes (it FAILED on 2026-11-28 with the per-opponent read wired: 2 divergent deals in 336,000, pooled -0.11 +/- 0.51 bb/100; see "The per-opponent read"), and (c) the read is carried by the decision read frame. It stays OFF.

Criteria declared before build or replay: `CRITERIA-V78-COMMITTING-BLUFF-RAISE-PRICED.md` (sha256 `fd504c6f3cac198dda396fbe8e9dba4e3db08087011302c1e9797af324c6b8f0`, 2026-11-22 03:52 CST, HORSE DECISIONS lead); v2 criteria `CRITERIA-V78-WAVE54-PRICED.md` (sha256 `6c997bf6dc1fcee3`..., 2026-11-22 13:43 CST, declared before the v2 edit or run).

## What it replaces

Unowned blanket 40%-of-stack bluff-raise veto `v78NoCommittingBluffRaise` (`server/src/engine/HorseLogic.ts` `v78CommitsWithoutJam`, `added >= 0.4 * player.stack`, ~238 live fires/day, currently held in `holdemBlanketRulesOffList`) across all 7 NLH-reachable bluff-raise / semi-bluff-raise sites in `HorseLogic.ts`.

## Scope: the blanket rule's own spot, like for like (r3, 2026-11-23)

With the option ON, `HorseLogic.v78CommitsWithoutJam` legalizes the candidate exactly as the blanket rule does. Only when the result is the blanket rule's spot, a non-all-in `raise` whose added chips are `>= 0.4 x player.stack`, does `priceCommittingBluffRaise` decide (allow: not vetoed, veto: vetoed) and record its receipt. Everywhere else (a legal jam, a raise adding `< 40%` of the stack, a non-raise legalization) it returns `false`, what the blanket rule returns there, with no priced receipt. Up to r2 the priced branch also priced jams and small raises, so switching it on would have vetoed spots the blanket rule never touched; r3 removes that.

**ON with `v78NoCommittingBluffRaise: false`:** the priced verdict still governs the spot (the blanket rule would have allowed everything), the same way `v17ShortDeckIsPriced` overrides `v17ShortDeck: false`. Law-tested.

The replay rows below are r2 (pre-scope-fix) numbers; the r3 re-run is recorded in "r3 replay" further down.

## How each decision is priced

Implemented in pure module `server/src/engine/HorseV78CommittingBluffRaisePriced.ts` (`priceCommittingBluffRaise`), wired into `HorseLogic.v78CommitsWithoutJam` behind strict `opts.v78NoCommittingBluffRaiseIsPriced === true` in single-board 2-card NLH (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isPotLimit && vi.holeCount === 2 && !gs.bombPot && !multiBoard36`):

- **Deterministic & public-info-only:** zero `fastRandom()` draws, zero opponent hole cards, zero direct import of `opponentHud/` (preserves `TheHudProviderChangesNoDecision.law.test.ts`).
- **Measured fold-to-raise probability (`F`):** `estimateHoldemFoldToRaisePrior` in `server/src/engine/holdemEmpiricalPriors.ts` (#11759): flop / turn / river fold-to-raise over raise-to-bet and raise-to-pot geometry, SPR, the bettor's commitment, the all-in shift and multiway tightening. Any opponent already all-in, or already matched, gives `F = 0`.
- **Called equity:** `conditionEquityAgainstRaiseCallRange` conditions the Horse's equity on the range that continues against the raise.
- **EV comparison:** `priceHoldemRaiseEv` (fold / call / 3-bet response) at the legalized commitment, capped to what the deepest live opponent can match, under true expected utility per outcome branch `E[u(X)]` with `u(x) = x < 0 ? x * bf : x` (`bf = max(1, heroBubbleFactor ?? 1)` in tournaments, `1` in cash). The raise is allowed only when its utility beats `max(0, e * pot - (1 - e) * bf * toCall)`; otherwise it is vetoed, and unpriceable inputs fail closed to the veto.
- **Per-opponent read (2026-11-28):** `HorseLogic.ts` passes the bettor's own record on the decision's street (`foldToRaiseRead`, from `HorseMind.holdemFoldToRaiseOf`) when the decision uses the mind. See "The per-opponent read" below. The module still accepts `opponentSample` and a HUD packet (`hudOpp`); `HorseLogic.ts` passes neither.
- **Scope isolation:** OFF / unset / false is byte-identical to `origin/main`; Omaha (PLO4/PLO5/PLO6), Short Deck, Fixed Limit, Pot Limit, multi-board, and bomb pots are untouched even when ON.

## Receipts & Tests

- **Receipts (`HorseDataLedger.ts`):** `v78_committing_bluff_raise_priced_allowed`, `v78_committing_bluff_raise_priced_vetoed` (zero in production while default OFF / `OPTION_SWITCH_REFUSED`).
- **Law & Unit Tests:** `server/src/engine/AV78CommittingBluffRaiseIsPriced.law.test.ts` (registered in `docs/laws.d/server-src-engine-AV78CommittingBluffRaiseIsPriced.md`, 19/19 PASS at r3), `HorseReferenceDecisionSources.test.ts`, `TheHudProviderChangesNoDecision.law.test.ts`, `everyUpgradeHasALiveSwitch.law.test.ts`, `everySwitchListNameIsRegistered.law.test.ts`, `aSwitchListIsNeverStale.law.test.ts`, `EveryHorseOptionRecordsItsReplay.law.test.ts`.

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

### r3 replay (scope = the blanket rule's own spot, 2026-11-24)

Criteria `CRITERIA-V78-PRICED-SCOPE-R3.md` (sha256 `0e1beb2f0de4a9d28214d51c0bd451fbcd7ca2b5089f11d9271b91379838fac1`, posted 2026-11-24T06:03:53Z before the run). Same HVH48 D + E sets, memory, switch snapshot, seeds and de-dup rule as v2, on `52b100661f22`: 8,090 decisions, 0 changed (v2: 3), 0 illegal / 0 refused / 0 errors, newly wrong 0 in every slice, people-only changed `n = 0`. In every slice the priced receipts equal the OFF arm's blanket-rule receipts count for count (D 3 blanket vs 0 allow / 3 veto; E 21 vs 0 / 21), so the priced branch now fires exactly where the blanket rule fires; v2's 3 changed decisions came from jams and small raises it priced outside that spot. Real-card grade not computed (0 changed; the grader's card file is no longer on disk). Evidence NOT MET; stays OFF.

### Why Evidence NOT MET

1. **No people-only reach (`n = 0 < 20`):** of 8,090 replayed decisions, 932 faced people-only opponents and none changed action under v2.
2. **The honest grade fails (2026-11-28):** with the per-opponent read wired the option reaches 2 divergent deals in 336,000 and its pooled result is -0.11 +/- 0.51 bb/100 (z -0.21, bar z >= 2). See below.
3. **The read is not in the decision read frame:** a second look and an exact replay price the population. Owed before any switch-on.

## The per-opponent read (2026-11-28)

Changelog: `docs/changelog/2026-11-28-the-bluff-raise-price-reads-each-opponents-folds.md`.

- **Collected:** `HorseMind.observe` counts, per player and postflop street, the first answer (fold, call, raise, all-in) of a player whose own bet or full raise on that street was raised by another player: `[answers, folds]`. Public actions only, each action once, Hold'em scopes only. Stored in its own map (`holdemFoldToRaise`), in memory only, at most 4,000 players, least recently updated dropped first. No table, no migration, no field on `OpponentStats`, nothing in a read frame.
- **Shrunk:** toward people's measured rate on that street with `V78_FOLD_READ_PRIOR_STRENGTH = 20` pseudo-answers.
- **Guarded:** not used below `V78_FOLD_READ_MIN_OPPORTUNITIES = 10` answers on that street (the price is then exactly the population price); priced at the one-sided 95% lower bound (`V78_FOLD_READ_LOWER_BOUND_Z = 1.645`), and the bettor's fold share is never above that bound: it is the smaller of the bound and the geometry model shifted by the bound's distance from people's rate.
- **Prior and evidence (`V78_FOLD_READ_PEOPLE_PRIOR`, `V78_FOLD_READ_EVIDENCE`):** production, SELECT only, 2026-11-28 about 1:25 AM Chicago time; `has_human` NLH hands, one board, no bomb pot, 2026-10-01 to 2026-11-28 1:00 AM Chicago time; people only. Flop 78 / 198 = 0.394 (39 people), turn 67 / 167 = 0.401 (45), river 17 / 58 = 0.293 (26), all 162 / 423 = 0.383 (57). Without the person holding the most answers: 65 / 173, 57 / 148, 14 / 51, 136 / 372.
- **Off identity:** the option's branch is the only reader; the count writes only its own map. `HorseHoldemFoldToRaiseRead.test.ts` and the harness no-op arm (0 divergent in 56 cells).

### Honest harness grade with the read

Criteria declared before any run: `CRITERIA-V78READ-01Gw7aDq.md` (sha256 `77aa63a83dde5cbf0ae395baa39c0929c95834cedde94c528d4b8ef1c374f6b9`). `server/scripts/horse-grade.ts`, base = all 80 live switch rows, 6,000 pairs or deals per cell, heads-up and 6-max, 100 bb and 40 bb; mirror, folder and never-folds at seeds 1, 7, 42; flop folder, caller, value only, balanced, over-bluffer at seed 1. The harness keeps each world's Horse memory for the whole cell, so the read learns inside a cell.

All 56 cells finished: 0 illegal, 0 truncated, 0 no-op divergent deals in every cell (the no-op arm is the option off on both sides while the count collects).

| Opponent profile                                         | Cells | Deals or pairs | Divergent deals | ON minus no-op, bb/100 |
| -------------------------------------------------------- | ----- | -------------- | --------------- | ---------------------- |
| Mirror (Horses against Horses), seeds 1, 7, 42           | 12    | 72,000         | 0               | 0.00 ± 0.00            |
| Folder (over-folds turn and river), seeds 1, 7, 42       | 12    | 72,000         | 1               | -0.63 ± 0.63 (z -1.00) |
| Flop folder (over-folds the flop), seed 1                | 4     | 24,000         | 1               | +0.85 ± 0.85 (z +1.00) |
| Never folds postflop (bets, never folds), seeds 1, 7, 42 | 12    | 72,000         | 0               | 0.00 ± 0.00            |
| Caller (calls every bet, never bets), seed 1             | 4     | 24,000         | 0               | 0.00 ± 0.00            |
| Value only, seed 1                                       | 4     | 24,000         | 0               | 0.00 ± 0.00            |
| Balanced, seed 1                                         | 4     | 24,000         | 0               | 0.00 ± 0.00            |
| Over-bluffer, seed 1                                     | 4     | 24,000         | 0               | 0.00 ± 0.00            |
| **Pooled (the two cells that diverged)**                 | 56    | 336,000        | 2               | -0.11 ± 0.51 (z -0.21) |

The two cells that diverged are both heads-up at 100 bb, seed 1: folder -0.63 ± 0.63 and flop folder +0.85 ± 0.85, one deal each. Every 6-max cell and every 40 bb cell is 0.

**Verdict: FAIL.** Reach is met (the option now diverges, which it never did before), and nothing is harmed, but the value test is not met: pooled z is -0.21 against a bar of 2. The option stays OFF.

Why it fails, measured (a diagnostic run, not a graded cell: heads-up, 100 bb, 6,000 deals, seed 1, one ON world):

| Profile     | Times the option's spot came up | His answers on record at those times | His fold rate there    | Lower bound priced           |
| ----------- | ------------------------------- | ------------------------------------ | ---------------------- | ---------------------------- |
| Folder      | 5                               | 28, 35, 57, 92, 80                   | 0.76 to 0.89           | 0.56, 0.61, 0.69, 0.62, 0.71 |
| Flop folder | 4                               | 22, 23, 98, 56                       | 0.50, 0.52, 0.89, 0.55 | 0.33, 0.34, 0.74, 0.42       |
| Never folds | 1                               | 24                                   | 0.00                   | 0.09                         |

So the read works: it learns inside a cell (up to 98 answers), reads the folder as a folder and the player who never folds as one (lower bound 0.09, so the raise stays refused). What is missing is the spot. A legal non-jam bluff raise that adds 40% or more of the stack is proposed between one and five times in 6,000 heads-up deals. A price that is right about a spot that rare cannot move a win rate, with or without the read. That matches production, where the blanket rule fires about 250 times a day across the whole fleet.

Evidence bar: NOT MET. The option stays OFF.
