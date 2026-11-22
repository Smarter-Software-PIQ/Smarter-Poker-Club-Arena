# The daily digest carries the Horse option shadow scoreboard

An option in `shadow` or `on_shadow` is re-decided once, off the acted path, with that one option flipped
(`HorseOptionShadow.ts`), and each re-decision fires `option_shadow_<option>_{changed,same}[_person]_seen`. The only
reader was `scripts/sql/horse-option-shadow-summary.sql` with hand-edited dates, so a live measurement was seen only
when a lane remembered to run it.

- `public.fn_sp_digest_horse_option_shadow(p_day)`: per option that is in shadow / on_shadow now, or has counters on
  the day: current state, re-decisions, changed count and rate, person-present vs Horse-only split; plus the day's
  re-decision skips (budget, rate, backlog, scale, rotation, failures), the latency guard's cost. Read-only,
  service_role only.
- `fn_sp_daily_digest` returns it under `horse_option_shadow` (anchored after `felt_latency`, exactly once; an
  unmatched anchor refuses the install).
- Proof: `scripts/ci/test-horse-option-shadow-scoreboard-postgres.py` on a throwaway PostgreSQL 17 (13 checks),
  workflow `the-digest-carries-the-horse-option-shadow-scoreboard.yml`. The function body was also run read-only
  against production (empty today: no option is in shadow yet).
- Re-timed 2026-11-21: the migration is now `20261121175912_horse_option_shadow_scoreboard_in_the_daily_digest.sql`
  (was `20261121002048`), reserved by `scripts/reserve-migration-version.sh`. `Migration Ledger Is Reconciled`
  fails main when a merged migration whose version is older than 24 h is not installed, and this branch is held.
  Content unchanged; `fn_sp_daily_digest` is edited by an anchor on its live definition, and its last change on
  main (`20261120000047`) predates the branch, so nothing from main is overwritten.
