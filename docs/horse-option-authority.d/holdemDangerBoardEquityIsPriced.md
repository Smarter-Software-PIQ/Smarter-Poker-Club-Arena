# holdemDangerBoardEquityIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Evidence NOT MET: the option stays OFF (read `=== true`, release default off, no switch row). Decided 2026-11-21 on the recorded league runs (not significant) and a replay on real audited decisions (`5` changed of `2734`, `1` fixed, `1` newly wrong); the `n = 50` showdown sample it prices against is call-biased; see Verdict.

Built by the Hold'em Strategy lane (2026-11-20, building on helper session_01TLQer8xSzdhPzuDRJXTPag) as the priced rebuild of the "board discipline" draft in Antigravity commits `633eec005d5` (flat `eq15 - 0.15` for one pair on turn/river at `potFrac >= 0.35` on a dangered board) and `6496e1610f0` (flat `cap21 -= 0.15` on four-flush or four-straight boards). An unmeasured flat `-0.15` haircut is a blanket rule prohibited by the 2026-11-17 owner order and Coordinator rule #4; this option drops both unmeasured constants and prices the hand's exact equity against the observed called-hand showdown class distribution (`n = 50`, biased toward hands that reached showdown rather than the bettor's full betting range) on four-flush and four-straight boards.

## What it does

No-limit hold'em cash, one board, no bomb pot, not Lightning, not a tournament; heads-up; turn or river; the board holds four of one suit or four ranks inside one five-rank window; the Horse holds exactly one pair (made category 2) and faces a bet. The decision equity (`eq15`) becomes hero's equity against the bettor's range on THIS board (`holdemDangerBoardBettorEquity`): every unseen two-card combo, hero's exact equity against it (river exact, turn every river card), the combos split by what they make now (no pair / one pair / two pair or better) and the classes weighted by what people who bet such boards showed down: MEASURED `3 / 5 / 42` of `50` (NLH cash with a person seated, last bet or raise of the turn or river on such a board, shown down, `2026-10-20 05:00Z` to `2026-11-19 06:00Z`; `HOLDEM_DANGER_BOARD_BETTOR_SHOWN`, Laplace posterior means `4/53`, `6/53`, `43/53`; SQL in `scripts/horse-measure/sql/nlh-vpip-floor-and-danger-baseline.sql`). Card removal by hero's cards (a blocker) is exact. Every consumer below (the call bar, the committed branch, the raise band) reads the priced equity.

Stated sample and selection limitations (`n = 50` showdowns; companion raise-fold sample `n = 124`): `HOLDEM_DANGER_BOARD_BETTOR_SHOWN` (`3 / 5 / 42` of `n = 50`) is observed from shown-down hands only. A shown hand is a called hand, so this distribution is selection-biased toward hands that reached showdown (bluffs that won uncalled and bets that folded to a raise are absent, overstating the bettor's value share) and must not be read as the bettor's unconditioned betting range. Likewise, a turn bettor's shown hand is his river hand, and no per-player showdown counter on such boards exists, so the narrowing uses the pooled human showdown sample (`n = 50`). Off (absent, false or a truthy non-boolean): never entered, byte-identical.

The witness named earlier (`#59783807`, board `K-Q-7-T-8` with three spades) is neither a four-flush nor a four-straight board: the option does not act there.

## Receipts

`holdem_danger_board_equity_priced` (`HorseDataLedger.ts`).

## Tests

`server/src/engine/HoldemCommittedAndDangerBoardArePriced.law.test.ts` (registered in `docs/laws.d/server-src-engine-HoldemCommittedAndDangerBoardArePriced.md`):

- fails if the `holdemDangerBoardEquityIsPriced` wiring in `HorseLogic.ts` is removed;
- fixed-input before/after replay across 40 seeds with live NLH cash options: on a four-flush or four-straight river/turn where one pair without the flush/straight calls a pot-sized bet with the option off, `holdemDangerBoardEquityIsPriced: true` prices `eq15` against `HOLDEM_DANGER_BOARD_BETTOR_SHOWN` (`< 0.30`), flips the negative-EV call to a fold across the replay, and emits `holdem_danger_board_equity_priced`;
- off, unset and non-boolean values are byte-identical with zero receipts; boards without four to a flush or straight, two-pair+ hands, multiway pots, tournaments and Lightning keep the off decision.

## Replay

Machine-read (README.md, "The Replay row"); the run row is written by the scorer and copied unedited.

- Replay: fixed 1; newlyWrong 1; changed 5; unchanged 2729; unjudged 3; set HVH48-D Hold'em cash vs people 48h; scorer d6b032d3204; source placed verdict-only; arm danger vs off; replayed 2734 of 3891

Unedited scorer line: `placed (verdict-only; 3891 audited decisions, 372 judged bad; joined by node: 2734 replayed, 1157 not replayed, base reproduces the recorded action on 2214): arm danger changed 5 (0 more aggressive, 5 more passive), resized 0, illegal 0, refused 0, errors 0; fixed 1, newly wrong 1, still wrong 0, ok to ok 0, unjudged 3; judged bad left unchanged 225; no bb (the audit declares no EV model); per receipt: holdem_danger_board_equity_priced 5 changed / 1 fixed / 1 newly wrong; hu_cash_matched_commitment 1 changed / 1 fixed / 0 newly wrong; hu_cash_matched_commitment_covered 4 changed / 0 fixed / 1 newly wrong.`

Reach: `holdem_danger_board_equity_priced` fired at `8` of `2734` replayed nodes. It changed `5` decisions, every one a call that became a fold (turn `2`, river `3`), and left `3` river folds as folds. Of the five: `1` fixed (river, the audit's better action is fold), `1` newly wrong (turn, the audit's better action is call), `3` unjudged.

How the row was produced (2026-11-21, on the operations Mac, checkout `5bfaa38d0e0`, run from `server/`; work directory `shared-capacity/holdem-replay-01Gw7aDt`, which holds Horse hole cards and stays on the Mac):

1. Audit set: HVH48 Auditor D (`shared-capacity/hvh48-audit-01TLQer7J/D/decisions.csv`, sha256 `0e36700096a0906d07a5e1ecd0829c35f1ad6abe423f16543103541899c521f0`): every Horse decision in no-limit hold'em cash hands with a person dealt in, `hand_history.created_at` 2026-11-17 18:45 to 2026-11-19 18:45 America/Chicago, `tournament_id is null`. Placed with `python3 scripts/hvh48-audit-nodes.py --set D`: `3891` audited decisions, `3891` placed, `0` not placed; bad `372`, ok `1542`, unjudged `1977`; `2734` replayable (the Horse's own cards known) in `394` hands. The `1157` decisions not replayed are the rows the auditor left unpriced because the Horse's cards were not known.
2. `npx tsx scripts/audited-node-option-replay.ts --job D.job.json --switch <switch rows> --arms committed=holdemCommittedNoPairIsPriced,danger=holdemDangerBoardEquityIsPriced --out D.replay.jsonl` (seeds `1,7,42`; `2734` nodes, `0` arm errors; replay sha256 `b0b02b7a3916b5028b799bd3ea1cd0134728467f03fb8b23dc21ef1829c446c8`). Each arm is the base rows plus its one option.
3. `npx tsx scripts/audited-decision-replay.ts --placed D.nodes.jsonl --replay D.replay.jsonl --line ARM --row ARM --set "HVH48-D Hold'em cash vs people 48h"`, the row above copied unedited.

Limits of this replay. The base arm is the production switch rows as archived at 2026-11-20T21:15Z (`prod-switch-20261120T2115Z.json`, 63 rows, the file `huBbDefendsUnreadToPrice.md` used) plus the three rows the coordinator handoff of 2026-11-21 06:21Z lists as switched on after it (`huBbDefendsUnreadToPrice`, `holdemRiverFullHouseValueIsPriced`, `omahaRiverCurrentNutsCallFloor`); the database was not read for this run. `0` rows were sanitized. Opponent memory is off in replay (`replayAt` passes `mind: false`). The base arm reproduces the recorded action on `2214` of `2734` nodes; a changed decision at a node where it does not is unjudged. The audit is verdict-only (no bb). The two-player tournament sets `HU30D` and `HU14D` were not replayed: this option does not act in a tournament.

## League

Card `nlh_danger_board_equity_is_priced` (`HorseLeague.ts`; arm `a` `{"holdemDangerBoardEquityIsPriced":true}`, arm `b` `{}`, 6-seat 100bb NLH cash mirror, `6,000` pairs / `12,000` hands per seed on engine `eca4fd3abcca`):

- Seed `20261120`: `-1.16 +/- 1.03 bb/100` (`104` divergent pairs, `0` illegal actions)
- Seed `20261121`: `-1.26 +/- 1.09 bb/100` (`132` divergent pairs, `0` illegal actions)
- Seed `20261122`: `+0.18 +/- 1.16 bb/100` (`104` divergent pairs, `0` illegal actions)
- Combined (`36,000` hands): `-0.75 +/- 0.63 bb/100` (`z = -1.18`, not resolved). A Horse mirror is not the human showdown sample (`n = 50` called hands) the option prices against.

## Evidence rows

- Mechanism, scope, receipts, law test, byte-identical off: MET.
- Value against people: NOT MET (league `-0.75 +/- 0.63 bb/100`, `z = -1.18`, not significant; replay on HVH48-D changed `5` of `2734` decisions, `1` fixed and `1` newly wrong; the `n = 50` showdown sample is call-biased; see Verdict). Without a PASS it stays OFF.
- Do not switch on.

## Verdict (2026-11-21)

Evidence NOT MET. The option stays OFF and no switch row is written.

- League: the three recorded seeds combine to `-0.75 +/- 0.63 bb/100` (`z = -1.18`). That is not significant (`|mean|` is under 2 standard errors), no single seed is significant, and no significant positive run exists, so the bar of three significant positive runs is not reached. It is not measured harm either: the sign leans negative without resolving.
- Real-hand replay: the row meets the build's bar at equality (`newlyWrong 1 <= fixed 1`), on five changed decisions. One call the audit judged right became a fold and one call the audit judged wrong became a fold: no net gain against people is shown.
- The sample limit stands: the option prices against `HOLDEM_DANGER_BOARD_BETTOR_SHOWN`, `3 / 5 / 42` of `n = 50` showdowns. A shown hand is a called hand, so the sample overstates the bettor's value share, and an option built on it would tend to fold more one-pair hands than the bettor's whole betting range justifies. Every changed decision in the replay is a call turned into a fold, which is the direction that bias pushes.
- Missing, exactly: (1) a significant positive league result (`|mean| > 2` standard errors, positive), three such runs for a default-on promotion, on a field whose bettors bluff these boards at a measured rate, since a Horse mirror is not the people the sample came from; (2) a bettor-range measurement on four-flush and four-straight boards that is not conditioned on a call (uncalled bets and bets that folded to a raise included), or a larger showdown sample with that bias corrected; (3) a Replay row with more fixed than newly wrong on a larger audited hold'em cash set.
