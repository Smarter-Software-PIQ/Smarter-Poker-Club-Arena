# 2026-11-07 - A live report that tunes the river bluffs from real play

The river bluff layers of #9803 (heads-up baseline), #9842 (multiway), #9838
(out-of-position leads, hi-lo) and #9837 (fixed limit, short deck, bomb pots,
multi-board) are merged and default on, and none of them is live yet: the
serving engine at the time of writing is `92e26a9f`, which does not contain
`57d9c627`. The league of #9841 measured them offline. This adds the
measurement that tunes them from REAL play once a certified 04:00 America/Chicago
release serves them.

## What was added

- `scripts/horse-measure/sql/river-bluff-spots.sql`: one read-only statement
  per time slice. Every horse river decision with nothing to call
  (`publicNode.toCall = 0`, origin `horse_policy`), aggregated into cells of
  variant x cash/tournament x heads-up/multiway x checked-to/first-to-act x
  standard/bomb/multi-board x opponent style x opponent kind, with bets, air
  (by #9803's definition), folds, calls, raises, break-even fold, size and
  decision EV (sum and sum of squares, so slices merge exactly).
  Opponent style comes from public stats only (VPIP and WTSD over the
  opponent's last 300 hands in the 3 days before the window); the cuts are the
  measured fleet quartiles/deciles of 2026-11-04 to 11-07. Opponent kind
  (human / horse) splits the report as data identification only
  (CLAUDE.md 10.5); nothing feeds a strategy.
- `scripts/horse-measure/sql/river-bluff-receipts.sql`: daily
  `horse_brain_telemetry` fires of every named river bluff bet receipt (listed,
  so a silent layer reads 0), every other `river_bluff_` / `river_lead_` /
  `v53_river` / `v54_river` receipt, and the `decide_*` controls.
- `server/src/benchmark/RiverBluffLiveReport.ts`: pure parsing, merging,
  rates with standard errors, coverage (gaps and overlaps are reported, never
  read as quiet), receipt status (FIRED / ZERO / NO_DATA, a day without
  flowing controls being NO_DATA), the pre-release baseline comparison, the
  default window, and the markdown report. 16 unit tests in
  `RiverBluffLiveReport.test.ts`.
- `scripts/horse-measure/river-bluff-ev.ts`: the CLI (`window`, `plan`,
  `sql`, `assemble`). `window` reads `engine.smarter.poker/health`, asks git
  whether the serving `releaseSha` contains `57d9c627`, and answers RELEASED
  (start = that boot), NOT_RELEASED (exit 4) or UNKNOWN (exit 3); it never
  guesses a window.
- `scripts/horse-measure/TUNING.md`: which constants in which files, the
  decision thresholds, and the league A/B (#9841's harness) required before a
  tune ships.

No cron, monitor, table, migration or engine change (CLAUDE.md 10.11/10.12):
the report runs on demand and only reads.

## Validated against pre-release data

The spots statement over [06:00, 08:00) UTC 2026-11-07 reproduces the
pre-release baseline exactly (nlh 29.5% bet of 4,328; plo4 27.0% of 3,453;
plo6 33.2% of 268; plo5 31.7% of 164; flo8 18.2% of 22). The receipts
statement over 2026-11-05 to 11-07 returns every new layer's receipt as ZERO
on live days (controls flowing: decide_nlh 870,741 on 11-07) and v53_river_bluff
12, v53_river_scare_bluff 17 on 11-07 (11 and 16 at the 08:20 UTC capture).
The full baseline report is
`docs/horse-measure/2026-11-07/river-bluff-live-baseline.md`.
