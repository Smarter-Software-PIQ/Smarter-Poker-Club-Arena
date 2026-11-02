-- Owner November 2: horses may play no cash stakes above .50/1, in any variant.
-- Horse-only admission helper: human tables, seats, wallets and tournaments are unchanged.
-- Existing horses leave through the engine's normal hand-boundary cash-out path.
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
 ELSE coalesce(p_bb > 0 AND p_bb <= 1 AND p_sb >= 0 AND p_sb <= 0.5,false) END;
$function$;
REVOKE ALL ON FUNCTION public.fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz) TO service_role;
COMMIT;
