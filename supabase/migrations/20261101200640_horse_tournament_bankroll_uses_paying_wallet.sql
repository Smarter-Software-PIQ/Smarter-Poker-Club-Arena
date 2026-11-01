-- Reserved by scripts/new-migration.mjs against main and remote branches.
-- The registration selector judged the minimum balance of every membership.
-- A broke unrelated club therefore hid a Horse whose actual paying wallet
-- was funded (live Micah Nakamura: 5.63 unrelated / 9727.40 paying wallet).
-- Resolve exactly as the ordinary entry wrapper does, without charging,
-- reserving, steering or modifying any wallet. The purchase retains its locks
-- and all ordinary solvency, membership, capacity and transaction safeguards.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_ca_horse_tournament_bankrolls(
  p_tournament_id uuid, p_horse_ids uuid[])
RETURNS TABLE(user_id uuid, club_id uuid, chip_balance numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH candidates AS MATERIALIZED (
    SELECT p.id
      FROM public.profiles p
     WHERE p.id = ANY(p_horse_ids)
       AND p.is_horse IS TRUE AND p.horse_status = 'available'
       AND EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = p_tournament_id)
  ), paying AS MATERIALIZED (
    SELECT h.id,
           COALESCE(public.fn_ca_entry_paying_club(h.id, p_tournament_id),
                    public.fn_tournament_club_for_user(h.id, p_tournament_id, NULL)) AS club_id
      FROM candidates h
  )
  SELECT h.id, h.club_id, m.chip_balance
    FROM paying h
    LEFT JOIN public.club_members m
      ON m.user_id = h.id AND m.club_id = h.club_id
     AND m.status IN ('active', 'approved')
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_horse_tournament_bankrolls(uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_tournament_bankrolls(uuid, uuid[]) TO service_role;
COMMIT;
