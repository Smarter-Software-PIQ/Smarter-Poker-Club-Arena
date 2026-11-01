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

| file | what it measures | usage |
|---|---|---|
| `horse-v63-v69-measure.py` | postflop decision classes V63-V69 change (one-pair river/turn calls, bet-raised one pair, high-card turn calls), from `horse_hand_reviews` (the >= 20bb pots only) plus V61/V63 counters and `noteFire` receipts | header docstring; `sql cash|mtt SINCE UNTIL`, `fn-sql`, `telemetry-sql`, `render` |
| `horse-rfi-live.py` | raise-first-in frequency, limp %, open-shove %, average open size by table size x position x effective-stack bucket, horses vs humans, plus 13x13 grids (via `ca_hand_facts`) | header docstring; `plan SINCE UNTIL --out DIR` then `render` |
| `preflop-raise-ladder.sql` | horse open-size histogram, opener's answer to a 3-bet (fold/call/4-bet), 4-bettor's answer to a 5-bet | paste into `execute_sql`; edit the window |
| `leak_pipeline.py`, `leak_feat.sql` | the 2026-10-31 weekly leak report pipeline (largest losing decision classes) | see `docs/horse-measure/2026-10-31/horse-leak-report-2026-10-31.md` |

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
