-- OPPONENT HUD HANDS PAGE: PUSH LOWER-BOUND INDEX PREDICATE (2026-11-22, PLO-OWNER lead-4).
--
-- Pre-image verified read-only against production on 2026-11-22:
--   - public.fn_opponent_hud_hands_page (last updated in 20261122024808_opponent_hud_profiles_add_nlh_family.sql)
--     filtered:
--       WHERE h.game_variant IN ('plo4','plo5','nlh')
--         AND (h.created_at > p_after_at OR (h.created_at = p_after_at AND h.id > p_after_id))
--         AND h.created_at <= p_until
--     without an explicit `h.created_at >= p_after_at` lower-bound predicate.
--   - Because PostgreSQL cannot push the lower bound of an OR predicate into idx_hand_history_created (created_at DESC),
--     every page call scanned idx_hand_history_created from hand #1 (2026-07-22), discarding O(N) rows per page
--     (O(N^2) across full backfill: dry-run 45048446094 timed out at 8.0s even at p_limit = 31 after 1,624,005 hands,
--     and live catchUp / reconcileDay at ~4M rows would hit PostgREST's 8s statement_timeout).
--   - Verified read-only against live production hand_history (~4M rows): adding `AND h.created_at >= p_after_at`
--     cuts the exact 2026-11-01 timeout query and a 2026-11-22 500-row dense publicNode JSONB page from >8,000 ms
--     timeout down to ~250-350 ms DB time (~1.0s end-to-end).
--
-- What this changes (zero locks, CREATE OR REPLACE FUNCTION only):
--   - Adds `AND h.created_at >= p_after_at` to public.fn_opponent_hud_hands_page so PostgreSQL uses both lower and
--     upper bounds on idx_hand_history_created, while keeping exact keyset tie-breaking on (created_at, id).
--   - Preserves identical signature, ('plo4','plo5','nlh') filter, cash + tournament support, public-fields-only
--     projection (zero hole cards), service_role-only EXECUTE grants, and RLS on opponent_hud_profiles.
--
-- Rollback: re-apply CREATE OR REPLACE FUNCTION public.fn_opponent_hud_hands_page from 20261122024808.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_opponent_hud_hands_page(
  p_after_at timestamptz, p_after_id uuid, p_until timestamptz, p_limit integer)
RETURNS TABLE (
  id uuid, created_at timestamptz, ended_at timestamptz, game_variant text, tournament_id uuid,
  big_blind numeric, button_seat smallint, bomb_pot jsonb,
  community_cards text[], community_cards2 text[],
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
  WHERE h.game_variant IN ('plo4','plo5','nlh')
    AND h.created_at >= p_after_at
    AND (h.created_at > p_after_at OR (h.created_at = p_after_at AND h.id > p_after_id))
    AND h.created_at <= p_until
  ORDER BY h.created_at, h.id
  LIMIT p_limit;
END $f$;

REVOKE ALL ON FUNCTION public.fn_opponent_hud_hands_page(timestamptz, uuid, timestamptz, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_opponent_hud_hands_page(timestamptz, uuid, timestamptz, integer)
  TO service_role;

-- Function probe (scripts/ci/templates/function-probe.sql): body runs once and is undone.
-- @probe-for: public.fn_opponent_hud_hands_page
DO $probe$
BEGIN
  IF to_regclass('public.hand_history') IS NOT NULL THEN
    PERFORM public.fn_opponent_hud_hands_page(now(), '00000000-0000-0000-0000-000000000000'::uuid, now(), 1);
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
