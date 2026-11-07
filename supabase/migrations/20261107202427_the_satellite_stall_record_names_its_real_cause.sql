-- 20261107202427_the_satellite_stall_record_names_its_real_cause
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 20:24:27 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
--
-- THE SATELLITE STALL RECORD NAMES ITS REAL CAUSE (2026-11-07).
--
-- Drift incident e209b988-99a0-4011-b416-991c77f7865e (Sunday Deep Stack
-- Satellite 30, cc250e58, dark 02:34:56Z..04:05Z on 2026-11-07) was resolved
-- with a root cause blaming F06 seat movement: "the affected tables held
-- engines admitted for F06 seat movement ... cleared on its own as the F06
-- movement operations completed". The evidence says otherwise:
--   * smarter_private.f06_movement_admissions holds 0 rows for cc250e58 (the
--     newest row in the whole table is 2026-11-04 08:14Z), and
--     installF06MovementAdmission needs one, so no engine of this event was
--     movement-admitted;
--   * its 4 f06_operations rows were created at 04:40, 05:14, 05:30 and 05:50Z,
--     all after dealing resumed at 04:05Z - ordinary end-of-night consolidation.
-- The real cause is the satellite qualifier boundary, as #9814 (39e11dfce5d)
-- states for this exact event: fn_get_satellite_qualifier_state answered
-- entry_open on every sweep, yet the sweep walked every table through the
-- two-phase park, where a retained original the boundary itself forbade
-- starting answered pending forever; the rebuilt manager re-held the boundary
-- and recreated the same signature. #9814 releases the boundary on the first
-- authoritative read when it is not needed and is serving in production
-- (engine 40bc2467, verified 2026-11-07 20:20Z). The superseded text is kept in
-- metadata, so nothing is destroyed; status, resolved_at and closure_basis are
-- not touched.
--
-- @live-proof: (SELECT root_cause LIKE 'Satellite qualifier boundary%' AND metadata ? 'superseded_root_cause' FROM public.ca_drift_incidents WHERE id='e209b988-99a0-4011-b416-991c77f7865e')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $cause$
DECLARE n integer;
BEGIN
  UPDATE public.ca_drift_incidents d
     SET metadata = d.metadata || jsonb_build_object('superseded_root_cause', d.root_cause,
                                                     'root_cause_corrected_by', '20261107202427'),
         root_cause = 'Satellite qualifier boundary, not F06 movement (corrected 2026-11-07 by 20261107202427). '
           || 'A bust held the cohort satellite''s qualifier boundary and parked every table for terminal closeout; '
           || 'fn_get_satellite_qualifier_state answered entry_open, but the sweep still walked every table through the '
           || 'two-phase park, where table c5135a8e held a reserved original hand (permit attempted) the boundary itself '
           || 'forbade starting, which answered pending forever - a circular wait. The zombie rebuild re-held the boundary '
           || 'on adoption and recreated the same signature. No F06 movement admission existed for this event '
           || '(f06_movement_admissions: 0 rows; its f06_operations were all created after 04:05Z). Fixed by #9814 '
           || '(39e11dfce5d): the boundary is released on the first authoritative read when it is not needed; serving in '
           || 'engine 40bc2467.'
   WHERE d.id = 'e209b988-99a0-4011-b416-991c77f7865e'
     AND md5(d.root_cause) = '751c019e6f465c786d1475be923aa9ae'
     AND NOT (d.metadata ? 'superseded_root_cause');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n NOT IN (0, 1) OR (SELECT root_cause NOT LIKE 'Satellite qualifier boundary%' FROM public.ca_drift_incidents
                          WHERE id = 'e209b988-99a0-4011-b416-991c77f7865e') THEN
    RAISE EXCEPTION 'SATELLITE_CAUSE_NOT_CORRECTED' USING ERRCODE = '55000';
  END IF;
END $cause$;

COMMIT;
