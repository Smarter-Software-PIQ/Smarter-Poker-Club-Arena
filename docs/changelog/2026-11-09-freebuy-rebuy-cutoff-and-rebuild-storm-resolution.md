# 2026-11-09 — Free Buy Rebuy Cutoff Parity & Post-Rebuild Storm Incident Resolution

## Root Causes

1. **Rebuy Cutoff Level Parity When Stripping Repeated Opening Blind Levels (`20261108212837`):**
   - `fn_ca_schedule_level_clock_floor()` and `fn_ca_tournament_level_clock_floor()` stripped repeated opening blind levels (`25/50` repeated twice -> 39 levels) and stepped down `lateRegistrationLevels` / `NEW.late_reg_levels` (`12 -> 11`) via `fn_ca_repeated_levels_late_reg(...)` without stepping down `rebuyLevels` / `NEW.rebuy_levels` (`12`) when `rebuy_levels` equaled `late_reg_levels` prior to stripping.
   - As a result, 56 active Midway schedules (`5` Free Buy + `51` `< 25` chip schedules) and 83 unstarted `REGISTERING` tournaments (`15` Free Buy + `68` `< 25` chip events) had `late_reg_levels = 11` and `rebuy_levels = 12`, causing `auditFreeBuyRow` (`server/src/services/FreeBuy.ts:966`) to raise warning `financial_alerts` row `cd9f260e-acff-4526-bbee-71c89671e8b1` (`"the rebuy period and late registration do not close together"`).

2. **Capped Post-Rebuild Dark-Tournament Storm Incident (`b4175ad4-a1bd-42bd-b5e1-3a060809ce60`):**
   - `public.ca_drift_incidents` row `b4175ad4-a1bd-42bd-b5e1-3a060809ce60` (`source = 'financial_alerts:GameServer.tournament_dark_after_rebuild'`, `dedupe_key = 'storm:financial_alerts:GameServer.tournament_dark_after_rebuild'`, `occurrences = 5`) remained `open` even though all 5 of its versioned `recurred` events in `public.ca_incident_events` pointed to resolved `GameServer.tournament_dark_after_rebuild` alerts (`071414c4`, `137e4695`, `d52ebc03`, `db7419f6`, `e36abb6a`), because `fn_ca_alert_resolution_reaches_the_incident()` only handled `Tournament.atomic_finish_refused` and `fn_ca_bust_backlog_page`.

## Permanent Fixes

- **`supabase/migrations/20261109212210_freebuy_rebuy_cutoff_and_rebuild_storm_resolution.sql` & `supabase/migrations/20261110000927_freebuy_watch_jsonb_array_length_and_audit_resolution.sql`:**
  - Updated `fn_ca_schedule_level_clock_floor()` and `fn_ca_tournament_level_clock_floor()` to step down `rebuyLevels` / `NEW.rebuy_levels` whenever `rebuy_levels` matched `late_reg_levels` prior to stripping repeated opening blind levels, while preserving `rebuy_levels = 12` on `>= 25` chip events (`late_reg_levels = 9`).
  - Backfilled the 56 active schedules (`WHERE active = true`) and 83 unstarted `REGISTERING` tournaments (`late_reg_levels = 11, rebuy_levels = 11`), added `fn_ca_free_buy_transition_audit_guard()` checking `coalesce(jsonb_array_length(public.fn_sp_midway_free_buy_watch()), 0)`, and resolved `TournamentRecurring.freeBuyAudit` alert `cd9f260e-acff-4526-bbee-71c89671e8b1`.
  - Patched `fn_ca_alert_resolution_reaches_the_incident()` to include `'GameServer.tournament_dark_after_rebuild'` and closed `b4175ad4-a1bd-42bd-b5e1-3a060809ce60` after verifying all 5 exact member alerts are resolved.
- **`server/src/services/FreeBuy.ts` & `server/src/services/FreeBuy.test.ts`:**
  - Added `FREE_BUY_REPEATED_LEVEL_TRANSITION_FROM_MS` / `FREE_BUY_REPEATED_LEVEL_TRANSITION_TO_MS` for the 5 immutable already-started Nov 8–9 transition occurrences (`2026-11-08T22:30:00Z`..`2026-11-09T18:30:00Z`) and added unit and law test coverage.
