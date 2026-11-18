# V87.1 Hold'em Elite Strategy & Ecosystem Independent Hardening (2026-11-11)

- **Voluntary Straddle Snapshot & Single Stack Normalization (`HandController.ts`, `ServerTableEngineTurns.ts`, `HorseLogic.ts`, `HorsePreflop.ts`)**: Added `getPostedStraddleSnapshot()` so `straddleActive` and `straddleAmount` reflect an actually posted hand straddle (`2x` or `3x` BB) rather than table-level `straddle_enabled`; removed double-division of `straddleEffectiveBB`; treated straddled BB as `1`-behind (`UTG` straddler left) and `UTG+1` as earliest first-in seat.
- **EP Open-Limp Continuations (`HorsePreflop.ts`, `HorseLogic.ts`)**: Guarded `big_pair_trap` and `suited_connector` limp-reraise paths against closed short all-in raises (`facingClosedAllIn` / `reopenAllowed === false`), capped suited-connector iso-call defense by stack share and iso size (`<= 4.25x` + caller allowance), and bounded suited-connector limp-3-bet bluffs (`<= 34%` effective stack).
- **River `V12` Block-Bet Board-Relative Nut Predicate & Collectible Stack Guards (`HorseLogic.ts`)**: Replaced coarse `cat >= 4` with `isV87HoldemBoardRelativeRiverNutTrap()` (paired-board nut/2nd-nut full houses + unpaired nut/2nd-nut flushes & nut straights), added `effRiverBetStack` collectible-chip bounds on river `V12` block-bet value traps, blocker bluffs, and bet-3-bet trap reraises, and prevented `cat <= 3` block-bets from stacking off into river raises.
- **Diamond Cash Unit Normalization (`HorsePreflop.ts`, `HorseLogic.ts`)**: Added `isDiamondCash` (`100 Diamonds = $1.00`) normalization before computing `cashStakeBB` for low-stakes multiway defense loosening.
- **Live Bubble `coveredStack` Derivation & Worker Floor Bootstrap (`ServerTableEngineSettlement.ts`, `HorseHandReview.ts`, `HorseWinnerRead.ts`, `HorseExploitHydrator.ts`, `observerReads.ts`, `workerRuntime.ts`, `HorseDataLedger.ts`)**: Derived per-seat `coveredStack` from `dealtStacksAtDeal` at tournament settlement so `nlh_bubble_covered_calloff` / `_won` can consume the live context; wired Hand #1 `winnerReads` (`1,000` observed-hand half-life) and `flopStab` hydration into `HorseObserverReads.bootstrapPublicProfiles` inside decision workers with `availableAtMs <= decisionTimeMs` causality and `HorseDataLedger` (`HORS-015`, `HORS-016`) provenance; excluded `nit_game` tables from `HorseSessionRotator` `$2/$5+` top-ups. The existing rotator triggers below 80% of reference buy-in and targets the table maximum within the allowance; it does not guarantee a final 80-100bb stack.
- **Validation & Regression Suite (`HorseHoldemV87Validation.test.ts`)**: Added end-to-end validation covering straddles, closed all-in limp continuations, board-relative river nut traps, Diamond stake scaling, live bubble settlement -> `HorseHandReview` -> variant-isolated `HorseSelfTuner`, worker Hand #1 bootstrap, and real `HorseDecisionWorkerRuntime -> ServerTableEngine -> ServerActionValidator -> HandController -> HorseExecutionWitness` commit/refusal/`F06` time-bank flows.

The continuation preserves every present flop-stab row in private decision-read frame v13, including zero, low-frequency and decayed counters. A present row suppresses pooled fallback, so dropping it changed a second look. Malformed counters, unknown actors and duplicate rows are refused; frames without flop evidence retain their predecessor encoding. The journal recognizes v13 under the existing plan-binding rules.

The retained worker fixture now supplies canonical public cards, variant/action/pot facts and a fence naming its real hero seat. On its fixed wet-overpair spot, hydrated fast and deep decisions raise; both unhydrated decisions call. The codec regression covers low, zero, strong and fractional counters independently of that spot.

The offline proving ground settles controller runouts, isolates each arm's public memory, rejects illegal proposals, records accepted-action statistics and freezes a 21-cell, 26,000-pair matrix. Run from `server/` with `HOLD_EM_PROVING_OUTPUT=/absolute/new/archive/path npx vitest run src/benchmark/HoldemProvingGround.test.ts`. Ordinary CI runs a bounded smoke of the same matrix. Its JSON inputs contain per-source hashes; paired raw results and the summary are retained. This compares current V87 enabled/disabled, with empty solver stores and static tournament contexts. It does not establish historical V86 strength, tournament ROI, statistical superiority, or fleet activation. The predecessor 52,000-hand manifest failed chip conservation and is retained as invalid qualification evidence.

Delivery requires exact-candidate gates, protected merge, certified Backup and production activation through the current maintenance route, followed by sealed receipt and actual runtime decision evidence. Local checks alone do not complete delivery.

Independent review reproduced one more straddle boundary defect: the default V86
option made NLH divide a 3x straddle stack by 2x BB while its context reported the
actual 3x unit. NLH now gives the actual posted unit precedence in both values.
The regression covers 2x and 3x straddles at 25, 26, 35, 36 and 60 effective
units with V86 on and off. The PLO branch remains unchanged. Production's current
posting path uses 2x; this is supported 3x snapshot correctness, not evidence of
an observed live 3x incident.

## Classic NLH judged-window correction

The 20% Classic floor is judged over thirty hands, but HorseLogic still computed
its safety margin over ten. That set a 36.44% target instead of 29.49% using
the same 1.3 standard-error formula. The live turn snapshot now carries the
judged window from fn_nit_status, falling back to table maintain_hands when the
read is unavailable. NLH uses this input in range widening and the bounded
cheap-call decision. Missing or immature Classic samples no longer mean zero
VPIP for that call override; the existing range prior still applies.

No 35% action clamp is introduced. Above-target play returns to the normal
strategy; strong hands are not folded to hit a percentage. Floors, warning and
grace rules, rejoin persistence, legal-action and price limits, and cashout
transactions are unchanged. Ten-hand Action/Madness and non-NLH strategy retain
their existing behavior. The 37.3% historical cohort is not a causal estimate: it
has no equivalent live control or retained per-decision input receipts.

Seven regression assertions failed before the correction. The focused VPIP and
V87 integration suites now pass 48 tests, including policy window transport
through the live engine snapshot and real worker/validator/HandController path.
Final required qualification, protected publication and natural live acceptance
remain separate delivery requirements.

The approved Holdem persona hash partition is 25% LAG, 20% Tricky, 40% TAG and
15% Nit Hunter. Frozen boundary identities reproduce the prior mismatch and
pass after correction. The separate PLO and default persona outputs stay
unchanged; finite identity cohorts need not match the target percentages exactly.
