# 2026-11-07 - Cutover recovery: owner windows for the stranded 04:00 release

## Owner order

Dan, in Claude chat `session_01UxDLnKRaCYBasWqqZVp55Y`, 2026-11-07 06:51
America/Chicago, verbatim:

> "DID THE ENGINE SUCCESSFULLY CHANGE OVER AND UPDATE? ARE WE RUNNING THE
> NEWEST VERSION FROM THE 4AM CUT OVER? IF NOT TAKE OVER AND FINISH UP ANY AND
> ALL TASKS AND THINGS THAT NEED TO BE COMPLETED TO INSURE THAT IT IS 100%
> COMPLETED. YOU ARE AUTHORIZED TO DO A CUT OVER ANYTIME YOU NEED TO IF ITS
> NOT 100% UPDATED WITH THE 1:1 CLONE BACK UP AS WELL."

This is a later explicit owner instruction (CLAUDE.md: "Later owner
instructions govern operating authority") and is the authority recorded in
each new window's `ownerOrder`.

## State at 06:51 Chicago

- Production engine: `92e26a9f` (sealed 2026-11-06 14:02Z). Leader heartbeat
  healthy; no cutover happened at today's 04:00 window.
- Engine Release run 42360536751 refused target `e6e26ab8` at 09:52Z:
  production lacks `fn_cash_session_set_blind_off()`,
  `fn_lightning_blind_off_players()` (both created by queued
  `20261106203853_hit_and_run_ten_hands_in_profit.sql`). The release-order
  deadlock itself was fixed the same morning
  (`docs/changelog/2026-11-07-release-door-window-order.md`).
- The daily window install (run 42361241341) confirmed the freeze at
  10:00:02Z and stopped on its FIRST queued file (`20261106004812`, 55P03
  lock timeout from a needless `DROP TRIGGER IF EXISTS` since removed from
  that file on main), so every queued window migration stayed queued.
- `server/scripts/engine-release-window-doors.py list` on main names three
  doors the target engine calls that are missing from production pg_proc:
  `fn_cash_session_set_blind_off`, `fn_lightning_blind_off_players`
  (`20261106203853`) and `fn_horse_exact_profiles_read` (`20261106091733`).

## What this change adds (data only; no code, no schedule, no new publisher)

Three entries in `server/release/owner-maintenance-windows.json`, plus the
matching one-time activation floor:

1. `databaseWindows`: `2026-11-07-cutover-recovery-db-hit-and-run` - one
   reviewed database-only maintenance operation installing exactly
   `20261106203853_hit_and_run_ten_hands_in_profit.sql` inside a certified
   Deployment Recovery freeze (existing
   `scripts/ci/database-maintenance-window.py` route; one migration per
   operation is that route's own rule).
2. `databaseWindows`: `2026-11-07-cutover-recovery-db-horse-exact-profiles` -
   the same, for `20261106091733_horse_public_memory_exact_rule_domains.sql`,
   dispatched only after the first completes (rolling-hour reservation
   spacing respected).
3. `windows`: `2026-11-07-cutover-recovery-engine-release-1445z` - one
   earliest-certified off-cycle engine activation, 14:45Z-20:45Z, of a
   Backup-Engine-certified target containing
   `f7c2804e81b89e69c4f3fb82ab6c4413dffdaf28`, dispatched only after both
   database windows have installed the missing doors. Every existing guard is
   unchanged (Backup certificate for the exact version, hand-boundary drain,
   durable freeze/certificate, proof and rollback reserve, SEALED, v3 thaw,
   fresh Backup copy after sealing).

`server/release/activation-floor.json` moves from the expired
`2026-11-05-cash-styles-and-deal-timing-2045z` floor to the new window; the
window's `releaseWitness` binds the new manifest's exact bytes.

The remaining queued window migrations (`20261024020328`, `20261106004812`,
`20261107020241`, `20261107040516`, `20261107041342`) create no door the
target engine calls; they install at the next daily 04:00 window as usual,
now that `20261106004812`'s lock-timeout defect is fixed on main.
