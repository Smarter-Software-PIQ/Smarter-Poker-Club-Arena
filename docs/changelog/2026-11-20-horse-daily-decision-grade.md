# 2026-11-20 - Daily real-card Horse decision grade (read-only report)

Since about 1:12 PM Chicago on 2026-11-20 every Horse's dealt hole cards are
kept for every hand (the private Horse dealt-cards table, #11511). This
adds the daily report built on them: where Horses lose chips to people, by spot
class. It changes no engine code, no option, no registry and no migration.

- `server/scripts/horse-daily-decision-grade.ts` - the CLI. `--sql` prints the
  bounded SELECTs; `--api` runs them through the Supabase management API with
  `read_only: true` (`SUPABASE_ACCESS_TOKEN` from the environment, the path
  `scripts/ops/cash-room-realism-report.mjs --api` uses); `--from-json` grades
  saved results. Default window: the last 24 hours; a bare time is Chicago.
  It writes the markdown report and an aggregate JSON next to it, and compares
  against the previous report when one exists.
- `server/src/benchmark/HorseDailyDecisionGrade.ts` - the pure grading, with
  its unit test. Hand classes, draws and all-in equity come from the engine's
  own helpers (HorseEval, InsuranceEquity).

What it grades: every Horse decision facing a person's wager and every unopened
Horse bet with a person live, in hands with a person dealt in; cash (PLO4,
PLO5, PLO6, NLH; Lightning pools and tables kept apart) and tournaments as a
separate section. A fold is the forgone call EV on real cards; a call, raise or
bet is its realised result from the decision point; anything not knowable is
counted as ungraded with its reason. A class is flagged only when its mean is
beyond 1 SE (clustered by hand) at n >= 10, and every table is repeated with
the most frequent person excluded.

Owner rule kept (2026-11-13): a person's cards are read only where that person
showed them at showdown; the statement filters them inside the database, and
`ca_hand_facts.hole_cards` is never read. So a heads-up fold to a person is
never graded: the report counts those, it does not estimate them. Output is
aggregate: no hole card, no hand id, table aliases only.
