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
     way); with no boundary, the plain report;
   - `horse-plo-overfold-gate.mjs --json` (the over-fold alarm for every cell, PLO and Hold'em, below).
   - `horse-overfold-fix-validation.mjs --option <name> --until <until> --json` for every option of
     `horse-overfold-owner-map.json` whose switch is `on` (BEFORE vs AFTER its ON instant on the cells it owns:
     [horse-overfold-fix-validation.md](horse-overfold-fix-validation.md)); a REGRESSED cell is a breach-class regression.
3. Writes `<out-root>/<until as YYYY-MM-DD-HHMMZ>/`: `plan.json` (range, boundaries and why, commands), each tool's
   JSON output and `.err` log, the PLO CSVs, and `SUMMARY.md`.

## The Summary

One page: the range; every split and its reason; a table of every tool with its exit code and what it means; then
**Regressions** (first any over-fold cell over its ceiling with its fix ON; then the NLH audit's nodes worse than the earlier windows pooled, the PLO audit's HARD leaks that got worse, the
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

## The Over-Fold Gate (Every Cell)

Why: the Horses' over-folding was fixed and came back several times, because fixes were layered on a bluff prior
fitted on 41-179 hands, some re-fits used the Horse field (which never bluffs), and nothing alarmed when live folding
drifted. The first alarm (2026-11-26) watched only PLO heads-up turn and river; the heads-up flop, multiway and
Hold'em over-folds measured that week were watched by nothing. Since 2026-11-27 it watches every cell.

`scripts/ops/horse-plo-overfold-gate.mjs` (pure core `horse-plo-overfold-gate-lib.mjs`; the files keep their first
name) counts every Horse decision facing a person's first bet of a postflop street, before any raise. It selects no
hole cards: actions, seats and the profiles' Horse flag only, and it never reads a HUD row.

**Decision cells (120).** Game group (PLO5 cash, PLO4 cash, the two pooled, Hold'em cash, Hold'em tournaments) x flop / turn /
river x heads-up (two players still in at the decision) / multiway x bet size (under 0.4, 0.4 to 0.7, 0.7 and over of
the pot), plus an "all sizes" row per game, street and players in which each decision is held against the ceiling of
its own size cell (a multiway cell holds a handful of decisions a day; a leak spread over three sizes shows there
first).

**Ceiling of a cell**, in this order, named in every row:

1. **People prior table**: `server/src/engine/HorseOmahaFacingBetPeoplePrior.data.ts` (must say
   `source: 'people-only'`; PLO only), where it has the cell with at least 30 people decisions. Heads-up: people's
   measured bluff share (turn and river under `bluff.<street>.hu`, the flop under `flop.hu` when the table has it;
   it arrives with the flop fit, until then flop cells use the next ceiling). Per decision: the minimum-defence fold
   while people bluff at least the balanced share s/(1+2s), rising linearly to 1 as their measured bluff share falls
   to 0 (the first alarm's ceiling, unchanged). Multiway: the table's measured people fold share of the cell
   (`fold.<street>.mw`, turn and river) is shown, as information only (see below).
2. **People's own folds**: people's fold rate in the same cell over the trailing 14 days that end with the range,
   with its sample size, when it has at least 30 decisions. People only: `profiles.is_horse = false`, a profile row
   found, not acting on Horse policy; the bettor may be anyone (people almost never face a person's bet). The test
   carries the people sample's own error.
3. **Minimum defence** (the equilibrium anchor). Heads-up: a bet of s pots profits with any two cards when the fold
   share is above s/(1+s). Multiway: the bet profits only when every remaining opponent folds, so the k players
   left share that one fold budget; shared equally and independently each may fold (s/(1+s))^(1/k), where k is the
   number of players still in besides the decider. It is a bound on the shared burden, not a solved multiway
   strategy (the last to act carries more than the first), which is why the two people-measured ceilings come
   first.

**Multiway gates on fold-through, not on a people fold rate.** People over-call multiway: over 31 days the Horse
multiway turn calls that today's engine folds lost 4.2 bb each, so "Horses fold more than people" is not a leak
there. The multiway decision cells above are shown as information only and never gate. The multiway signal is the
**fold-through** of a person's first bet into a field of Horses (every opponent folds on that street) against the
pure-bluff break-even s/(1+s): a zero-equity bet profits exactly when the field folds through more often than that.
Cells: game group x street x 3-way / 4-way+ x size and all sizes, over the trailing 7 days that end with the range;
a cell needs 60 bets; it gates at z of at least `correctedZ(2.5, fold-through tests of the run)`. The table also
gives what a zero-equity bet earned in pots. The same fold-through numbers are shown beside every heads-up cell as
a second column (the direct "can a pure bluff print" test); heads-up still gates on its people-measured ceiling.
On 2026-11-27 the cell PLO5 turn 3-way gated (62.6% of 115 bets folded through against 44.8%), and the multiway
flop did not (36.8% of 185 against 44.6%).

**Statistics (heads-up cells).** Each cell is tested on the range and on the range pooled with the 3 days before it (the pooled test
needs at least 5 decisions inside the range, so the previous days never gate alone). A window needs 20 decisions to
be tested. A cell gates when either window is above its ceiling by z of at least `correctedZ(3, tests of the run)`
(`horse-audit-multiple-tests.mjs`: Bonferroni over every tested cell and window). The z of the range against the
previous 3 days is shown beside it and never gates.

**The fix signal.** `scripts/ops/horse-overfold-owner-map.json` names the option that owns each cell's fix (PLO
heads-up turn and river: `omahaFacingBetPriorIsPeopleMeasured`; PLO heads-up flop bets of 0.7 pot and over:
`omahaFlopPressureCapIsPriced`; PLO multiway turn and river fold-through: `omahaMultiwayFieldIsPeopleMeasured`; every
other cell: no owner yet). The tool reads each owner's live state from `ca_horse_style_switch` (SELECT) and every gating cell is
one of:

- **over its ceiling WITH ITS FIX ON** (`on` or `on_shadow` since before the tested window began): a regression. It
  is breach-class: listed first in the tool's output, first under Regressions (`BREACH-CLASS (over-fold with the fix
ON)`), first in this section of the summary, and it is a new finding even when the run before listed the same
  cell with its fix OFF;
- fix ON for part of the window (switched on inside it, or `canary`): mixed, not yet a verdict;
- **over its ceiling while its fix is OFF** (`off`, `shadow`, no switch row, or not registered yet): expected until
  the fix is switched on; it stays a finding so it is not forgotten;
- over its ceiling with no owner yet: a leak nobody has built a fix for.

Law `anOverFoldAlarmWatchesEveryCell` (server) fails CI if the owner map names an option that is neither registered
nor awaited with its pull request, if two options own one cell, or if the alarm loses a cell, a ceiling, or its
read-only path. `tests/unit/horsePloOverfoldGate.test.ts` fires a synthetic over-fold in every cell and holds every
cell quiet at its ceiling.

Exit 1 when any cell gates; the summary has the section **Over-Fold Gate** with the four lists above and the table
of every cell that had a decision. A gating cell's identity is `overfold|<game>|<street>|hu|<size>` or `foldthru|<game>|<street>|<3way or 4way+>|<size>` (with
`|fix-on` when its fix is ON) and is marked repeat like the other findings.

Limits: the ceiling does not see the Horse's range (a Horse that checked a weak range may fold more correctly); a
lower people fold rate is not proof that a Horse fold loses chips (only a chips grade decides a fix); a 24-hour cell
often holds under 20 decisions, so most detections come from the pooled window; "fix ON" is the switch row's state,
which acts only on an engine build that contains the option; the bet size is the bet over the pot before it and
does not see a short stack. The read covers 14 days of hands with a person seated (about 2,000 a day on 2026-11-26;
two minutes).

## Safety

SELECTs only, behind `SET TRANSACTION READ ONLY` and a statement timeout (the hand audit's `queryReadOnly`), through
`supabase db query --linked`; every tool it runs is read-only itself. It never reads or prints `.env` or a key. It
writes only under `--out-root`, which has no default.

The NLH hand audit reads tournament ranges in keyset pages since 2026-11-26 (`scripts/ops/horse-audit-paged-read.mjs`);
on a checkout without that change its tournament read over a busy day times out, and the summary shows
`holdem-audit` FAILED (exit 70).
