-- TIER: 2. Incident 758cd269 follow-up. AUTHOR: Claude.
-- APPLIED: production 2026-11-18 07:19:47 UTC (recorded version 20261118071947).
-- At 2026-11-18 06:24:40 UTC an unrecorded management-API statement ("-- Apply migrations")
-- re-created public.fn_club_card_figures(uuid), which 20261117195710 deliberately DROPPED
-- (superseded by fn_club_share_figures), and regressed public.fn_club_share_figures(uuid) to
-- the 20261117212227 body, losing 20261118002641 (kings_club_labeled_display_totals).
-- Restore both to recorded truth. REPLAY-SAFE: refuses unless each object is in the known
-- stale or restored state.
SET LOCAL lock_timeout='5s';
DO $restore$
DECLARE v_live text; v_stmt text; v_frag text; v_tag text; v_body text;
BEGIN
  SELECT md5(prosrc) INTO v_live FROM pg_proc WHERE oid=to_regprocedure('public.fn_club_share_figures(uuid)');
  IF v_live IS NULL OR v_live NOT IN ('87f689db324fc083fa5551bb8eaf1e95','7fb92759f923ea40aa6e195cd675457e') THEN
    RAISE EXCEPTION 'restore refused: fn_club_share_figures in unknown state %', v_live;
  END IF;
  IF v_live <> '7fb92759f923ea40aa6e195cd675457e' THEN
    SELECT string_agg(st.stmt, E'\n;\n') INTO v_stmt
      FROM supabase_migrations.schema_migrations m, unnest(m.statements) st(stmt)
     WHERE m.version='20261118002641';
    v_frag := 'CREATE OR REPLACE ' || substr(v_stmt, strpos(v_stmt,'FUNCTION public.fn_club_share_figures('));
    v_tag  := substring(v_frag from '\mAS\s+(\$[A-Za-z_]*\$)');
    v_body := split_part(substr(v_frag, strpos(v_frag, v_tag)+length(v_tag)), v_tag, 1);
    IF md5(v_body) <> '7fb92759f923ea40aa6e195cd675457e' THEN
      RAISE EXCEPTION 'restore refused: recorded body hashes %', md5(v_body);
    END IF;
    EXECUTE substr(v_frag, 1, strpos(v_frag, v_tag)+length(v_tag)-1) || v_body || v_tag;
  END IF;

  SELECT md5(prosrc) INTO v_live FROM pg_proc WHERE oid=to_regprocedure('public.fn_club_card_figures(uuid)');
  IF v_live IS NOT NULL AND v_live <> 'a130740e9fe6f39d5abbbadf07468ad5' THEN
    RAISE EXCEPTION 'restore refused: fn_club_card_figures in unknown state %', v_live;
  END IF;
END $restore$;

REVOKE ALL ON FUNCTION public.fn_club_share_figures(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_club_share_figures(uuid) TO service_role;
-- 20261117195710's DROP stands.
DROP FUNCTION IF EXISTS public.fn_club_card_figures(uuid);

DO $assert$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.fn_club_share_figures(uuid)'))
       IS DISTINCT FROM '7fb92759f923ea40aa6e195cd675457e' THEN
    RAISE EXCEPTION 'ASSERT FAILED: fn_club_share_figures not restored'; END IF;
  IF to_regprocedure('public.fn_club_card_figures(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERT FAILED: fn_club_card_figures still exists'; END IF;
END $assert$;
