-- 20261121005200_certification_club_retirement_removes_its_notice_access_proj.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT WAS WRONG, READ FROM ROWS (2026-11-21 00:46 UTC):
--
--   The Cert Residue Sweep run 44846022061 recovered 13 stale identities and
--   then failed on stale certification club 67f8f585 (Preset Crest Cert
--   179495002644) with
--     23503 update or delete on table "clubs" violates foreign key constraint
--     "club_notice_access_events_club_id_fkey" on table
--     "club_notice_access_events"
--   from public.fn_ca_retire_certification_club. The club has no tables, no
--   tournaments, no agents and one zero-balance certification member: the
--   only thing holding it is one club_notice_access_events row (owner,
--   can_access true, written 2026-11-17 21:13 UTC by
--   fn_publish_club_notice_access).
--
--   club_notice_access_events is a per-(club, user) projection of who may read
--   a club's notices. It is not history: it is upserted in place and carries
--   only the current role. Its foreign key to clubs is NO ACTION, and the
--   retirement door deletes the club without removing it, so EVERY
--   certification club created since that projection began writing rows is
--   undeletable by this door. Deleting the members first does not help: their
--   removal re-publishes the row while the club still exists.
--
-- THE FIX (the line that produced the refusal is the line changed):
--
--   Immediately before DELETE FROM public.clubs, after the members and the
--   events are gone, the door deletes the club's notice-access projection
--   rows. Nothing else in the door changes: every proof (protected ids, name,
--   no union, no tables/tournaments/agents, only certification members, no
--   chips) still runs first and still refuses exactly as before.
--
-- Not a hot-table lock: this replaces one function body. Changing the foreign
-- key to ON DELETE CASCADE would take SHARE ROW EXCLUSIVE on public.clubs and
-- would belong in the daily window; this door is the only code that deletes a
-- club, so the root is the door.
--
-- Preimage: the function as installed live (md5 below, read 2026-11-21). A
-- function changed since then is a different decision; refuse.
-- Pinned by tests/unit/certificationClubRetirementNoticeAccess.test.ts.
--
-- @live-proof: position('DELETE FROM public.club_notice_access_events WHERE club_id = p_club_id' IN pg_get_functiondef('public.fn_ca_retire_certification_club(uuid,text)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '60s';

DO $door$
DECLARE
  c_old constant text :=
       E'  GET DIAGNOSTICS v_ev = ROW_COUNT;\n'
    || E'\n'
    || E'  DELETE FROM public.clubs WHERE id = p_club_id;\n';
  c_new constant text :=
       E'  GET DIAGNOSTICS v_ev = ROW_COUNT;\n'
    || E'\n'
    || E'  -- The notice-access projection is current state, not history, and its\n'
    || E'  -- foreign key would refuse the club delete (20261121005200).\n'
    || E'  DELETE FROM public.club_notice_access_events WHERE club_id = p_club_id;\n'
    || E'\n'
    || E'  DELETE FROM public.clubs WHERE id = p_club_id;\n';
  v_def text := pg_get_functiondef('public.fn_ca_retire_certification_club(uuid,text)'::regprocedure);
BEGIN
  IF md5(v_def) IS DISTINCT FROM 'd31f4bfb33269140ffbf10e26ff7235c' THEN
    RAISE EXCEPTION 'CERTIFICATION_CLUB_NOTICE_ACCESS_PREIMAGE_CHANGED';
  END IF;
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'CERTIFICATION_CLUB_NOTICE_ACCESS_PATCH_MISMATCH';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
  IF position('DELETE FROM public.club_notice_access_events WHERE club_id = p_club_id' IN
       pg_get_functiondef('public.fn_ca_retire_certification_club(uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'CERTIFICATION_CLUB_NOTICE_ACCESS_INSTALL_MISMATCH';
  END IF;
END
$door$;

-- The patched door runs once on a stale certification club of exactly the
-- refused shape (no tables, tournaments, agents or welcome package; a notice
-- access row) and must succeed; the subtransaction is always undone. A foreign
-- key refusal is not a raise_exception, so it aborts this migration. With no
-- such club left it still executes the new body on an absent id.
-- @probe-for: public.fn_ca_retire_certification_club
DO $probe$
DECLARE
  v_id uuid;
  v_res jsonb;
BEGIN
  SELECT c.id INTO v_id
    FROM public.clubs c
   WHERE (c.name LIKE 'Crest Cert %' OR c.name LIKE 'Preset Crest Cert %')
     AND c.lifecycle_status IS DISTINCT FROM 'retired'
     AND c.union_id IS NULL
     AND c.created_at < now() - interval '3 hours'
     AND EXISTS (SELECT 1 FROM public.club_notice_access_events e WHERE e.club_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM public.tables t WHERE t.club_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.club_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM public.agents a WHERE a.club_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM public.club_welcome_entitlements w WHERE w.club_id = c.id)
     AND NOT EXISTS (
       SELECT 1 FROM public.club_members m LEFT JOIN auth.users u ON u.id = m.user_id
        WHERE m.club_id = c.id
          AND (COALESCE(m.chip_balance, 0) <> 0 OR COALESCE(m.promo_balance, 0) <> 0
               OR NOT (COALESCE(u.email, '') LIKE '%@smarter-poker.invalid'
                       OR COALESCE(u.email, '') LIKE 'ca-customization-cert-postdeploy-%@example.invalid')))
   ORDER BY c.created_at
   LIMIT 1;
  v_res := public.fn_ca_retire_certification_club(COALESCE(v_id, gen_random_uuid()), 'migration-probe');
  IF v_id IS NOT NULL AND (v_res->>'success') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'CERTIFICATION_CLUB_NOTICE_ACCESS_PROBE_REFUSED %', v_res USING ERRCODE = 'P0002';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
