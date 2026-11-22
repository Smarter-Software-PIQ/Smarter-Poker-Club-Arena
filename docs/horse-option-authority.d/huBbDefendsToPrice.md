# huBbDefendsToPrice: authority for the live switch

Heads Up lane option (2026-11-07, #9936; HU-NLH-001), default OFF in source, read once as `opts.huBbDefendsToPrice !== true` returns early (server/src/engine/HorseLogic.ts). It widens a big-blind preflop calling range, so it is registered off-only under the owner preflop range hold (`OPTION_SWITCH_OFF_ONLY.huBbDefendsToPrice`, status `hold`, source `owner preflop range hold`; allowed states `off` only). The hold stands: the 2026-11-20 lift (PR #11538) was for huBbDefendsUnreadToPrice alone, and its source comment names this option as staying off-only. Evidence NOT MET: its declared evaluation HU-NLH-001c did not support it (human field 25-40bb `+0.53 +/- 0.46` bb/100, not significant), no league card has a significant result, and no replay on real audited decisions has been run. Missing, in order: the owner preflop range hold lifted for this name; a significant league result on the declared bar; scorer-written Replay rows on the corrected replay history (#11556). Its no-read case is now served by huBbDefendsUnreadToPrice, which supersedes it.

## What it does

Code: server/src/engine/HorseHuBbDefence.ts (equity table HU_BB_EQUITY), server/src/engine/HorseLogic.ts (the one read), server/src/engine/HorsePreflop.ts (the call branch, "HU BB DEFENDS TO ITS PRICE").

Heads-up no-limit hold'em cash, the big blind facing the only open (no limp, no caller, open at most 6bb, 20-150bb effective): a hand the V11 heads-up bars fold is called when its all-in equity against the opener's range (the opponent read's RFI/PFR width when engaged, else the V70 heads-up open target, 72% cash, 76% with an ante), times a 0.8 out-of-position realisation, covers the rake-aware pot odds. Widen-only (a fold becomes a call); 3-bets, six-max, tournaments, Omaha, short deck, pot and fixed limit unchanged. Ledger: server/src/engine/HorseDataLedger.ts flag `huBbDefendsToPrice` (tag HuBbPrice).

## Receipts

hu_bb_defends_to_price (server/src/engine/HorseDataLedger.ts): the big blind called a hand the V11 heads-up bars folded because its realised equity against the opener range covered the price.

## Tests

- server/src/engine/HorseHuBbDefence.test.ts: the 169-class table; Q9o, K5o, T6s and 96s fold off and call on at 80bb against a 2.75bb open; widen-only; six-max, heads-up tournaments and heads-up cash under 20bb byte-identical; the 40bb cases.
- server/src/engine/HorseHeadsUpRuleScope.law.test.ts (docs/laws.d/server-src-engine-HorseHeadsUpRuleScope.md).
- server/src/engine/HorseOptionSwitchPreflopHoldLift.test.ts: still off-only beside the huBbDefendsUnreadToPrice lift.

## Evidence rows

Rows of docs/HORSE-DECISION-CHANGE-EVIDENCE.md. Nothing was run for this file; every number below is copied from the record named beside it.

- Mechanism, scope, receipt, tests: recorded (docs/changelog/2026-11-07-horse-hu-bb-defends-to-its-price.md and the tests above).
- Value: NOT MET.
  - Mirror card `hu_bb_defends_to_price`, 80bb, seeds 11-50, 2,000,000 hands: `+0.37 +/- 0.31` bb/100, "Verdict: unresolved" (docs/changelog/2026-11-07-horse-hu-bb-defends-to-its-price.md).
  - 40bb development cards, 8 seeds x 12,500 pairs: human field 25bb `+1.59 +/- 0.85`, 40bb `+2.90 +/- 1.30`, 80bb `+1.34 +/- 1.78`; Horse mirror 40bb `-1.32 +/- 0.84`, 80bb `+0.42 +/- 1.07`; "not grounds to turn the flag on" (docs/changelog/2026-11-12-league-heads-up-40bb-cards.md).
  - Declared evaluation HU-NLH-001c: human field at 25-40bb `+0.53 +/- 0.46` bb/100, not significant; "not supported by its declared evaluation" (docs/changelog/2026-11-15-heads-up-big-blind-defends-unread-to-price.md; HorseDataLedger huBbDefendsUnreadToPrice note).
  - League human field `+0.53 +/- 0.46` (not significant) and opener-defends card `-1.56` and `+3.24` (not significant): Antigravity Coordinator desk record, 2026-11-21; the run files are not in this repository.
  - The diagnosis that superseded it: the 58.7% fold at 15-50bb is a no-read defect, and the 0.8 realisation over-prices the bottom-of-range calls (about 0.7 in the mirror) (docs/changelog/2026-11-15-heads-up-big-blind-defends-unread-to-price.md).
- Owner authority: NOT MET. Off-only under the owner preflop range hold; no lift by name exists (OPTION_SWITCH_PREFLOP_HOLD_LIFTED does not list it).
- Replay on real audited decisions: NOT MET (see Replay).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (off-only under the owner preflop range hold and not supported by its declared evaluation HU-NLH-001c; no audited-decision replay was scored, and any replay must use the corrected history of #11556, which removed forced posts from replayed preflop actionHistory)
