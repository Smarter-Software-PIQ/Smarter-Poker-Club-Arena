CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, username text, display_name text, is_horse boolean DEFAULT false);
CREATE TABLE public.cash_games (
  id uuid PRIMARY KEY, club_id uuid, template_name text, variant text,
  sb numeric, bb numeric, lightning_enabled boolean DEFAULT false,
  ruleset_snapshot jsonb, enabled boolean DEFAULT true, closed_at timestamptz);
CREATE TABLE public.tables (
  id uuid PRIMARY KEY, cluster_id uuid, tournament_id uuid, club_id uuid, name text,
  game_variant text, status text DEFAULT 'running', big_blind numeric DEFAULT 2, small_blind numeric DEFAULT 1,
  nit_game boolean DEFAULT false, career_percent_min integer DEFAULT 0,
  maintain_percent_min integer DEFAULT 0, maintain_hands integer DEFAULT 10);
CREATE TABLE public.table_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, user_id uuid,
  seat_number integer, joined_at timestamptz DEFAULT now(), left_at timestamptz);
CREATE TABLE public.cash_game_roster (
  game_id uuid, user_id uuid, joined_at timestamptz, left_at timestamptz);
CREATE TABLE public.ca_hand_facts (
  hand_id uuid DEFAULT gen_random_uuid(), user_id uuid, table_id uuid,
  played_at timestamptz, vpip boolean, pfr boolean DEFAULT false);
CREATE INDEX ON public.ca_hand_facts (user_id, played_at DESC);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
CREATE OR REPLACE FUNCTION public.fn_nit_sitting_since(p_game_id uuid, p_user_id uuid, p_fallback timestamptz)
 RETURNS timestamptz LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $function$
  SELECT GREATEST(
           coalesce((SELECT r.joined_at FROM public.cash_game_roster r
                      WHERE r.game_id = p_game_id AND r.user_id = p_user_id AND r.left_at IS NULL
                      ORDER BY r.joined_at DESC LIMIT 1), p_fallback),
           (SELECT (g.ruleset_snapshot->>'vpip_floor_since')::timestamptz
              FROM public.cash_games g WHERE g.id = p_game_id));
$function$;
CREATE OR REPLACE FUNCTION public.fn_cash_template_defaults(p_template text, p_variant text)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public','pg_temp' AS $function$
DECLARE t text:=lower(coalesce(p_template,'classic')); v text:=lower(coalesce(p_variant,'nlh')); family text; seats int;
BEGIN
 IF t IN ('action','madness','lightning') THEN t:='madness'; END IF;
 IF t NOT IN ('classic','madness') THEN RAISE EXCEPTION 'TEMPLATE_UNKNOWN: %',p_template; END IF;
 family:=CASE WHEN v IN ('plo4','plo5','plo6','plo8','flo8') THEN 'plo' WHEN v='short_deck' THEN 'shortdeck' WHEN v='pineapple' THEN 'pineapple' ELSE 'holdem' END;
 seats:=CASE WHEN t='classic' AND family='holdem' THEN 9 ELSE 6 END;
 RETURN jsonb_build_object('template',t,'variant',v,'family',family,'seats',seats,
  'min_buyin_bb',50,'max_buyin_bb',CASE WHEN v IN ('flh','flo8') THEN NULL ELSE 200 END,
  'regular_ante',CASE WHEN t='classic' AND v NOT IN ('plo5','plo6') THEN 'none' ELSE 'bb' END,
  'vpip_floor',CASE WHEN t='classic' AND v IN ('plo5','plo6') THEN 50 WHEN t='classic' THEN 0 ELSE 40 END,'vpip_window',10,
  'bombs',jsonb_build_object('enabled',t<>'classic'),
  'straddle',false,'rake','existing');
END $function$;
