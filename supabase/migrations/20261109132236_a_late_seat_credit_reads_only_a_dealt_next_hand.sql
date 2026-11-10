-- 20261109132236_a_late_seat_credit_reads_only_a_dealt_next_hand.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A LATE SEAT CREDIT READS ONLY A DEALT NEXT HAND (2026-11-09)
--
-- #10138 sends the cash participant manifest (fn_cash_capture_hand_manifest)
-- under the next-hand rest, for the hand number the engine already holds. When
-- the roster changes after that request, the engine drops the number and deals
-- on a fresh one with its own manifest, because the database refuses a second,
-- different request for the same number. The dropped number keeps one
-- immutable manifest row that no hand, provenance receipt or outcome carries.
--
-- Every reader of cash_hand_participant_manifests reaches a row through an
-- accepted hand (a provenance receipt's manifest_id, or an accepted outcome's
-- own table and hand number), so it never meets that row - except one:
-- fn_union_pnl_prove_late_seat_credit looks for "the next hand this occupancy
-- was dealt" as the first manifest with a higher hand number holding the
-- occupancy. A manifest for a number that was never dealt is not a dealt hand,
-- and it could be picked ahead of the real next hand.
--
-- The fix: that lookup also requires the manifest to be the one an accepted
-- hand's provenance receipt names. Nothing else changes. Measured on
-- production before this change: all 85 existing late-seat resolutions name a
-- next hand whose manifest has exactly such a receipt, so every one re-proves
-- identically; no reader writes, and no row moves.
--
-- HOW: the pinned-preimage exact-substitution pattern of 20261015094418 (live
-- md5 read on production 2026-11-09; postimage derived read-only on
-- production with replace(); owner, security, settings and grants must not
-- move).
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_union_pnl_prove_late_seat_credit(uuid,bigint)'::regprocedure)) = '5648aa0c19755aeb7030666f74a1f5a4')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION pg_temp.ca_lock_subst(p_sig text, p_before text, p_after text,
                                       p_old text[], p_new text[])
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer; i integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
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

SELECT pg_temp.ca_lock_subst(
  'public.fn_union_pnl_prove_late_seat_credit(uuid,bigint)',
  'd3f0d6d189f378cab4446e2573792721', '5648aa0c19755aeb7030666f74a1f5a4',
  ARRAY[$o1$   WHERE mn.table_id=p_table_id AND mn.hand_number>p_hand_number AND pp.v->>'occupancy_id'=v_occ::text
   ORDER BY mn.hand_number LIMIT 1;$o1$],
  ARRAY[$n1$   WHERE mn.table_id=p_table_id AND mn.hand_number>p_hand_number AND pp.v->>'occupancy_id'=v_occ::text
    -- 20261109: only a manifest whose hand was accepted. A prepared number
    -- the engine dropped before dealing leaves a manifest no hand carries.
    AND EXISTS(SELECT 1 FROM public.cash_hand_provenance_receipts nr
     WHERE nr.table_id=mn.table_id AND nr.hand_number=mn.hand_number AND nr.manifest_id=mn.id)
   ORDER BY mn.hand_number LIMIT 1;$n1$]
);

COMMIT;
