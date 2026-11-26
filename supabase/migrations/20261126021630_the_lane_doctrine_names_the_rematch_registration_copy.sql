-- 20261126021630_the_lane_doctrine_names_the_rematch_registration_copy.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE LANE DOCTRINE NAMES THE REMATCH REGISTRATION COPY (2026-11-25).
--
-- WHAT BROKE. Since 2026-11-26 02:04:30 UTC the check "The lane doctrine holds
-- on the live catalog" has failed on every pull request and on main:
--   a_late_registration_shares_its_event_lane: fn_ca_rematch_register_for_payer,
--   fn_register_for_tournament, ... (the five doors)
--
-- WHY. Rule 7 of public.fn_ca_settlement_lane_doctrine() (20261119052513) pins
-- the callers of public.fn_ca_lock_tournament_registration_acquisition to
-- exactly the five registration doors. 20261126000707 re-derived the heads-up
-- rematch's named-payer copy of fn_register_for_tournament from its installed
-- source, so the copy now calls that gate exactly as its source does. That is
-- the copy following its source, which is the point of that migration; the
-- caller set gained a sixth reviewed name and the doctrine was not told.
-- I checked the rematch's own law, its certification and the definer and probe
-- gates before shipping it, and not this one: it reads the live catalog, so it
-- cannot fail before install.
--
-- IT IS THE SAME LANE. 20261119052513 states the gate's contract: for anything
-- but a RUNNING mtt event, and for "a caller already holding G or T(id)
-- exclusive (satellite seat delivery, rematch, resume)", the gate "is exactly
-- the seat gate, unchanged". A rematch registers into a fresh REGISTERING
-- heads-up game, so the copy takes what it took before. Heads-Up Rematch
-- Certification run 45740149631 passed 17 of 17 on it at 02:09 UTC.
--
-- THE FIX. Rule 7's reviewed caller set gains fn_ca_rematch_register_for_payer.
-- Nothing else in the doctrine changes: the five doors are still forbidden the
-- seat gate, and the gate is still kept off every exclusive tournament key.
-- The function is patched from its installed text at one anchor that must
-- occur exactly once, against the md5 it was reviewed at, and must report no
-- violation before COMMIT.
--
-- No table is touched. The doctrine is a STABLE catalog reader.
--
-- The doctrine is replaced through EXECUTE, so no CREATE names it here; the
-- proof that production carries this change reads the installed body.
-- @live-proof: (position('fn_ca_rematch_register_for_payer,fn_register_for_tournament,fn_register_for_tournament_with_ticket' IN pg_get_functiondef('public.fn_ca_settlement_lane_doctrine()'::regprocedure)) > 0)

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_settlement_lane_doctrine()'::regprocedure);
  v_old constant text := $a$IF v_set IS DISTINCT FROM 'fn_register_for_tournament,fn_register_for_tournament_with_ticket,fn_register_horse_for_tournament,fn_register_horse_for_tournament_to_target,fn_seat_late_registrant'$a$;
  v_new constant text := $b$IF v_set IS DISTINCT FROM 'fn_ca_rematch_register_for_payer,fn_register_for_tournament,fn_register_for_tournament_with_ticket,fn_register_horse_for_tournament,fn_register_horse_for_tournament_to_target,fn_seat_late_registrant'$b$;
  v_count integer;
BEGIN
  IF position(v_new IN v_def) > 0 THEN
    RETURN; -- already installed: a replay changes nothing
  END IF;
  IF md5(v_def) IS DISTINCT FROM '217b2a2adab0c339ac48723a148d554c' THEN
    RAISE EXCEPTION 'LANE_DOCTRINE_REMATCH_COPY_PREIMAGE_CHANGED: fn_ca_settlement_lane_doctrine was edited since this change was qualified'
      USING ERRCODE = '55000';
  END IF;
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'LANE_DOCTRINE_REMATCH_COPY_ANCHOR: found % times, expected 1', v_count
      USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch$;

-- A file that names a pinned buy-in source and runs EXECUTE re-derives the
-- rematch copies (tests/heads-up-rematch-copies-follow-their-sources.law.test.ts).
-- Nothing changed, so nothing is re-pinned.
DO $rederive$
BEGIN
  PERFORM smarter_private.heads_up_rematch_rederive();
END
$rederive$;

-- @probe-for: public.fn_ca_settlement_lane_doctrine
DO $probe$
BEGIN
  PERFORM public.fn_ca_settlement_lane_doctrine();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

DO $verify$
DECLARE v_doc jsonb := public.fn_ca_settlement_lane_doctrine();
BEGIN
  IF COALESCE((v_doc->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'LANE_DOCTRINE_REMATCH_COPY: the doctrine still reports %', v_doc->'violations'
      USING ERRCODE = '55000';
  END IF;
  -- The five doors and the gate are still held to rule 7.
  IF position($c$p.prosrc ~ ('fn_ca_lock_tournament_seat_' || 'acquisition\s*\('))$c$
       IN pg_get_functiondef('public.fn_ca_settlement_lane_doctrine()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'LANE_DOCTRINE_REMATCH_COPY: rule 7 lost its seat-gate clause' USING ERRCODE = '55000';
  END IF;
END
$verify$;

COMMIT;
