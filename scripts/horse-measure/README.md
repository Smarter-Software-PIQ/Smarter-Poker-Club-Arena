# Horse Hold'em live measurement kit

Read-only tools for measuring how the horse fleet actually plays no-limit
hold'em in production, and the baselines recorded before the V61-V74 / rule-4
work activated. **Every statement these tools produce is a SELECT** (some add a
`pg_temp` helper function in the session's own temp schema). Nothing is ever
written. Run them through the Supabase MCP `execute_sql` (project
`kuklfnapbkmacvwxktbh`, one statement per call) or with psql inside
`BEGIN ... ROLLBACK` (CLAUDE.md 11.5).

The server-side TypeScript equivalent of some of this is
`server/src/benchmark/HoldemLiveMeasure.ts` (#8810).

## Tools

| file                                                                                                   | what it measures                                                                                                                                                                                                                                                                                                                                                                                            | usage                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `horse-v63-v69-measure.py`                                                                             | postflop decision classes V63-V69 change (one-pair river/turn calls, bet-raised one pair, high-card turn calls), from `horse_hand_reviews` (the >= 20bb pots only) plus V61/V63 counters and `noteFire` receipts                                                                                                                                                                                            | header docstring; `sql cash                                                                                                                          | mtt SINCE UNTIL`, `fn-sql`, `telemetry-sql`, `render` |
| `horse-rfi-live.py`                                                                                    | raise-first-in frequency, limp %, open-shove %, average open size by table size x position x effective-stack bucket, horses vs humans, plus 13x13 grids (via `ca_hand_facts`)                                                                                                                                                                                                                               | header docstring; `plan SINCE UNTIL --out DIR` then `render`                                                                                         |
| `preflop-raise-ladder.sql`                                                                             | horse open-size histogram, opener's answer to a 3-bet (fold/call/4-bet), 4-bettor's answer to a 5-bet                                                                                                                                                                                                                                                                                                       | paste into `execute_sql`; edit the window                                                                                                            |
| `horse-release-verify.py`, `sql/*.sql`                                                                 | the V74-V79 release verification: which upgrade receipts fire (with the `decide_nlh` liveness control), the preflop ladder, seat-aware jams (V77), committing turn/river raises and call-offs (V78), the V79 top-pair call cells with hand-clustered decision-EV CIs                                                                                                                                        | `sql activation START_DAY`, `sql ladder                                                                                                              | seat-jams                                             | v78 | v79 START END`, `slices START END HOURS`, `combine-v79 FILES`, `check`, `check-file FILE`(timestamps need an explicit offset); guarded by`tests/the-horse-release-kit-only-reads.test.ts` |
| `horse-release-verify.py scorecard`, `sql/scorecard-core.sql`                                          | Phase 5 DAILY SCORECARD: one read-only core statement per UTC day (every `decide_*` control, every receipt of `sql/activation.sql`, 4-bet-then-fold hands and horse vs person net in hands with a person, per variant x format) plus bounded V79/V80, reshove and V81 slices; `assemble` turns the saved execute_sql outputs into one JSON + markdown report with hand-clustered CIs and a coverage section | `scorecard ids DAY`, `scorecard sql DAY ID`, `scorecard plan DAY`, `scorecard assemble DAY DIR [--omaha-cells FILE]`                                 |
| `sql/complaint-extract.sql`, `horse-complaint-replay.ts`, `templates/horse-complaint.law.test.ts.tmpl` | Phase 5 COMPLAINT PIPELINE: extract one hand read-only, rebuild the state at every horse decision, replay today's brain over seeds and profiles, name the rule that fired and the scorecard cell; `--emit-law` turns a confirmed complaint into a permanent exact-replay law under `server/src/engine/horseComplaints/`                                                                                     | `sql complaint-extract HAND_ID` (or `TABLE_ID AT`), then from `server/`: `npx tsx ../scripts/horse-measure/horse-complaint-replay.ts --extract FILE` |
| `leak_pipeline.py`, `leak_feat.sql`                                                                    | the 2026-10-31 weekly leak report pipeline (largest losing decision classes)                                                                                                                                                                                                                                                                                                                                | see `docs/horse-measure/2026-10-31/horse-leak-report-2026-10-31.md`                                                                                  |

## Baselines (the "before" side; engine `eed06fe5`, no V61+ features)

- `docs/horse-measure/2026-10-31/horse-v63-v69-baseline-2026-10-31.md` and
  `results/v63-v69-baseline-2026-10-31/` (window `[2026-10-30 17:15, 2026-10-31 17:15)` UTC).
- `docs/horse-measure/2026-10-31/horse-rfi-live-2026-10-31.md` and
  `results/rfi-2026-10-31/` (window `[2026-10-30 20:40, 2026-10-31 20:40)` UTC).
- `docs/horse-measure/2026-10-31/horse-leak-report-2026-10-31.md` (weekly leak report).
- Preflop raise ladder (`preflop-raise-ladder.sql`, 40 minutes to about
  2026-11-01 01:58 UTC, 8,668 NLH hands):
  - open sizes, cash: 1,319 non-all-in opens, 726 (55%) at <= 2.05bb, 137 at
    2.05-2.3, 189 at 2.3-2.6, 156 at 2.6-3.0, 109 at 3.0-3.6, 2 at 3.6+;
    mean 2.27, median 2.00.
  - open sizes, MTT: 3,841 opens, 1,125 at <= 2.05bb, 1,230 at 2.05-2.3, 694
    at 2.3-2.6, 300 at 2.6-3.0, 137 at 3.0-3.6, 355 at 3.6+.
  - horse that opened, facing a 3-bet: cash fold 141 / call 33 / 4-bet 22
    (72% fold); MTT fold 602 / call 149 / 4-bet 100 (71% fold).
  - horse that 4-bet, facing a 5-bet: MTT call 8 / fold 8 / jam 7; cash call 1 / jam 1.
- Opener facing a 3-bet, 3 hours to about 03:00 UTC 2026-11-01 (V73 author's
  query, see `docs/changelog/2026-11-01-horse-nlh-vs-3bet-defence.md`):
  tournament n=2,937 fold 68.3% / call 18.5% / 4-bet 13.2%; cash n=1,017 fold
  73.0% / 17.8% / 9.2%. By opener seat at 25bb+: tournament BTN 87.4, CO 76.4,
  HJ 73.2, LJ 69.2, UTG 43.3, SB 89.7; cash BTN 84.7, CO 75.2, HJ 67.8, UTG 59.5.
- Against human 3-bets, 72 hours to about 01:45 UTC 2026-11-01 (hands with a
  human seated): NLH fold 156 / call 23 / 4-bet 14; PLO5 fold 493 / call 180 /
  4-bet 45. After a human 5-bet over a horse 4-bet: NLH fold 2, call 1; PLO
  always called.
- The reported hand: Saturday Mystery tournament
  `329aa86f-08a9-46f1-8916-59c230aca349`, hand 53158209 (2026-11-01 02:03 UTC,
  75/150, ~107bb): horse opened QQ to 466, the human 3-bet to 1,631, the horse
  4-bet to 3,751, the human jammed 39,870, the horse folded QQ. In that event
  horses 4-bet 6 of 9 three-bets faced, all value (AA, KK, KK, QQ, QQ, AKo).

## Release Verification Baselines (2026-11-02, engine `eed06fe5`, before V74-V79 activate)

Measured with `horse-release-verify.py` on the old engine; the candidate that
carries V74-V79 is `1a48115763a1` (or a descendant). Every number is a count
with its window; none is a profitability claim.

- Activation since 2026-11-01: control `decide_nlh` 966,380 fires on
  2026-11-02; every V61-V79 and rule-4 receipt 0 (the old engine predates
  them). `v74_nlh_open_size` and `v76_retired_four_bet_bluff` are new
  receipts (Phase 1) and also read 0 until the release that carries them.
- Ladder, 12:40-13:20 UTC, 7,012 NLH hands: cash opens 543 at <= 2.0bb, 627
  under 2.5bb, mean / median 2.25 / 2.00; MTT mean / median 4.97 / 2.60.
  Opener facing a 3-bet: cash fold 82 / call 15 / 4-bet 13; MTT 127 / 12 / 7.
  4-bettor facing a 5-bet: cash call 1 / fold 1 / jam 1.
- Seat jams, 09:20-13:20 UTC: tournament spots dominated by 3-handed late
  opens (10,414 spots, 841 jams at <= 15bb); 4-6 handed samples are small.
- V78, 07:20-13:20 UTC: 168 committing non-all-in turn/river raises, 0
  raise-then-fold, 5 called off a re-shove. Cash average net: river +24.70bb,
  turn +22.49bb.
- V80 evidence (cell A, top pair with a T+ kicker, decision EV of the call):
  2026-11-01 13:20 to 11-02 13:20 UTC T -42.72 (n 105), J -48.92 (n 99),
  Q -36.36 (n 67), K -21.43 (n 48, straddles), A -27.14 (n 32, straddles);
  2026-10-31 13:20 to 11-01 13:20 UTC T-Q -48.49 [-59.77, -37.22] (n 286),
  K-A -34.80 [-54.66, -14.95] (n 98). After V80 these calls should become
  rare in cell A (`sql v79`, kicker strong_T+ rows) and
  `v80_top_pair_strong_kicker` should fire.
- V79 cells, 11:20-13:20 UTC: cell A weak kicker n 14, +11.16bb, CI
  [-23.97, 46.29] (straddles 0); cell A strong kicker n 20, -54.20bb (below
  0); cell B weak kicker n 9, -19.36bb (straddles 0). A 6-hour run gives A weak
  n 47, B weak n 23: the cells need days of data before they can speak.

- Phase 3 preflop residuals (2026-11-02, old engine):
  - 4-bet-then-fold (`sql four-bet-fold`), 04:00-16:00 UTC: nlh cash 58 of
    441 4-bets, nlh tournament 25 of 777; pot-limit Omaha, short deck and the
    limit games 2 of 1,000+ combined, so no non-hold'em rule was needed. In
    the 83 nlh hands 82 5-bets came from the 3-bettor and 70 were all in;
    folded hands were QQ, AK, JJ, TT, 99, AQ, AJs and KK.
    `HorseFourBetThenFoldRealHands.law.test.ts` replays all 83 EXACTLY (each
    hand's recorded table snapshot at the real 4-bet and at the real fold)
    through today's brain. The replay found one remaining path, closed in the
    Phase 3 audit: QQ in the big blind ~198bb deep, a ~189bb opener and a
    ~123bb cold 3-bettor; rule 4a priced the 4-bet only against the 3-bettor
    and the deeper opener jammed. Rule 4a now prices every opponent who
    already put chips in voluntarily. After the fix no hand and no style
    4-bets and then folds; with the premium-aggression module off the replay
    reproduces the leak.
  - Tournament reshoves over one open at 15-30bb from a non-blind seat
    (`sql reshove`), 24 hours to 16:00 UTC: all-in-adjusted EV above zero
    in every cell with n >= 5, including over UTG openers 9-handed (+2.1bb,
    n 49) and 4-6 handed (+3.2bb, n 13, 15-20bb). The Phase 6 reshove node
    was left unchanged.

- Phase 4 Omaha (V81), old engine, 47,806 PLO4/PLO5 horse turn/river calls
  of a bet the horse did not start (`sql omaha-calls` in 4-hour slices, then
  `cd server && npx tsx ../scripts/horse-measure/omaha-call-cells.ts FILES`),
  hand classified at the decision with the engine's evaluator; decision EV
  of the call against folding, CIs clustered by hand; day A 2026-10-31 16:00
  to 11-01 16:00 UTC, day B 11-01 16:00 to 11-02 16:00 UTC, wager >= 0.9 pot
  (day A / day B, bb): river non-nut straight -48.9 / -36.8, flush-board
  straight -43.0 / -43.6, paired-board straight -33.0 / -21.0, 3rd-nut-or-worse
  flush -54.1 / -77.5, paired-board nut or 2nd-nut flush -37.6 / -24.7, PLO5
  2nd-nut flush -39.0 / -58.5, two pair -44.2 / -40.6; turn paired-board
  straight -32.0 / -16.7, cash dominated flush -21.5 / -17.7 (every CI below
  zero on both days). Full outputs: docs/horse-measure/2026-11-02/
  v81-omaha-call-cells.txt. After V81 these cells' call counts should fall to
  near zero and `v81_omaha_big_bet_call_fold` should fire.

### After a release

1. Confirm `releaseSha` on `/health` contains the candidate, the release
   receipt is SEALED and the thaw is complete; take START from that moment.
2. `sql activation START_DAY`: the control must be non-zero; every V74-V81
   receipt should be non-zero within hours (V62 stays 0: it is opt-in).
3. Re-run ladder, seat-jams, v78 and v79 on windows that start after START and
   compare with the block above (like with like, report n with every number).

## Re-measuring after a release

Find the activation time from `https://engine.smarter.poker/health`
(`releaseSha`, `bootPhases.processStartedAt`) and only use windows that start
after it. Compare like with like (same table sizes, positions, depth buckets,
same subset of `horse_hand_reviews`). Expected direction after the
2026-11-01 work: cash opens never under 2.5bb and mostly 2.5-3.5bb (V74
#9116); tournament opens deeper than 25bb ~20% exact min-raises; opener fold
to a 3-bet roughly 52-57% from late seats and 28-45% from early seats (V73
#9088/#9094 harness); sized 4-bets only with QQ+/AK where the jam can be
called, flats deeper, no 4-bet-then-fold (rule 4, #9065 + #9093); receipts
`v70_gto_open`, `v71_ante_push`, `v72_defend_vs_opener`, `v73_vs3bet_defence`,
`holdem_no_four_bet_bluff`, `holdem_premium_flat_deep_three_bet`,
`holdem_four_bettor_continues` present in telemetry.

## Daily scorecard and complaints (Phase 5, 2026-11-05)

Daily scorecard for UTC day `DAY` (every statement is one read-only SELECT,
each finishes well inside the MCP execute_sql wait; core measured at about 4 s
for a full day):

1. `python3 scripts/horse-measure/horse-release-verify.py scorecard ids DAY`
   lists the statements (`core`, `v79-00..03`, `reshove-00..01`,
   `omaha-00..05`).
2. For each id, `scorecard sql DAY ID` prints the statement; run it through
   execute_sql (project `kuklfnapbkmacvwxktbh`) and save the raw result text
   as `DIR/ID.json`.
3. Omaha cells need the engine's own evaluator: `cd server && npx tsx
../scripts/horse-measure/omaha-call-cells.ts --json DIR/omaha-*.json >
DIR/omaha-cells.json`.
4. `scorecard assemble DAY DIR --omaha-cells DIR/omaha-cells.json` writes
   `DIR/scorecard-DAY.json` and `DIR/scorecard-DAY.md`. Missing or unreadable
   slices are listed under Coverage and the report says PARTIAL.

Complaint: `sql complaint-extract HAND_ID` (or `TABLE_ID 2026-11-05T14:03:00Z`),
save the result, then from `server/` run `horse-complaint-replay.ts --extract
FILE --complaint "..."` (add `--scorecard DIR/scorecard-DAY.json` for the
measured cell). Once confirmed and fixed: `--emit-law SLUG --forbid ORD:KIND,...
--title "..."` writes the fixture and law test; the QQ hand of the Phase 3
audit is the first one
(`server/src/engine/horseComplaints/qq-big-blind-four-bet-then-fold-to-the-deeper-opener.law.test.ts`).
