# Horse Daily Audit

One read-only command that runs the whole daily Horse audit for the last 24 hours and writes one dated folder with a
one-page summary. It is run by an agent: there is no cron, timer or watcher behind it.

```bash
node scripts/ops/horse-daily-audit.mjs --out-root <dir on the external SSD> [--until <ISO>] [--since <ISO>]
node scripts/ops/horse-daily-audit.mjs --plan [--until <ISO>]     # boundaries and commands only, nothing else runs
```

## What It Runs

1. Reads the instants where a Horse decision could have changed inside the range:
   - every option switch change in `ca_horse_style_switch_audit` (`changed_at`, option, old and new state);
   - the first hand of every engine build in `hand_history.engine_build` (NLH, PLO4, PLO5) that starts inside the
     range (the build already serving at the start is not a boundary).
     Boundaries within 15 minutes of each other are one (a cutover starts the engine and its standby minutes apart);
     a boundary within 30 minutes of either end is listed and left out (no window worth comparing on one side).
2. Runs, from the repository root, each tool's own read-only command:
   - `horse-hand-audit-holdem.mjs --mode all --json` (NLH cash and tournaments, shown cards only);
   - `horse-hand-audit-omaha.mjs --json --csv omaha-audit-csv` (PLO4 / PLO5 cash, shown cards only);
   - `horse-exploit-report.mjs --split-at <every boundary> --gate=regression --json`; the report takes at most four
     splits, so more boundaries run as consecutive calls, each over the range from the split before its group to the
     split after it (every split keeps its full window on both sides). With no boundary: `--gate=absolute`;
   - `person-vs-horse-results.mjs --split-at <every boundary> --gate --json` (at most eight a call, grouped the same
     way); with no boundary, the plain report.
3. Writes `<out-root>/<until as YYYY-MM-DD-HHMMZ>/`: `plan.json` (range, boundaries and why, commands), each tool's
   JSON output and `.err` log, the PLO CSVs, and `SUMMARY.md`.

## The Summary

One page: the range; every split and its reason; a table of every tool with its exit code and what it means; then
**Regressions** (the NLH audit's nodes worse than the earlier windows pooled, the PLO audit's HARD leaks that got worse, the
exploit report's gate line, people measurably better after a split), **Owner-Rule Breaches** (the PLO audit's graded
breaches: a non-nut raise on the turn or river, a draw raised out of position; with examples) and **Top Leaks** (the
NLH audit's ranked leaks, the PLO audit's HARD leaks versus people, the exploit report's top realised-cost findings).

**Repeats.** Two runs whose ranges overlap read the same hands twice. The run before is `--previous <run folder>`,
else the newest earlier dated folder under `--out-root`. A breach hand it already listed (its JSON or its PLO
`decisions.csv`) is marked `repeat (already reported <folder>)`; so is a regression finding it already listed (same
NLH node, same PLO leak, same exploit cell and split) when its range overlaps this one. Without an overlap the same
node flagging again is a second measurement and is reported in full. Repeats are shown, and do not count toward
exit 1. A turn or river raise with a nut-class hand that is not the exact nuts is listed as "counted apart, not a
breach".

Exit: 0 clean; 1 a regression or an owner-rule breach that is not a repeat; 64 a usage error; 70 a read or a tool failed (the summary is
still written and names the tool; read its `.err`).

## Safety

SELECTs only, behind `SET TRANSACTION READ ONLY` and a statement timeout (the hand audit's `queryReadOnly`), through
`supabase db query --linked`; every tool it runs is read-only itself. It never reads or prints `.env` or a key. It
writes only under `--out-root`, which has no default.

The NLH hand audit reads tournament ranges in keyset pages since 2026-11-26 (`scripts/ops/horse-audit-paged-read.mjs`);
on a checkout without that change its tournament read over a busy day times out, and the summary shows
`holdem-audit` FAILED (exit 70).
