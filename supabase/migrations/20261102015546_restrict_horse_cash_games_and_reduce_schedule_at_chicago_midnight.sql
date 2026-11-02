-- Owner November 1: cash only, effective midnight November 2 America/Chicago.
-- No seat/wallet mutations; engine departures use the existing safe cash-out door.
-- Current schedule is already halved. Retain 40% of it (20% of the original).
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE FUNCTION public.fn_horse_cash_game_allowed(
  p_variant text, p_sb numeric, p_bb numeric, p_tournament_id uuid,
  p_at timestamptz DEFAULT now()
) RETURNS boolean LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $function$
 SELECT CASE
 WHEN p_tournament_id IS NOT NULL OR p_at < '2026-11-02 00:00:00 America/Chicago'::timestamptz THEN true
 WHEN lower(btrim(coalesce(p_variant,''))) LIKE '%pineapple%'
   OR lower(btrim(coalesce(p_variant,''))) IN ('short_deck','shortdeck','6+','plo8') THEN false
 WHEN lower(btrim(coalesce(p_variant,''))) LIKE 'plo%'
   THEN coalesce(p_bb > 0 AND p_bb <= 1 AND p_sb >= 0 AND p_sb <= 0.5,false)
 ELSE true END;
$function$;
REVOKE ALL ON FUNCTION public.fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz) TO service_role;

DO $patch$
DECLARE original text; patched text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.fn_ca_horse_roster_seat_guard()'::regprocedure) INTO original;
 IF md5(original) <> 'b9889f2126961d526b195b21ea40bb4b' THEN
   RAISE EXCEPTION 'horse cash admission predecessor changed; review before applying';
 END IF;
 marker := '  -- Diamond cash is a distinct asset, never inferred from a caller''s club id.';
 patched := replace(original,marker,$insert$
  -- Restrictions precede roster exemptions. An already-owned same-game move finishes,
  -- then the normal rotator exits; existing stack updates and exits remain legal.
  IF EXISTS (SELECT 1 FROM public.tables t WHERE t.id=NEW.table_id
    AND NOT public.fn_horse_cash_game_allowed(t.game_variant,t.small_blind,t.big_blind,t.tournament_id))
    AND NOT (NEW.active_game_scope IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.table_seats s WHERE s.user_id=NEW.user_id AND s.left_at IS NULL
      AND s.active_game_scope=NEW.active_game_scope AND s.table_id IS DISTINCT FROM NEW.table_id))
  THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='horse_cash_game_restricted: owner cash game and PLO stake policy';
  END IF;
$insert$ || marker);
 IF patched = original THEN RAISE EXCEPTION 'horse cash admission anchor absent'; END IF;
 EXECUTE patched;
END $patch$;
REVOKE ALL ON FUNCTION public.fn_ca_horse_roster_seat_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_roster_seat_guard() TO service_role;

DO $patch$
DECLARE original text; patched text;
BEGIN
 SELECT pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure) INTO original;
 IF md5(original) <> '73ceed9f222509a62023666a91e6302b' THEN
   RAISE EXCEPTION 'cash cluster predecessor changed; review before applying';
 END IF;
 patched := replace(original,
   'v_table_cap := greatest(1, floor(v_table_cap * 0.5)::integer);',
   $insert$v_table_cap := greatest(1, floor(v_table_cap *
     CASE WHEN v_now >= '2026-11-02 00:00:00 America/Chicago'::timestamptz
          THEN 0.2 ELSE 0.5 END)::integer);$insert$);
 IF patched = original THEN RAISE EXCEPTION 'cash cluster capacity anchor absent'; END IF;
 EXECUTE patched;
END $patch$;
REVOKE ALL ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) TO service_role;
COMMIT;
