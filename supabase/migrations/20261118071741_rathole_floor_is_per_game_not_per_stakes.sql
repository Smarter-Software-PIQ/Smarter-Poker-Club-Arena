-- ═══════════════════════════════════════════════════════════════════════════
-- THE RATHOLE FLOOR BELONGS TO ONE GAME, NOT TO A STAKES LEVEL (2026-11-18)
-- ═══════════════════════════════════════════════════════════════════════════
-- Owner ruling (Dan, 2026-11-18 01:12 CT): a Madness balance may not follow a
-- player into a Lightning game at the same variant/stakes. Constraint rows now
-- carry game_scope ('cluster:<cash_games.id>' or 'table:<tables.id>') and every
-- reader/writer matches (player_id, game_scope).

CREATE OR REPLACE FUNCTION public.fn_cash_game_scope_of_table(p_table_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
           WHEN t.cluster_id IS NOT NULL THEN 'cluster:' || t.cluster_id::text
           ELSE COALESCE(NULLIF(t.seat_game_scope, ''), 'table:' || t.id::text)
         END
    FROM public.tables t
   WHERE t.id = p_table_id;
$function$;
REVOKE ALL ON FUNCTION public.fn_cash_game_scope_of_table(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_game_scope_of_table(uuid) TO service_role;

ALTER TABLE public.cash_rejoin_constraints ADD COLUMN IF NOT EXISTS game_scope text;

UPDATE public.cash_rejoin_constraints c
   SET game_scope = public.fn_cash_game_scope_of_table(c.source_table_id)
 WHERE c.game_scope IS NULL
   AND c.source_table_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cash_rejoin_constraints_game_lookup
  ON public.cash_rejoin_constraints (player_id, game_scope, expires_at);

CREATE OR REPLACE FUNCTION public.fn_cash_session_close(p_user_id uuid, p_table_id uuid, p_stack numeric, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t record; v_s record; v_window integer := 7200000; v_exp timestamptz; v_c record; v_now timestamptz := clock_timestamp();
  v_scope text;
BEGIN
  SELECT t.club_id, t.game_variant, t.small_blind, t.big_blind, t.tournament_id
    INTO v_t FROM public.tables t WHERE t.id = p_table_id;
  IF NOT FOUND OR v_t.tournament_id IS NOT NULL THEN RETURN; END IF;

  -- 2026-11-18: the constraint belongs to this cash game, never to a stakes level.
  v_scope := public.fn_cash_game_scope_of_table(p_table_id);

  UPDATE public.cash_player_session
     SET closed_at = v_now, closed_reason = COALESCE(p_reason, 'leave'), final_stack = CASE WHEN p_stack IS NULL THEN NULL ELSE round(greatest(p_stack, 0), 2) END, final_stack_captured_at = CASE WHEN p_stack IS NULL THEN NULL ELSE v_now END, financial_capture_status = CASE WHEN p_stack IS NULL THEN 'partial' ELSE 'exact' END, close_table_id = p_table_id
   WHERE player_id = p_user_id AND scope_type = 'table' AND scope_id = p_table_id AND closed_at IS NULL
   RETURNING * INTO v_s;
  v_window := 7200000; -- Owner direction: two hours from this cashout.

  -- BOOTED FOR LOW VPIP = BARRED FROM THIS GAME FOR THE WINDOW (Dan 2026-09-05).
  IF p_reason = 'vpip_evicted' AND v_scope IS NOT NULL AND v_t.club_id IS NOT NULL
     AND v_t.game_variant IS NOT NULL AND v_t.small_blind IS NOT NULL AND v_t.big_blind IS NOT NULL THEN
    v_exp := v_now + make_interval(secs => v_window / 1000.0);
    SELECT * INTO v_c FROM public.cash_rejoin_constraints c
     WHERE c.player_id = p_user_id AND c.game_scope = v_scope AND c.expires_at > v_now
     ORDER BY c.expires_at DESC LIMIT 1
     FOR UPDATE;
    IF FOUND THEN
      UPDATE public.cash_rejoin_constraints
         SET barred_until = GREATEST(COALESCE(barred_until, v_exp), v_exp),
             expires_at   = GREATEST(expires_at, v_exp),
             left_at      = v_now,
             source_table_id = p_table_id
       WHERE id = v_c.id;
    ELSE
      INSERT INTO public.cash_rejoin_constraints
        (player_id, club_id, variant, sb, bb, required_stack, left_at, expires_at, source_table_id, barred_until, game_scope)
      VALUES (p_user_id, v_t.club_id, v_t.game_variant, v_t.small_blind, v_t.big_blind,
              0.01, v_now, v_exp, p_table_id, v_exp, v_scope);
    END IF;
  END IF;

  IF COALESCE(p_stack, 0) <= 0 THEN RETURN; END IF;
  IF v_scope IS NULL OR v_t.club_id IS NULL OR v_t.game_variant IS NULL
     OR v_t.small_blind IS NULL OR v_t.big_blind IS NULL THEN RETURN; END IF;

  v_exp := v_now + make_interval(secs => v_window / 1000.0);

  SELECT * INTO v_c FROM public.cash_rejoin_constraints c
   WHERE c.player_id = p_user_id AND c.game_scope = v_scope AND c.expires_at > v_now
   ORDER BY c.expires_at DESC LIMIT 1
   FOR UPDATE;
  IF FOUND THEN
    UPDATE public.cash_rejoin_constraints
       SET required_stack = GREATEST(required_stack, p_stack),
           expires_at     = GREATEST(expires_at, v_exp),
           left_at        = v_now,
           source_table_id = p_table_id
     WHERE id = v_c.id;
  ELSE
    INSERT INTO public.cash_rejoin_constraints
      (player_id, club_id, variant, sb, bb, required_stack, left_at, expires_at, source_table_id, game_scope)
    VALUES (p_user_id, v_t.club_id, v_t.game_variant, v_t.small_blind, v_t.big_blind,
            p_stack, v_now, v_exp, p_table_id, v_scope);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_cash_session_close(uuid, uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_session_close(uuid, uuid, numeric, text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_cash_rejoin_floor(p_user_id uuid, p_table_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_barred timestamptz;
  v_floor numeric;
  v_scope text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tables t WHERE t.id = p_table_id AND t.tournament_id IS NULL) THEN
    RETURN NULL;
  END IF;
  v_scope := public.fn_cash_game_scope_of_table(p_table_id);
  IF v_scope IS NULL THEN RETURN NULL; END IF;

  SELECT max(c.barred_until), max(c.required_stack)
    INTO v_barred, v_floor
    FROM public.cash_rejoin_constraints c
   WHERE c.player_id  = p_user_id
     AND c.game_scope = v_scope
     AND c.expires_at > now();
  IF v_barred IS NOT NULL AND v_barred > now() THEN
    RAISE EXCEPTION 'VPIP_BARRED:%', ceil(extract(epoch FROM (v_barred - now())))::integer
      USING ERRCODE = 'check_violation',
            HINT = 'Removed for low VPIP: no seat in this game until the bar lifts.';
  END IF;
  RETURN v_floor;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_cash_rejoin_floor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cash_rejoin_floor(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_cash_game_barred_seconds(p_game_id uuid, p_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ceil(extract(epoch FROM (max(c.barred_until) - now())))::integer
    FROM public.cash_rejoin_constraints c
   WHERE c.player_id = p_user_id
     AND c.game_scope = 'cluster:' || p_game_id::text
     AND c.barred_until > now()
  HAVING max(c.barred_until) IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.fn_cash_game_barred_seconds(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_game_barred_seconds(uuid, uuid) TO service_role;
