-- 20261112004925_a_hidden_messenger_status_is_not_revealed_by_a_seat.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (owner, Dan, 2026-11-11):
--
-- "Preserve Active Status privacy choices; do not let message sending or page
-- heartbeats silently override an intentional hidden state ... Distinguish
-- visible table participation from Messenger presence and correct that
-- remaining bypass."
--
-- fn_profile_presence is the social presence answer (Messenger header and
-- list dots, friends list, hover cards, profile). Since 20261006040328 it
-- also returned online for anyone with a live seat, so a person who turned
-- Messenger Active Status off read Online in Messenger the moment they sat at
-- a table. With Active Status off, both heartbeats (World Hub, and the arena
-- since #10547) write profiles.is_online = false; a sign-out writes it false
-- too. So a live seat now counts for a person only while their own presence
-- flag is not false. Horses keep the seat rule unchanged (they have no
-- Messenger setting; most seated horses carry no fresh heartbeat).
--
-- Table participation is not touched: rosters, seat maps, union and arena
-- counts read table_seats directly, not this function. The heartbeat rule and
-- the per-device Active Status setting are unchanged.
--
-- @live-proof: position('is_horse' in (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_profile_presence(uuid[])'::regprocedure)) > 0

BEGIN;

DO $pin$
BEGIN
  IF md5(pg_get_functiondef('public.fn_profile_presence(uuid[])'::regprocedure)) <> 'ce67564cedfcdf8fadf28cbd49f5619f' THEN
    RAISE EXCEPTION 'fn_profile_presence changed since 2026-11-11; re-read before applying';
  END IF;
END
$pin$;

CREATE OR REPLACE FUNCTION public.fn_profile_presence(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, is_online boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Online now, and nothing else: a heartbeat under five minutes old, or a
  -- live seat at an open table. A person's seat counts only while their own
  -- presence flag is not false (Messenger Active Status off, or signed out,
  -- writes it false); a horse's seat always counts. The heartbeat
  -- (last_seen) is never returned; it is its owner's.
  SELECT p.id,
         (COALESCE(p.is_online, false) AND p.last_seen > now() - interval '5 minutes')
         OR ((COALESCE(p.is_horse, false) OR p.is_online IS DISTINCT FROM false)
             AND EXISTS (SELECT 1
                           FROM public.table_seats ts
                           JOIN public.tables t ON t.id = ts.table_id
                          WHERE ts.user_id = p.id
                            AND ts.left_at IS NULL
                            AND t.status IN ('running', 'waiting', 'active')))
    FROM public.profiles p
   WHERE auth.uid() IS NOT NULL
     AND p.id = ANY (COALESCE(p_user_ids, ARRAY[]::uuid[]))
   LIMIT 1000;
$function$;

COMMIT;
