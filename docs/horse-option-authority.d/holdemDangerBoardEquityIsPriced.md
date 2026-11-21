# holdemDangerBoardEquityIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Evidence NOT MET: the option stays OFF (read `=== true`, release default off, no switch row).

Built by the Hold'em Strategy lane (2026-11-20, building on helper session_01TLQer8xSzdhPzuDRJXTPag) as the priced rebuild of the "board discipline" draft in Antigravity commits `633eec005d5` (flat `eq15 - 0.15` for one pair on turn/river at `potFrac >= 0.35` on a dangered board) and `6496e1610f0` (flat `cap21 -= 0.15` on four-flush or four-straight boards). An unmeasured flat `-0.15` haircut is a blanket rule prohibited by the 2026-11-17 owner order and Coordinator rule #4; this option drops both unmeasured constants and prices the hand's exact equity against the bettor's measured showdown class distribution on four-flush and four-straight boards.

## What it does

No-limit hold'em cash, one board, no bomb pot, not Lightning, not a tournament; heads-up; turn or river; the board holds four of one suit or four ranks inside one five-rank window; the Horse holds exactly one pair (made category 2) and faces a bet. The decision equity (`eq15`) becomes hero's equity against the bettor's range on THIS board (`holdemDangerBoardBettorEquity`): every unseen two-card combo, hero's exact equity against it (river exact, turn every river card), the combos split by what they make now (no pair / one pair / two pair or better) and the classes weighted by what people who bet such boards showed down: MEASURED `3 / 5 / 42` of `50` (NLH cash with a person seated, last bet or raise of the turn or river on such a board, shown down, `2026-10-20 05:00Z` to `2026-11-19 06:00Z`; `HOLDEM_DANGER_BOARD_BETTOR_SHOWN`, Laplace posterior means `4/53`, `6/53`, `43/53`; SQL in `scripts/horse-measure/sql/nlh-vpip-floor-and-danger-baseline.sql`). Card removal by hero's cards (a blocker) is exact. Every consumer below (the call bar, the committed branch, the raise band) reads the priced equity.

Stated limits: shown hands only (bluffs that won uncalled are missing: the value share is overstated); a turn bettor's shown hand is his river hand; no per-player showdown counter on such boards exists, so the narrowing is by his action (he bet this board) with the people's figures. Off (absent, false or a truthy non-boolean): never entered, byte-identical.

The witness named earlier (`#59783807`, board `K-Q-7-T-8` with three spades) is neither a four-flush nor a four-straight board: the option does not act there.

## Receipts

`holdem_danger_board_equity_priced` (`HorseDataLedger.ts`).

## Tests

`server/src/engine/HoldemCommittedAndDangerBoardArePriced.law.test.ts` (registered in `docs/laws.d/server-src-engine-HoldemCommittedAndDangerBoardArePriced.md`):

- fails if the `holdemDangerBoardEquityIsPriced` wiring in `HorseLogic.ts` is removed;
- fixed-input before/after replay across 40 seeds with live NLH cash options: on a four-flush or four-straight river/turn where one pair without the flush/straight calls a pot-sized bet with the option off, `holdemDangerBoardEquityIsPriced: true` prices `eq15` against `HOLDEM_DANGER_BOARD_BETTOR_SHOWN` (`< 0.30`), flips the negative-EV call to a fold across the replay, and emits `holdem_danger_board_equity_priced`;
- off, unset and non-boolean values are byte-identical with zero receipts; boards without four to a flush or straight, two-pair+ hands, multiway pots, tournaments and Lightning keep the off decision.

## Replay

- Replay: NOT RUN (no journaled NLH decision records exist in the repository scorer format for `server/scripts/audited-decision-replay.ts --row`; fixed-input before/after replay on the live cash profile is recorded in `HoldemCommittedAndDangerBoardArePriced.law.test.ts`)

## League

Card `nlh_danger_board_equity_is_priced` (`HorseLeague.ts`; arm `a` the option, arm `b` live), declared, not run.

## Evidence rows

- Mechanism, scope, receipts, law test, byte-identical off: MET.
- Value against people: NOT MET (0 qualifying heads-up one-pair decisions on 4-card boards in the held-out slice; sample INSUFFICIENT). Without a PASS it stays OFF.
- Do not switch on.
