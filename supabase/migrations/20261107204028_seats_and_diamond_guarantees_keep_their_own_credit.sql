-- 20261107204028_seats_and_diamond_guarantees_keep_their_own_credit.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- SEATS AND DIAMOND GUARANTEES KEEP THEIR OWN CREDIT (2026-11-07)
--
-- 20261107183629 credited the whole player payment (places + bounties +
-- rake) against the buy-in guarantee in the readiness read and the bank-short
-- notice. It applied that credit to max(guarantee, seat value) as one figure,
-- which was right for the guarantee and wrong for two things it also covered:
--
--   A satellite's guaranteed seats are bought from the places alone, exactly
--   as fn_ca_fund_overlay_on_lock funds them (seat value - places). Crediting
--   rake and bounties understated what the bank must cover, so readiness could
--   pass a start that the lock then found short (6.00 shown against 11.40 at
--   lock on a 2-seat 60 satellite with 6 entries of 8.10 + 0.90).
--
--   A Diamond event keeps its recorded place-based guarantee (20261007000010):
--   the earmark covers guarantee - places. Subtracting rake understated the
--   earmark the start needs.
--
-- So the readiness overlay is now
--   max(guarantee - (places + bounties + rake), seat value - places, 0)
-- for a chip event, max(max(guarantee, seat value) - places, 0) for a Diamond
-- event, and both exposure sums (readiness, bank-short notice) take the same
-- per-row split.
--
-- PROVEN IN AN EXPLICITLY ROLLED-BACK PRODUCTION TRANSACTION, 2026-11-07: both
-- postimages derived from the live preimages by these anchors, installed in
-- pg_temp, evaluated over all 296 open unfinalized tournaments: 0 rows differ
-- from the rule above, and every chip event without seats still equals
-- fn_ca_guarantee_funding(id).house_required. Then RAISE EXCEPTION.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_tournament_management_readiness_for_row(jsonb)'::regprocedure))) = '88ac34de6a2a33d22673cb324bd46497'
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_reason text;
BEGIN
  v_reason := public.fn_ca_break_window_refuses_migrations(now());
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'SEAT_DIAMOND_CREDIT_REFUSED: %', v_reason USING ERRCODE = '55000';
  END IF;
END
$pre$;

DO $component$
DECLARE
  v_sigs text[] := ARRAY['public.fn_tournament_management_readiness_for_row(jsonb)','public.fn_notify_guarantee_bank_short(uuid)'];
  v_pre text[] := ARRAY['1fa678744a8743a1f7594f2fbe118f8c','30d13b24ee6332f0191802a629d82abf'];
  v_expect text[] := ARRAY['88ac34de6a2a33d22673cb324bd46497','44d4ebbc497c11ce739d8a7d63c93b0c'];
  v_src text; v_out text; v_prev text; v_n int; i int;
  v_a text; v_b text; v_c text;
  v_oid oid; v_before jsonb; v_after jsonb;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'SEAT_DIAMOND_CREDIT: actor mismatch'; END IF;
  FOR i IN 1..2 LOOP
    v_oid := v_sigs[i]::regprocedure;
    v_src := pg_get_functiondef(v_oid);
    IF md5(v_src) = v_expect[i] THEN CONTINUE; END IF;
    IF md5(v_src) <> v_pre[i] THEN
      RAISE EXCEPTION 'SEAT_DIAMOND_CREDIT: % live body % is not the proven preimage', v_sigs[i], md5(v_src);
    END IF;
    v_out := v_src;
    IF i = 1 THEN
      v_a := $x$               COALESCE(t.guaranteed_prize, 0),$x$;
      v_b := $x$             ) - (COALESCE(t.prize_pool, 0) + COALESCE(t.bounty_pool, 0) + COALESCE(t.total_rake, 0)),$x$;
      v_c := E'                   0\n                 )\n                 ELSE 0';
      v_n := (length(v_out)-length(replace(v_out,v_a,'')))/length(v_a); IF v_n<>2 THEN RAISE EXCEPTION 'SEAT_DIAMOND_CREDIT: readiness anchor a found %', v_n; END IF;
      v_n := (length(v_out)-length(replace(v_out,v_b,'')))/length(v_b); IF v_n<>2 THEN RAISE EXCEPTION 'SEAT_DIAMOND_CREDIT: readiness anchor b found %', v_n; END IF;
      v_n := (length(v_out)-length(replace(v_out,v_c,'')))/length(v_c); IF v_n<>2 THEN RAISE EXCEPTION 'SEAT_DIAMOND_CREDIT: readiness anchor c found %', v_n; END IF;
      v_out := replace(v_out, v_a, $x$               COALESCE(t.guaranteed_prize, 0) - (COALESCE(t.prize_pool, 0) + COALESCE(t.bounty_pool, 0) + COALESCE(t.total_rake, 0)),$x$);
      v_out := replace(v_out, v_b, $x$             ),$x$);
      v_out := replace(v_out, v_c, E'                   0\n                 ) - COALESCE(t.prize_pool, 0)\n                 ELSE 0');
      v_prev := v_out;
      v_out := replace(v_out, $x$  v_required := greatest(v_effective_guarantee - v_credit, 0);$x$,
$x$  -- A GUARANTEED SEAT IS PAID FROM PLACES ONLY (2026-11-07). The buy-in
  -- guarantee is credited with the whole payment (places + bounties + rake);
  -- a satellite's seats are bought from the places alone, exactly as
  -- fn_ca_fund_overlay_on_lock funds them, so each is measured on its own.
  v_required := greatest(greatest(v_guaranteed - v_credit, v_seat_guarantee - v_pool), 0);$x$);
      IF v_out = v_prev THEN RAISE EXCEPTION 'SEAT_DIAMOND_CREDIT: readiness overlay anchor not found'; END IF;
      v_prev := v_out;
      v_out := replace(v_out, $x$    v_bank_type := 'diamond_house_earmark';$x$,
$x$    v_bank_type := 'diamond_house_earmark';
    -- A DIAMOND EVENT KEEPS ITS RECORDED PLACE-BASED GUARANTEE (20261007000010):
    -- its overlay is measured against the places, never the rake.
    v_required := greatest(v_effective_guarantee - v_pool, 0);$x$);
      IF v_out = v_prev THEN RAISE EXCEPTION 'SEAT_DIAMOND_CREDIT: readiness diamond anchor not found'; END IF;
    ELSE
      v_a := $x$               coalesce(t.guaranteed_prize, 0),$x$;
      v_b := $x$             ) - (coalesce(t.prize_pool, 0) + coalesce(t.bounty_pool, 0) + coalesce(t.total_rake, 0)),$x$;
      v_c := E'                   0\n                 )\n                 else 0';
      v_n := (length(v_out)-length(replace(v_out,v_a,'')))/length(v_a); IF v_n<>2 THEN RAISE EXCEPTION 'SEAT_DIAMOND_CREDIT: notify anchor a found %', v_n; END IF;
      v_n := (length(v_out)-length(replace(v_out,v_b,'')))/length(v_b); IF v_n<>2 THEN RAISE EXCEPTION 'SEAT_DIAMOND_CREDIT: notify anchor b found %', v_n; END IF;
      v_n := (length(v_out)-length(replace(v_out,v_c,'')))/length(v_c); IF v_n<>2 THEN RAISE EXCEPTION 'SEAT_DIAMOND_CREDIT: notify anchor c found %', v_n; END IF;
      v_out := replace(v_out, v_a, $x$               coalesce(t.guaranteed_prize, 0) - (coalesce(t.prize_pool, 0) + coalesce(t.bounty_pool, 0) + coalesce(t.total_rake, 0)),$x$);
      v_out := replace(v_out, v_b, $x$             ),$x$);
      v_out := replace(v_out, v_c, E'                   0\n                 ) - coalesce(t.prize_pool, 0)\n                 else 0');
    END IF;
    IF md5(v_out) <> v_expect[i] THEN
      RAISE EXCEPTION 'SEAT_DIAMOND_CREDIT: derived postimage % for % is not the proven %', md5(v_out), v_sigs[i], v_expect[i];
    END IF;
    SELECT jsonb_build_object('owner', pg_get_userbyid(p.proowner), 'secdef', p.prosecdef, 'config', p.proconfig, 'acl', p.proacl::text)
      INTO v_before FROM pg_proc p WHERE p.oid = v_oid;
    EXECUTE v_out;
    IF pg_get_functiondef(v_oid) IS DISTINCT FROM v_out OR md5(pg_get_functiondef(v_oid)) <> v_expect[i] THEN
      RAISE EXCEPTION 'SEAT_DIAMOND_CREDIT: % exact postimage readback failed', v_sigs[i];
    END IF;
    SELECT jsonb_build_object('owner', pg_get_userbyid(p.proowner), 'secdef', p.prosecdef, 'config', p.proconfig, 'acl', p.proacl::text)
      INTO v_after FROM pg_proc p WHERE p.oid = v_oid;
    IF v_after IS DISTINCT FROM v_before THEN
      RAISE EXCEPTION 'SEAT_DIAMOND_CREDIT: % authority drift % -> %', v_sigs[i], v_before, v_after;
    END IF;
  END LOOP;
END
$component$;

COMMIT;
