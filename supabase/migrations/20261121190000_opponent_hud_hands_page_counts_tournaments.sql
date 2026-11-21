-- OPPONENT HUD: tournaments are counted (PLO-OWNER lane OPPONENT-HUD-FIX-1; lead ruling 2026-11-21 18:38Z, owner
-- ruling Nov 14: every Horse feature covers cash and tournaments). fn_opponent_hud_hands_page, the one public-fields
-- source of the backfill, the switch-on catch-up and the nightly verification, now pages PLO4/PLO5 TOURNAMENT hands
-- as well as cash hands. Nothing else changes: same signature, same public projection (each player only seat, userId
-- and stack; the dealt cards never leave the database), same keyset, same grants (service_role only). No table is
-- created or altered here; opponent_hud_profiles keeps row level security on (20261120223000).
-- Rollback: re-apply the function body of 20261120223000 (adds back "AND h.tournament_id IS NULL").
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_opponent_hud_hands_page(
  p_after_at timestamptz, p_after_id uuid, p_until timestamptz, p_limit integer)
RETURNS TABLE (id uuid, created_at timestamptz, ended_at timestamptz, game_variant text, tournament_id uuid,
  big_blind numeric, button_seat smallint, bomb_pot jsonb, community_cards text[], community_cards2 text[],
  rit_boards jsonb, showdown jsonb, winners jsonb, players jsonb, actions jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $f$
BEGIN
  IF p_limit NOT BETWEEN 1 AND 2000 THEN RETURN; END IF;
  RETURN QUERY
  SELECT h.id, h.created_at, h.ended_at, h.game_variant, h.tournament_id, h.big_blind, h.button_seat,
    h.bomb_pot, h.community_cards, h.community_cards2, h.rit_boards, h.showdown, h.winners,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('seat', p->'seat', 'userId', p->'userId', 'stack', p->'stack')),
       '[]'::jsonb) FROM jsonb_array_elements(h.players) p),
    (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'seat', a->'seat', 'userId', a->'userId', 'action', a->'action', 'amount', a->'amount', 'stage', a->'stage',
        'dead', a->'dead',
        'publicNode', CASE WHEN a ? 'publicNode' THEN jsonb_build_object(
            'pot', a->'publicNode'->'pot', 'toCall', a->'publicNode'->'toCall',
            'currentBet', a->'publicNode'->'currentBet',
            'seats', (SELECT coalesce(jsonb_agg(s), '[]'::jsonb) FROM jsonb_array_elements(a->'publicNode'->'seats') s
                       WHERE (s->>0)::int = (a->>'seat')::int)) END)) ORDER BY o), '[]'::jsonb)
       FROM jsonb_array_elements(h.actions) WITH ORDINALITY AS x(a, o))
  FROM public.hand_history h
  WHERE h.game_variant IN ('plo4','plo5')
    AND (h.created_at > p_after_at OR (h.created_at = p_after_at AND h.id > p_after_id))
    AND h.created_at <= p_until
  ORDER BY h.created_at, h.id
  LIMIT p_limit;
END $f$;

REVOKE ALL ON FUNCTION public.fn_opponent_hud_hands_page(timestamptz, uuid, timestamptz, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_opponent_hud_hands_page(timestamptz, uuid, timestamptz, integer) TO service_role;

-- Function probe (scripts/ci/templates/function-probe.sql): body runs once and is undone.
-- @probe-for: public.fn_opponent_hud_hands_page
DO $probe$
BEGIN
  IF to_regclass('public.hand_history') IS NOT NULL THEN
    PERFORM public.fn_opponent_hud_hands_page(now(), NULL, now(), 1);
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
