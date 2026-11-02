-- 20261102023540_mtt_lobby_counts_registrations_and_rebuys_as_entries
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-02 02:35:40 UTC.
--
-- The lobby used tournaments.current_players, which drains on elimination.
-- Prime Time had 134 durable registrations and eight rebuys (142 entries)
-- while its remaining field was 88. Read the durable roster and rebuy count
-- without changing admission, player balances, prize pools or seat state.

-- Entries are registrations plus every rebuy/re-entry recorded on that roster.
-- Eliminations retain their entry; add-ons never create an entry.
-- One read-only, bounded board aggregate; keep existing tournament visibility.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
CREATE FUNCTION public.fn_mtt_lobby_entry_counts(p_tournament_ids uuid[])
RETURNS TABLE(tournament_id uuid, entries bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '3s'
AS $function$
BEGIN
  IF p_tournament_ids IS NULL THEN
    RAISE EXCEPTION 'entry_count_ids_required' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_tournament_ids) > 200 THEN
    RAISE EXCEPTION 'entry_count_ids_limit' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT t.id, count(tp.tournament_id) + coalesce(sum(greatest(coalesce(tp.rebuys, 0), 0)), 0)::bigint
    FROM public.tournaments t
    LEFT JOIN public.tournament_players tp ON tp.tournament_id = t.id
    WHERE t.id = ANY(p_tournament_ids)
    GROUP BY t.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_mtt_lobby_entry_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mtt_lobby_entry_counts(uuid[]) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_mtt_lobby_entry_counts(uuid[]) IS
  'Read-only lobby entries: durable roster plus every rebuy, including eliminated entries and excluding add-ons. At most 200 requested visible tournaments; caller RLS retained.';
COMMIT;
