-- 20261118164804_a_stalled_tables_late_resolution_is_proved_by_re_measuring.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A STALLED TABLE'S LATE RESOLUTION IS PROVED BY RE-MEASURING (TableStoppedDealing,
-- 2026-11-18)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, read-only, 2026-11-18 ~16:45 UTC)
--
-- Eleven TableStoppedDealing incidents (ca-stall-watch) opened 2026-11-14 to
-- 2026-11-16 sat stale_unverified with escalation 'escalated'; the digest
-- counted them "0 of 7 verified fixed". Every one is over: its tournament is
-- COMPLETED, its table is closed, and every member of every one is 'resolved' -
-- ca-stall-watch resolved each inbox row in place (the last at 2026-11-18
-- 06:34:12 UTC, after #11220 taught it that a finished tournament's table
-- resolves its stall). The controller had already aged them to stale_unverified
-- (24 h with no firing and no resolve), and a resolve that reaches a STALE
-- incident moves it to verifying only when
-- smarter_private.reliability_proved_source_resolution proves it. That proof is
-- an allowlist of three sources (owner-operational-notifications,
-- sp-critical-pager, sp-daily-digest); ca-stall-watch is not on it, so a
-- stalled table's resolution could never be proved, whatever the floor said.
--
-- THE FIX
--
-- 1. The proof accepts ca-stall-watch TableStoppedDealing on the same terms as
--    every other source (same-episode in-place resolve, every member resolved,
--    received after the last firing) PLUS a re-measurement the stall watch's
--    own claim rests on: the table is no longer open (closed, deleted, or not
--    waiting/running), or it has dealt a hand since the member last fired.
--    Pinned substitution: preimage be21d58b..., one anchor for the source list,
--    one for the proof branch.
-- 2. Resolutions intake already received before this correction are admitted
--    under the same proof, as 20261117231509 admitted its own: each proved
--    stale incident goes to verifying through reliability_transition, which
--    re-checks the proof, and the controller's quiet window then recovers it.
--    Read-only check on 2026-11-18: the proof holds for all 11 stale incidents
--    and for all 33 TableStoppedDealing incidents already recovered.
--
-- No money moves. No table, seat or tournament row is written by this file.
--
-- @live-proof: position('ca-stall-watch' in pg_get_functiondef('smarter_private.reliability_proved_source_resolution(uuid)'::regprocedure)) > 0 AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_incidents i WHERE i.status = 'stale_unverified' AND i.source = 'ca-stall-watch' AND smarter_private.reliability_proved_source_resolution(i.id))

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- The pinned-text substitution (the form 20261118073646 uses). Already the
-- postimage (applied before merge, or a re-run): a no-op, never a refusal.
CREATE FUNCTION pg_temp.lane_a_subst(p_sig text, p_before text, p_after text,
                                     p_old text[], p_new text[])
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer; i integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  IF md5(v_def) = p_after THEN
    RAISE NOTICE '%: already the postimage, nothing to do', p_sig;
    RETURN;
  END IF;
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned text (md5 %)', p_sig, md5(v_def);
  END IF;
  IF array_length(p_old, 1) IS DISTINCT FROM array_length(p_new, 1) THEN
    RAISE EXCEPTION '%: anchors and replacements do not pair', p_sig;
  END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(p_old, 1) LOOP
    v_n := (length(v_new) - length(replace(v_new, p_old[i], ''))) / length(p_old[i]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: anchor % occurs % times, expected exactly 1', p_sig, i, v_n;
    END IF;
    v_new := replace(v_new, p_old[i], p_new[i]);
  END LOOP;
  IF md5(v_new) <> p_after THEN
    RAISE EXCEPTION '%: substituted text is not the derived postimage (md5 %)', p_sig, md5(v_new);
  END IF;
  SELECT p.proacl::text, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = p_sig::regprocedure;
  EXECUTE v_new;
  IF md5(pg_get_functiondef(p_sig::regprocedure)) <> p_after THEN
    RAISE EXCEPTION '%: the replaced function does not read back as the postimage', p_sig;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = p_sig::regprocedure
                    AND p.proacl::text IS NOT DISTINCT FROM v_acl
                    AND pg_get_userbyid(p.proowner) = v_owner
                    AND p.prosecdef = v_secdef
                    AND p.proconfig IS NOT DISTINCT FROM v_cfg) THEN
    RAISE EXCEPTION '%: owner, security, settings or grants moved', p_sig;
  END IF;
END $h$;

SELECT pg_temp.lane_a_subst(
  'smarter_private.reliability_proved_source_resolution(uuid)',
  'be21d58b5126b212b4499f3e216cec2a', 'bb4e07bc55faff6411be487d464ba1be',
  ARRAY[$o1$i.source IN ('owner-operational-notifications','sp-critical-pager','sp-daily-digest')$o1$, $o2$                 ELSE false END))));
$o2$],
  ARRAY[$n1$i.source IN ('owner-operational-notifications','sp-critical-pager','sp-daily-digest','ca-stall-watch')$n1$, $n2$                 ELSE false END)
           -- A STALLED TABLE (20261118164804): proved by re-measuring the table the
           -- stall watch named - no longer open, or dealing again since it fired.
           OR (e.source='ca-stall-watch' AND e.alertname='TableStoppedDealing'
               AND pg_input_is_valid(e.payload->>'table_id','uuid')
               AND (NOT EXISTS (SELECT 1 FROM public.tables tb
                     WHERE tb.id=(e.payload->>'table_id')::uuid AND coalesce(tb.lifecycle,'')<>'closed'
                       AND tb.status IN ('waiting','running','active') AND NOT coalesce(tb.is_deleted,false))
                 OR EXISTS (SELECT 1 FROM public.hand_history h
                     WHERE h.table_id=(e.payload->>'table_id')::uuid AND h.created_at>m.last_firing_at))))));
$n2$]);

-- 2. Admit the resolutions intake already received, under the same proof.
DO $received_stall_resolutions$
DECLARE r record;
BEGIN
 FOR r IN SELECT i.id FROM smarter_private.reliability_incidents i
   WHERE i.status = 'stale_unverified' AND i.source = 'ca-stall-watch'
     AND smarter_private.reliability_proved_source_resolution(i.id)
   ORDER BY i.id FOR UPDATE OF i
 LOOP
   PERFORM smarter_private.reliability_transition(r.id, 'verifying',
     'the stalled table''s same-episode resolution is proved by re-measuring the table',
     jsonb_build_object('kind', 'resolved_signal', 'basis', 'proved_stall_resolution_remeasured'));
 END LOOP;
END $received_stall_resolutions$;

COMMIT;
