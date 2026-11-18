# HorseBrainVariantSilent plo8, row 376529 (2026-11-11)

Read from production on 2026-11-11 at 04:45 UTC.

- Row 376529, alertmanager, `HorseBrainVariantSilent{variant="plo8"}`, firing, startsAt 04:32:38 UTC.
- `hand_history` with `game_variant = 'plo8'` after 02:30 UTC: five tables, all of them
  tournament `f2c99684` ("PLO8 Hi-Lo Turbo"). The last hand was at 04:02:15 on Table 2.
- `tournaments.f2c99684`: status `COMPLETED`, ended_at 04:02:18.416 UTC. All five tables are
  `closed`, with 0 seats open.
- flo8 kept dealing on 2 tables through 04:40, so the engine and the horse lane were healthy.

**Cause**: the rule is
`rate(decisions[1h] offset 15m) * 60 > 5 unless rate(decisions[15m]) > 0`.
It has no way to know whether the variant still has a table, so the normal end of the only
event in a variant reads as "decisions stopped". The source inventory counts 29 firings.
Every recent one resolved by itself once the 1 h window drained, and was classified as
`informational`.

**Fix, in two steps** (`check-alert-rules-match.mjs` refuses a rule that reads a metric the
running engine does not emit):

1. This PR: the engine emits `poker_tables_with_horses_by_variant{variant}`, seeded at 0 for
   every ledger variant. It uses the same label function as `poker_horse_policy_decisions_total`.
2. After an engine at or past this PR is serving: add
   `and on(variant) min_over_time(poker_tables_with_horses_by_variant[15m]) > 0` to
   `HorseBrainVariantSilent` in `infra/monitoring/alert-rules.yml`.

Regression: `server/src/engine/HorsePolicyLedgerObserver.test.ts`, block
`poker_tables_with_horses_by_variant`. On origin/main it fails 4 of 4 tests
(`countHorseTablesByVariant is not a function`). With this change it passes 11 of 11.
