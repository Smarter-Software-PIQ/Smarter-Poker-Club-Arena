# Option people impact

One question: **after each live Horse switch or settings change, did real people do better or
worse against the Horses in the games that change governs?**

`scripts/ops/option-people-impact.mjs` is a read-only report. It lists every switch change in
`ca_horse_style_switch_audit` and every runtime settings version in the lookback, and compares
people's results in the window before each change with the window after it. It changes nothing.

## Which report to use

There are two people-against-Horses reports. They answer different questions and share no code.
A third report, `horse-exploit-report.mjs`, judges the Horses' own decisions against break-even.

| Question                                                            | Report                                                                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| What changed lately, and did any change move people's results?      | `option-people-impact.mjs` (this page): one row per change, no arguments needed                                                                   |
| Is one game better or worse for people than before a known instant? | `person-vs-horse-results.mjs` with `--split-at`, see `docs/ops/person-vs-horse-results.md`                                                        |
| May a switch runbook proceed?                                       | `person-vs-horse-results.mjs --gate`: the gate on people's results                                                                                |
| Did a switch change or cutover open a hole in the Horses' play?     | `horse-exploit-report.mjs --split-at <time> --gate` at +3 h, see `docs/ops/horse-exploit-report.md`; a new EXPLOITABLE cell is a rollback trigger |

Run this report first to find the change worth a closer look, then run
`person-vs-horse-results.mjs` on that game and instant. The second report is the stricter one:
it clusters its standard error by person-session, needs 2,000 person-hands on each side and
refuses a window one person dominates. This report treats hands as independent and needs 200
hands on each side, so its "horses doing better" or "horses doing worse" is a pointer, never a
verdict to act on alone.

## Run it

```bash
# Every change in the last 14 days, 24 hours before against up to 24 hours after
node scripts/ops/option-people-impact.mjs

# The last 3 days, one option listed first, saved as markdown
node scripts/ops/option-people-impact.mjs --lookback-days 3 \
  --focus cashDefenceTrimColdCalls --out /path/outside/the/repo/report.md
```

`--help` lists every option. `--sql` prints the query and stops. `--from-json <file>` builds the
report from saved query output.

## What is counted

- Hands with at least one person and at least one Horse dealt in.
- People's combined net big blinds per hand after rake, so chips that only moved between two
  people cancel.
- Only the games the change governs: an explicit table for options whose games are known
  exactly, then the scope sentence recorded in `server/src/engine/HorseOptionSwitch.ts`, then the
  option name. The report prints which of the three it used for each row.
- The query returns per-minute sums only. No hand, account, name or card leaves the database.

## Limits

- Before against after is not a controlled experiment. The last column counts the other changes
  that landed in the same games inside the windows.
- A switch acts only on the decisions it governs. Every other hand in the game dilutes it.
- Tournament results are in tournament chips and move with blind level and field, so a change of
  field between the windows can look like a change in the Horses.
- Lightning tables are not separated from table play.
