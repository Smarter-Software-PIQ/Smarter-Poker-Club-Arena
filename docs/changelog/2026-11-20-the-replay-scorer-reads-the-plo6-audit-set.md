# The replay scorer reads the PLO6 audit set (2026-11-20)

No option, no migration, no decision change in production. Nothing is switched. Benchmark library, its CLI, tests and documents only. No database was read or written.

## Why

`docs/horse-option-authority.d/plo6FacingBetIsPriced.md` recorded its Replay row as NOT RUN because the committed scorer (`server/scripts/audited-decision-replay.ts`) read the audit2 and WooWoo sets only. A PLO6 option could not record a scorer-written row at all, so it could never meet the bar of `EveryHorseOptionRecordsItsReplay.law.test.ts`.

## The audit set

HVH48 auditor C, PLO6, three files (on the operations Mac, `/Volumes/SmarterWork/agent-work/shared-capacity/hvh48-audit-01TLQer7J/C/`). The layout below was read from the real files by the coordinator (column and field names only, no card values):

- `decisions.csv`, 11,558 rows. Read: `id` (`d<n>`), `hand` (the hand_history id), `street`, `action`, `status` (`priced` 10,178 / `unpriced` 1,380), `severity` (`CLEAR` 422, `LIKELY` 502, `DEBATABLE` 1,260, empty 9,374), `mistake` (a class word such as `POTODDS-FOLD`, or empty). It has no seat and no action ordinal; its `horse` column is a profile name that does not match the hand's players.
- `meta.jsonl`, one object per audited decision; the object with `n` = N is decision dN. Read: `n`, `hand`, `street`, `act`, `seat`, `t` (the action's timestamp).
- `hands.jsonl`, raw hand_history rows (1,218, all `plo6`). Read: `id`, `game_variant`, `actions[].{action, amount, origin, seat, stage, timestamp}`. The actions carry no ordinal.

## What changed

1. `server/src/benchmark/AuditedDecisionReplay.ts`: `plo6Decisions(decisionsCsv, metaJsonl, handsJsonl)`, `plo6VerdictClass` and the source `plo6`.
   - Placement: for dN take meta row N; it must exist and agree with the csv on hand, street and action; the hand must be present and `plo6`; exactly one action must have origin `horse_policy` and the meta seat, street, timestamp and action. The coordinator verified that all 11,558 real rows place at exactly one action this way. The node is (hand id, seat, street, k), k counted as audit2 counts it.
   - Verdict mapping, the coordinator's decision of 2026-11-20: `priced` with severity `CLEAR` or `LIKELY` is bad (924 rows); `priced` with empty mistake and empty severity is ok (7,994: the auditor priced the decision and found no mistake); `priced` `DEBATABLE` (1,260) and `unpriced` (1,380) are unjudged; any other combination is not placed. `mistake` is kept as the finding.
   - Scoring is the existing verdict-only rule (the WooWoo rule, unchanged): a change away from a bad action is fixed, away from an ok action newly wrong, a change at an unjudged decision or where the base arm does not reproduce the recorded action is unjudged. No bb is claimed: the auditor's pricing is not ported as a judge.
   - Refused, listed with the reason and never placed at a neighbour: an id that is not `d<n>`, an unmappable status or severity, a missing meta row, meta disagreeing with the csv on hand, street or action, a hand absent, a hand that is not `plo6`, zero or more than one matching action (a person's action never matches), a node named twice. A header without the read columns, a meta line without a whole-number `n`, a repeated `n`, a hand line without `id` and actions, a repeated hand and a csv row with the wrong field count throw.
   - Privacy: no card is read or kept. The csv's `hole` and `board`, meta's `hole`, `board` and `humans`, and the hands' `players[].cards`, `hole_cards` and `community_cards` are dropped with the parsed row; the tests put synthetic cards in every one of those fields and assert none reaches a decision, a report or an emitted node.
2. `server/scripts/audited-decision-replay.ts`: `--plo6 <decisions.csv> --plo6-meta <meta.jsonl> --plo6-hands <hands.jsonl>`, alone or beside `--audit2` and `--woowoo`. A PLO6 row that cannot be placed exits 1, as an audit2 row does. `--emit-nodes` adds the audit's `id` and `actionIndex` (the action's index in the hand's actions array) to each PLO6 node. The Replay row is the existing row with `source plo6 verdict-only`.
3. `docs/horse-option-authority.d/README.md` states the layout and the mapping; `plo6FacingBetIsPriced.md` keeps `Replay: NOT RUN` with the new reason and the steps that produce the row.

## What is NOT done

- The real Replay row is not written. The audit set and the auditor's harness (`hvhC_replay.ts`) are on the operations Mac. `plo6FacingBetIsPriced` stays Evidence NOT MET and OFF.
- The auditor's harness does not yet write the scorer's replay rows (one line per node with the arms, and the declared option sets). That change is made beside the harness.
- `omahaStrategyInPlo6` is not touched.

## The command (from server/, on the operations Mac)

```
C=/Volumes/SmarterWork/agent-work/shared-capacity/hvh48-audit-01TLQer7J/C
npx tsx scripts/audited-decision-replay.ts --plo6 $C/decisions.csv --plo6-meta $C/meta.jsonl --plo6-hands $C/hands.jsonl --emit-nodes plo6-nodes.jsonl
# the harness re-decides each node, off and on, one file per seed (1, 7, 42)
npx tsx scripts/audited-decision-replay.ts --plo6 $C/decisions.csv --plo6-meta $C/meta.jsonl --plo6-hands $C/hands.jsonl \
  --replay plo6-replay-seed1.jsonl --line on --row on --set "HVH48 auditor C PLO6 seed 1"
```

The scorer commit in the row is read from git, so the run is made on a checkout where the two scorer files are committed.

## Tests

`server/src/benchmark/AuditedDecisionReplay.test.ts`, six cases on synthetic rows in the real three-file layout, with synthetic cards in every card-bearing field: the verdict mapping; placement by meta seat and timestamp with k and actionIndex, and no card in the output; fold-to-call flips counted fixed, a change away from an ok call counted newly wrong, the Replay row text; a flagged fold the base arm does not reproduce is unjudged; fourteen malformed rows refused with their reasons and five inputs that throw; the CLI (`--emit-nodes`, `--row`, exit 1 on a row it cannot place, refusal without `--plo6-meta`).
