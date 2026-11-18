-- Stand-ins for the two production objects the activation migration leans on.
--
-- public.clubs: only the three columns activation reads (asset, lifecycle_status).
--
-- public.fn_cash_apply_ruleset: a FAITHFUL stub of the one mapping this change
-- depends on, copied from the production function's own lines -
--   v_vpip        := coalesce((s->>'vpip_floor')::integer, 0);
--   v_vpip_window := coalesce((s->>'vpip_window')::integer, 10);
--   nit_game = v_vpip > 0, maintain_percent_min = v_vpip, maintain_hands = v_vpip_window
-- and returning the number of table rows it changed. The real function does a
-- great deal more (antes, bombs, buy-ins, run-it, kill blinds, Diamond
-- hand-off); none of that is what this proof is about, and stubbing it keeps
-- the proof honest about what it actually verifies.
CREATE TABLE IF NOT EXISTS public.clubs (
  id uuid PRIMARY KEY,
  name text,
  asset text DEFAULT 'chips',
  lifecycle_status text DEFAULT 'active'
);

CREATE OR REPLACE FUNCTION public.fn_cash_apply_ruleset(p_game_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 VOLATILE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  g record; s jsonb; v_vpip integer; v_vpip_window integer; v_n integer := 0;
BEGIN
  SELECT * INTO g FROM public.cash_games WHERE id = p_game_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = g.club_id AND c.asset = 'diamonds') THEN
    RETURN 0;  -- the Diamond projector owns that cluster
  END IF;
  s := g.ruleset_snapshot;
  IF s IS NULL THEN RETURN 0; END IF;
  v_vpip := coalesce((s->>'vpip_floor')::integer, 0);
  v_vpip_window := coalesce((s->>'vpip_window')::integer, 10);
  WITH upd AS (
    UPDATE public.tables t
       SET nit_game = v_vpip > 0,
           maintain_percent_min = v_vpip,
           maintain_hands = v_vpip_window
     WHERE t.cluster_id = p_game_id
       AND (t.nit_game IS DISTINCT FROM (v_vpip > 0)
         OR t.maintain_percent_min IS DISTINCT FROM v_vpip
         OR t.maintain_hands IS DISTINCT FROM v_vpip_window)
    RETURNING 1)
  SELECT count(*)::int INTO v_n FROM upd;
  RETURN v_n;
END;
$function$;
