# The Daily Audit Reports The Heads-Up League Cards

**Date:** 2026-11-13
**Migration:** `supabase/migrations/20261114003037_the_daily_audit_reports_the_heads_up_league_cards.sql`
**Native proof:** `scripts/ci/test-daily-audit-heads-up-league.py` via `.github/workflows/daily-audit-heads-up-league.yml`

## The gap

The nightly league writes one `horse_league_results` row per card. The daily
Horse audit reads those rows, but its league loop speaks only when a card is
broken: a negative verdict beyond two standard errors, illegal actions, a
truncated street, a refusal, zero hands. A heads-up card that stopped being
dealt, or one whose result moved without crossing that line, says nothing in
the audit. A heads-up regression showed only to someone who opened the league
table and read the `hu_` rows by hand.

## The change

Reporting only. No behaviour change, no new table or column, no new schedule,
no write.

1. `fn_audit_heads_up_league(p_day)` reads `horse_league_results` for the same
   league run the audit's own league loop reads (the newest `run_date` on or
   before `p_day + 1`) and returns findings in the shape every other audit
   section uses:
   - `league_heads_up_summary` (info): one line per card whose name starts
     with `hu_` or `human_hu_`: name, hands, bb100, stderr, status. The
     evidence also says which run it is and whether that run is the audited
     night's.
   - `league_heads_up_absent`: no heads-up card produced a row for the audited
     night (the newest run holds none, or the newest run is older than the
     audited day). The league rotates its card, so a single night without a
     heads-up card is expected now and then: the flag is info while a
     heads-up row exists within the last seven days and warn once none does.
   - `league_heads_up_section_failed` (warn): returned instead of raising if
     the section itself fails, so it can never take the nightly audit down.
2. `fn_run_horse_daily_audit` is edited surgically (read the live definition,
   insert after an anchor that must be present exactly once, refuse
   otherwise: the 20261107140000 and 20261110054654 pattern for this shared
   function). The new call sits right after the
   `fn_audit_horse_cash_rake_pace` line. That anchor line is kept, so the
   edit is identical whether or not 20261110054654 has installed, and
   20261110054654 still finds its anchor exactly once afterwards.

The seven-day line between info and warn is a reporting choice, not a
measured threshold. It changes no decision anywhere; it only sets how loudly
the audit says "no heads-up card lately".

## Proof

`scripts/ci/test-daily-audit-heads-up-league.py` runs the exact migration file
against a throwaway PostgreSQL 17 cluster (never production):

- fail-before: the pre-migration audit says nothing about heads-up with
  heads-up rows on the table, and the section function does not exist;
- the migration applies and its live proof holds;
- additive only: removing exactly the added lines from the new audit
  definition gives the old definition back, byte for byte, on both the plain
  shape and the shape that already carries the 20261110054654 wiring;
- exactly the names that start with `hu_` or `human_hu_` are listed, with
  their own hands, bb100, stderr and status (look-alikes such as
  `v16_hu_overlay_6max` and `hub_layer` are not);
- the absent flag: warn with no league rows at all, info for a night without
  a heads-up card inside seven days, warn beyond seven, and raised beside the
  summary when the league did not run for the night;
- read-only: no league row written, the function is STABLE, a re-run gives
  the same findings;
- browser roles cannot execute the section, service_role can;
- a second apply refuses and leaves the audit function unchanged;
- with the league table broken the audit still writes its day row and carries
  one warn finding.

Run locally on 2026-11-13 (PostgreSQL 17, macOS): all assertions passed.

## Not done here

Not applied to any database. The live `fn_run_horse_daily_audit` was not read
for this change: the anchor is the line migrations 20261107140000 and
20261110054654 both key on. If production does not carry that line exactly
once the migration refuses and changes nothing.

## Review change (REVIEW-HU-DAILY-AUDIT-6139a955, R1)

A refused row is not a card that ran. The retired `hu_break_even_bluff` writes
a refused, zero-hand row on every league run, which would have kept the
"no heads-up card" flag and its seven-day warning silent for good. The flag and
the last-run date now count only measured rows (not refused, hands above zero);
refused rows are still listed. The test gains that case.
