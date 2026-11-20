# The replay scorer reads the PLO6 audit set (2026-11-20)

No option, no migration, no decision change in production. Nothing is switched. Benchmark library, its CLI, tests and documents only. No database was read or written.

ASSUMPTION, stated first because the rest stands on it. The PLO6 audit set is HVH48 auditor C (archive `plo-handoff-review-01a1cbbd/hvh48-audit-01TLQer7J/C-plo6`: REPORT.md and decisions.csv). The repository records that the set exists, that a decision in it has an id ("d2690") and sits at one action ordinal of an extracted hand (`server/src/engine/Plo6FacingBetIsPriced.fixture.json`), and its flag words (POTODDS-FOLD, ALLIN-FOLD-PRICED; CLEAR, LIKELY). It does not record the column layout of the auditor's decisions.csv, and the archive is not readable from the session that wrote this. The adapter therefore reads a declared minimal layout, written down below and in `docs/horse-option-authority.d/README.md`, and not a guessed copy of the auditor's file. If the auditor's file names its columns otherwise, these columns are exported from it before the run. The PLO lead confirms or corrects the layout against the archive.

## Why

`docs/horse-option-authority.d/plo6FacingBetIsPriced.md` recorded its Replay row as NOT RUN because the committed scorer (`server/scripts/audited-decision-replay.ts`) read the audit2 and WooWoo sets only. A PLO6 option could not record a scorer-written row at all, so it could never meet the bar of `EveryHorseOptionRecordsItsReplay.law.test.ts`.

## What changed

1. `server/src/benchmark/AuditedDecisionReplay.ts`: `plo6Decisions(decisionsCsv, handsJsonl)` and the source `plo6` (`AuditSource`).
   - Decisions CSV, header required: `id` (the audit's decision id), `hand` (hand number), `ord` (the action ordinal of the decision in the extracted hand), `verdict`. Optional: `seat`, `street`, `action` (each must equal the action at `ord`), `flag` (the audit's class, kept as the finding). Other columns are ignored.
   - `verdict`: `CLEAR` or `LIKELY` is bad, `OK` is ok, empty is unjudged. An unflagged decision is not ok by default; only the audit's own judgement makes a row `OK`.
   - Hands JSONL: one extracted hand per line as `HorseComplaintReplay` reads it (the hand, or `{"hand": {...}}`). Read: `handNumber`, `variant`, `actions[].{ord, seat, stage, origin, action, amount}`.
   - The node is (hand, seat, street, k), k counted as audit2 counts it: the seat's own voluntary `horse_policy` decisions on that street, in the hand's action order.
   - Scoring is the existing verdict-only rule (the WooWoo rule, unchanged): a change away from a bad action is fixed, away from an ok action newly wrong, a change at an unjudged decision or where the base arm does not reproduce the recorded action is unjudged. No bb is claimed: the auditor's pricing is not ported.
   - Refused, listed with the reason and never placed at a neighbour: a hand absent from the hands file, a hand that is not PLO6, a hand whose actions lack a whole-number `ord`, an `ord` that is not a whole number or names no action, an action that is not a voluntary Horse decision (a person's action, a pre-action, a blind), a seat, street or action that disagrees with the hand, a verdict word outside the four, an empty id, a node named twice. A header without the four columns, a hand given twice and a row with the wrong field count throw.
   - Privacy: no card is read or kept. Hole cards and boards in the hands file never enter a decision, a node, a report or a Replay row; the tests assert it on synthetic six-card hands and on the committed fixture.
2. `server/scripts/audited-decision-replay.ts`: `--plo6 <decisions.csv> --plo6-hands <hands.jsonl>`, alone or beside `--audit2` and `--woowoo`. A PLO6 row that cannot be placed exits 1, as an audit2 row does. `--emit-nodes` adds the audit's `id` and `ord` to each PLO6 node so the harness finds the action. The Replay row is the existing row with `source plo6 verdict-only`.
3. `docs/horse-option-authority.d/README.md` states the layout; `plo6FacingBetIsPriced.md` keeps `Replay: NOT RUN` with the new reason and the steps that produce the row.

## What is NOT done

- The real Replay row is not written. The audit set and the auditor's harness (`hvhC_replay.ts`) are in the evidence archive. `plo6FacingBetIsPriced` stays Evidence NOT MET and OFF.
- The auditor's harness does not yet write the scorer's replay rows (one line per node with the arms, and the declared option sets). That change is made in the archive, beside the harness.
- The auditor's pricing (equity against the price, the loss in bb) is not ported as a judge, so the PLO6 row carries no bb and a change at an unflagged decision is unjudged unless the audit marked that decision `OK`. The option's PASS-BAR has to say what it accepts for the unjudged count; the build bar alone (newlyWrong not above fixed) does not read it.
- `omahaStrategyInPlo6` is not touched.

## The command (from server/, on the machine that holds the archive)

```
C=<archive>/plo-handoff-review-01a1cbbd/hvh48-audit-01TLQer7J/C-plo6
npx tsx scripts/audited-decision-replay.ts --plo6 $C/decisions.csv --plo6-hands $C/hands.jsonl --emit-nodes plo6-nodes.jsonl
# the harness re-decides each node, off and on, one file per seed (1, 7, 42)
npx tsx scripts/audited-decision-replay.ts --plo6 $C/decisions.csv --plo6-hands $C/hands.jsonl \
  --replay plo6-replay-seed1.jsonl --line on --row on --set "HVH48 auditor C PLO6 seed 1"
```

`hands.jsonl` stands for the audit's extracted hands, one per line; the file name in the archive is not recorded in the repository. The scorer commit in the row is read from git, so the run is made on a checkout where the two scorer files are committed.

## Tests

`server/src/benchmark/AuditedDecisionReplay.test.ts`, six new cases on synthetic six-card hands: placement by ordinal and k; fold-to-call flips counted fixed, a change away from an `OK` call counted newly wrong, the Replay row text; a flagged fold the base arm does not reproduce is unjudged; thirteen malformed rows refused with their reasons and four inputs that throw; the twelve committed fixture decisions placed at their nodes; the CLI (`--emit-nodes`, `--row`, exit 1 on a row it cannot place).
