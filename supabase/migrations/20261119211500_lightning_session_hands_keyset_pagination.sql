-- LIGHTNING PREVIOUS HANDS KEYSET PAGINATION (2026-11-19).
--
-- fn_lightning_recent_hands(integer, uuid) is pinned to a 50-row cap and an
-- exact two-argument signature. Long Lightning sessions need keyset pagination
-- past hand 50 in Previous Hands without widening or altering that signature.
--
-- Read-only SECURITY DEFINER browser door scoped strictly to auth.uid() and
-- one pool session owned by the caller. Returns only canonical hand pointers
-- (hand_id, hand_history_id, hand_number, played_at); hand_history RLS and
-- ca_hand_facts RLS remain the sole doors for hand content and private cards.
--
-- @live-proof: (SELECT p.prosecdef AND p.proconfig::text ~ 'search_path' AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND pg_get_functiondef(p.oid) ~ 'auth\.uid\(\)' AND regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g') !~ 'is_horse|horse_id|lightning_instance_id|INSERT INTO|UPDATE public|DELETE FROM' FROM pg_proc p WHERE p.oid = 'public.fn_lightning_session_hands_page(uuid,integer,bigint)'::regprocedure)

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_lightning_session_hands_page(
  p_pool_session_id uuid,
  p_limit integer DEFAULT 50,
  p_before_hand_number bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(coalesce(p_limit, 50), 0), 50);
BEGIN
  IF v_uid IS NULL OR v_limit = 0 OR p_pool_session_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.lightning_pool_session ps
     WHERE ps.id = p_pool_session_id
       AND ps.player_id = v_uid
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN (
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'hand_id',         q.hand_id,
          'hand_history_id', q.hand_history_id,
          'hand_number',     q.hand_number,
          'played_at',       q.played_at
        )
        ORDER BY q.hand_number DESC
      ),
      '[]'::jsonb
    )
    FROM (
      SELECT lh.hand_id,
             lh.hand_history_id,
             lh.hand_number,
             lh.settled_at AS played_at
        FROM public.lightning_hand_player hp
        JOIN public.lightning_hand lh ON lh.hand_id = hp.hand_id
        JOIN public.lightning_pool_slot sl ON sl.id = hp.pool_slot_id
       WHERE hp.player_id = v_uid
         AND lh.settled_at IS NOT NULL
         AND sl.pool_session_id = p_pool_session_id
         AND (p_before_hand_number IS NULL OR lh.hand_number < p_before_hand_number)
       ORDER BY lh.hand_number DESC
       LIMIT v_limit
    ) q
  );
END
$function$;

REVOKE ALL ON FUNCTION public.fn_lightning_session_hands_page(uuid, integer, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_lightning_session_hands_page(uuid, integer, bigint) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_lightning_session_hands_page(uuid, integer, bigint) IS
  'Keyset-paginated settled hand pointers for one of the caller''s own Lightning pool sessions (oldest-first paging past the 50-hand recent window). 2026-11-19.';

DO $$
DECLARE
  v_oid regprocedure := 'public.fn_lightning_session_hands_page(uuid,integer,bigint)'::regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
     WHERE p.oid = v_oid
       AND p.prosecdef
       AND p.proconfig::text ~ 'search_path'
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND has_function_privilege('service_role', p.oid, 'EXECUTE')
       AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'fn_lightning_session_hands_page privilege or security verification failed';
  END IF;
END
$$;

COMMIT;
