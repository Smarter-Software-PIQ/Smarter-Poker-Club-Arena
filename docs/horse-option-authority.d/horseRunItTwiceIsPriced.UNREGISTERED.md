# horseRunItTwiceIsPriced: authority for the live switch

**State: OFF in source (read `=== true` on the main thread), no switch row, main-thread switch hook wired (`HorseRunItTwiceSwitch.ts`, `horseDecision/lane.ts`, `ServerTableEngineRunout.ts`), not yet registered in the option switch (registration rides the switch-list route: `HorseDataLedger.ts`, `HorseOptionSwitch.ts`, generated follow-up migration, and rename to `horseRunItTwiceIsPriced.md`). Evidence NOT MET.** Rows of docs/HORSE-DECISION-CHANGE-EVIDENCE.md met: mechanism, scope, receipts-designed, tests and off-identity; replay result below; no live evidence.

Owner orders it rests on (verbatim): 2026-11-20 3:27 PM Chicago, "THERE SHOULD NEVER EVER EVER BY ANY BLANKET RULES. MAKE SURE THEY ARE ALL REMOVED IF THEY SOMEHOW GOT ADDED BACK IN."; 2026-11-17, "EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS"; 2026-11-13 11:37 PM Chicago, "HORSE WITH BOTTOM SET SHOULD NOT BE AGREEING TO RUN IT 3 TIMES WITH ONE OUT. AND HORSES SHOULD ONLY BE RUNNING IT MULTIPLE TIMES (SOMETIMES) NOT ALL THE TIME". Built by the HORSE DECISIONS lane (helper UNOWNED-RULES, Claude session_01UxDLnMCzicBiaB19fA18T5); criteria declared before any replay: evidence folder horse-decisions-01UxDLnM/unowned/criteria/horseRunItTwiceIsPriced.CRITERIA.md, sha256 dafe541885c3faa729888c00c513827ac6cbcde56e10f4604e4432aef98f77cf.

## What it replaces

`HorseRunItTwice.horseRunItTwiceRuns` (always on, no option): fixed bands 0.25/0.75, pot 40 bb, persona preference 0.35, score 0.58 with fixed weights, a 5-in-10 hash gate, a 0.42-0.58 three-run band and a 1-in-4 gate. Each number is a threshold or a random gate under the owner's definition.

## How each decision is priced

- Equity / range: the Horse's own public all-in equity at the offer (every all-in hand is face up; the same worker request as all_in_equity). Unknown equity: one run (no data).
- EV / price: EV(k runs) - EV(1 run) = 0 bb. Rake and BBJ are deducted once from the live pot structure (RunItTwiceEngine, scaleWinnerCentsForRake); `RUN_IT_TWICE_EV_GAP_BB` = 0 is asserted by a test against the settlement, so if settlement ever charged per run the test fails and the gap must be priced. Every answer is EV-equal: none is taken over a better one.
- Mix between EV-equal answers: p(multi) is MEASURED: the rate at which people (never Horses) chose or accepted more than one run in the same public cell: role (chooser / responder), the variance a multi-run removes (e(1-e) normalised by the fair share for the players all in) and the pot in big blinds; Gaussian kernel (0.20 variance share, 0.8 ln pot) shrunk to the role's pooled rate with 10 pseudo-decisions. P(3 | multi, table allows 3) from people's choosers, same kernel. Compiled offline into `HorseRunItTwicePeople.data.ts` by `compileRunItTwicePeopleCurve` (no database read in the engine). The Horse's own style seed (`runItTwicePreference`; about the Horse itself, never about the opponent) tilts p by at most 0.5 logit. Draw: FNV-1a of (horse, hand): deterministic, replayable.
- OWNER CUT, explicit: people's own data runs lopsided all-ins more than once (90 days: choosers at 90%+ equity 28 of 57; answering at 10% or less 39 of 89). The owner's 2026-11-13 order says never, so at equity <= 0.25 or >= 0.75 (the definition already serving that order, `HORSE_RIT_LOPSIDED_LOW/HIGH`) this option runs once (reason `owner_cut_lopsided`). Three runs with one out lies inside that band. This is the owner's rule, kept as his rule, not a strategy constant.
- Identity-free: no opponent id, name or per-opponent record enters; the curve holds aggregates only.

## Data

People's answers 2026-10-03 .. 2026-11-20 UTC (earlier logs carry no actor): 789 decisions (376 chooser, 413 responder), 48 people, the most frequent person 45% of rows. Pooled multi share: chooser 0.569 (P(3|multi) 0.248), responder 0.383. With the most frequent person excluded: chooser 0.578, responder 0.574. Limitation: the equity is ca_hand_facts.all_in_equity (the hand's public all-in equity), not the exact figure the engine read at the offer.

## Receipts (wired in `ServerTableEngineRunout.horseRitRuns`; registered with the switch-list turn)

`horse_rit_priced_once`, `horse_rit_priced_multi`, `horse_rit_priced_three`, `horse_rit_priced_owner_cut`, `horse_rit_priced_equity_unknown`.

## Tests

`server/src/engine/HorseRunItTwicePriced.test.ts`: off path equals horseRunItTwiceRuns over a grid (byte-identical answers); the EV gap is 0 against scaleWinnerCentsForRake; never a multi-run at a lopsided equity; never 3 runs from a responder or at maxRuns 2; unknown equity runs once; p moves with the measured curve and the persona tilt stays within 0.5 logit; deterministic; the compiler reproduces the committed data file from fixed rows.

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (run-it-twice answers are not in the audited decision sets the committed scorer reads; the declared replay of 30 days of recorded Horse answers, ON vs OFF, is recorded in prose below and in the evidence folder)

### Declared replay, recorded unedited (2026-11-20, 4:3x PM Chicago)

Set: every Horse run-it-twice answer 2026-10-21 .. 2026-11-20 UTC in action*audit_logs (engine_rit*\*) that has a public all-in equity in ca_hand_facts: 20,431 answers (13,707 chooser, 6,724 responder; 18,443 at Horse-only tables, reported apart below). Both arms computed by the committed functions on the same inputs (OFF horseRunItTwiceRuns, ON horseRunItTwiceRunsPriced). Driver and raw output: evidence folder horse-decisions-01UxDLnM/unowned/replay/ (replay-full.json, replay-excltop.json, inputs.sha256).

| Measure (criteria item)                                                                    | OFF (today)                   | ON                         | People, same window | Bar                   |
| ------------------------------------------------------------------------------------------ | ----------------------------- | -------------------------- | ------------------- | --------------------- |
| 1. lopsided multi-runs                                                                     | 0                             | 0                          | 180 of 789          | 0: PASS               |
| 2. three runs at equity < 0.10 or > 0.90                                                   | 0                             | 0                          | 4                   | 0: PASS               |
| 3. multi share inside the band, chooser                                                    | 0.2784 (n 7,080)              | 0.5723                     | 0.5446 (n 224)      | +/-10 pp: PASS (+2.8) |
| 3. multi share inside the band, responder                                                  | 0.2778 (n 3,909)              | 0.3454                     | 0.3415 (n 205)      | +/-10 pp: PASS (+0.4) |
| 4. overall multi share (incl. lopsided)                                                    | 0.1496                        | 0.2644                     | 0.4715              | > 0 and <= 0.60: PASS |
| 4. ON three-run answers                                                                    | 155                           | 1,109 (chooser, maxRuns 3) | 53                  | reported              |
| 5. offers reaching the single-run branch (insurance)                                       | 0.8504                        | 0.7356                     | -                   | >= 0.50: PASS         |
| 6. replay stability                                                                        | -                             | 0 of 20,431 differ         | -                   | 100%: PASS            |
| 7. most frequent person excluded (curve recompiled, comparison excludes him): chooser band | -                             | 0.6263                     | 0.5979 (n 97)       | +/-10 pp: PASS (+2.8) |
| 7. same, responder band                                                                    | -                             | 0.5326                     | 0.5214 (n 117)      | +/-10 pp: PASS (+1.1) |
| 8. off path byte-identical                                                                 | unit test over 302,400 inputs |                            |                     | PASS (see Tests)      |

Horse-only tables (not evidence about people): OFF multi 0.1501, ON 0.2665 (n 18,443). The OFF arm agrees with the recorded multi-vs-once answer on 56.9% of rows: the window includes Oct 21 - Nov 14, when an earlier rule served (the recorded column holds 4,592 lopsided multi-runs from that era), and the replay equity is the hand's all-in equity, not the figure read at the offer.

Reading: the replay bar declared before the run passes on every item. This is a replay of recorded spots, not live evidence; the option stays OFF (Evidence NOT MET) until it is registered in the option switch (ledger, registry, generated follow-up migration, and authority file rename), cut over, switched on by the Horse SWITCH lane and read live against the rollback rule above.
