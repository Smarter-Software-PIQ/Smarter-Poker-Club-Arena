-- Queue feedback uses the same entry TTL, wallet and live reservation rules as admission.
-- Installation changes definitions only. An explicit Join renews only its caller's expired entry.
-- No queue, seat or wallet rows are rewritten at installation.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
CREATE OR REPLACE FUNCTION public.fn_cash_game_waitlist_position(p_game_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
 WITH game AS (SELECT * FROM public.cash_games WHERE id=p_game_id),
 live_holds AS (
   SELECT h.id,h.user_id,h.table_id,coalesce(h.hold_expires_at,h.notified_at+interval '60 seconds') AS hold_expires_at
   FROM public.table_waitlist h JOIN public.tables t ON t.id=h.table_id
   WHERE t.cluster_id=p_game_id AND h.status='notified'
     AND coalesce(h.hold_expires_at,h.notified_at+interval '60 seconds')>now()
     AND NOT coalesce(t.is_deleted,false) AND t.lifecycle IN ('live','opening')
 ), queue AS (
   SELECT w.* FROM public.cash_game_waitlist w WHERE w.game_id=p_game_id
   AND ((w.status='waiting' AND w.created_at>now()-interval '24 hours')
     OR (w.status='notified' AND EXISTS(SELECT 1 FROM live_holds h WHERE h.user_id=w.user_id)))
 ), mine AS (
   SELECT w.* FROM public.cash_game_waitlist w
   WHERE w.game_id=p_game_id AND w.user_id=auth.uid()
   ORDER BY w.created_at DESC,w.id DESC LIMIT 1
 ), own_hold AS (
   SELECT * FROM live_holds WHERE user_id=auth.uid() ORDER BY hold_expires_at DESC,id LIMIT 1
 ), candidates AS (
   SELECT t.id,public.fn_ca_cash_entry_need(auth.uid(),t.id) need,
     public.fn_ca_cash_wallet_covers(auth.uid(),t.id,NULL,
       public.fn_ca_cash_entry_need(auth.uid(),t.id)) funded,
     public.fn_cash_game_open_seats(t.id) available
   FROM public.tables t WHERE t.cluster_id=p_game_id
     AND t.lifecycle IN ('live','opening') AND t.status IN ('waiting','running','active')
     AND NOT coalesce(t.is_deleted,false)
 )
 SELECT jsonb_build_object(
   'waiting',(SELECT count(*) FROM queue),
   'position',CASE WHEN EXISTS(SELECT 1 FROM queue WHERE user_id=auth.uid())
      THEN (SELECT count(*)+1 FROM queue q,mine m
        WHERE (q.created_at,q.id)<(m.created_at,m.id)) ELSE NULL END,
   'on_list',EXISTS(SELECT 1 FROM queue WHERE user_id=auth.uid()),
   'queued_at',(SELECT created_at FROM mine),
   'reserved_table_id',(SELECT table_id FROM own_hold),
   'hold_expires_at',(SELECT hold_expires_at FROM own_hold),
   'minimum_entry',(SELECT min(need) FROM candidates),
   'reason',CASE
     WHEN auth.uid() IS NULL THEN 'signed_out'
     WHEN EXISTS(SELECT 1 FROM own_hold) THEN 'seat_reserved'
     WHEN NOT EXISTS(SELECT 1 FROM mine WHERE status IN ('waiting','notified')) THEN 'off_list'
     WHEN NOT EXISTS(SELECT 1 FROM queue WHERE user_id=auth.uid()) THEN 'expired'
     WHEN NOT EXISTS(SELECT 1 FROM game WHERE enabled AND closed_at IS NULL) THEN 'game_closed'
     WHEN public.fn_cash_game_barred_seconds(p_game_id,auth.uid()) IS NOT NULL THEN 'barred'
     WHEN EXISTS(SELECT 1 FROM public.waitlist_policy p WHERE p.id AND p.max_concurrent_holds>0
       AND (SELECT count(*) FROM public.table_waitlist h WHERE h.user_id=auth.uid() AND h.status='notified'
         AND coalesce(h.hold_expires_at,h.notified_at+interval '60 seconds')>now())>=p.max_concurrent_holds)
       THEN 'offer_limit'
     WHEN NOT EXISTS(SELECT 1 FROM candidates) THEN 'table_opening'
     WHEN NOT EXISTS(SELECT 1 FROM candidates WHERE funded) THEN 'insufficient_funds'
     WHEN EXISTS(SELECT 1 FROM candidates WHERE funded AND available>0) THEN 'seat_available'
     ELSE 'waiting_for_seat' END
 );
$function$;
-- Keep the existing lobby's top-line queue total consistent with its own-player reader.
DO $migration$
DECLARE old_fragment text := '''waiting'', (SELECT count(*) FROM public.cash_game_waitlist w
                                                WHERE w.game_id = g.id AND w.status IN (''waiting'', ''notified''))';
 body text;
BEGIN
 SELECT pg_get_functiondef('public.fn_cash_game_lobby(uuid)'::regprocedure) INTO body;
 IF position(old_fragment IN body)=0 THEN
   RAISE EXCEPTION 'Cash lobby queue total changed; review the current definition before installation';
 END IF;
 body := replace(body,old_fragment,'''waiting'', (public.fn_cash_game_waitlist_position(g.id)->>''waiting'')::integer');
 EXECUTE body;
END;
$migration$;
-- Renew an aged entry inside the original, caller-bound Join transaction.
DO $migration$
DECLARE marker text := '  -- Nothing open anywhere: hold the place. One live row per game per player.';
 old_count text := '  SELECT count(*) + 1 INTO v_position FROM public.cash_game_waitlist w
   WHERE w.game_id = g.id AND w.status IN (''waiting'', ''notified'')
     AND w.created_at < (SELECT created_at FROM public.cash_game_waitlist x
                          WHERE x.game_id = g.id AND x.user_id = v_uid AND x.status IN (''waiting'', ''notified'') LIMIT 1);
  SELECT count(*) INTO v_count FROM public.cash_game_waitlist w
   WHERE w.game_id = g.id AND w.status IN (''waiting'', ''notified'');';
 body text;
BEGIN
 SELECT pg_get_functiondef('public.fn_cash_game_join(uuid)'::regprocedure) INTO body;
 IF position(marker IN body)=0 OR position(old_count IN body)=0 THEN
   RAISE EXCEPTION 'Cash Join queue tail changed; review the current definition before installation';
 END IF;
 body := replace(body,marker,$renew$  -- Existing funding, membership, game lock and live-hold guards ran above.
  -- An old waiting row must not block the caller's explicit fresh request.
  UPDATE public.cash_game_waitlist w SET status = 'expired', updated_at = now()
   WHERE w.game_id = g.id AND w.user_id = v_uid AND w.status = 'waiting'
     AND w.created_at <= now() - interval '24 hours';
$renew$ || marker);
 body := replace(body,old_count,$counts$  SELECT (state->>'position')::integer, (state->>'waiting')::integer
    INTO v_position, v_count
    FROM (SELECT public.fn_cash_game_waitlist_position(g.id) AS state) effective_queue;$counts$);
 EXECUTE body;
END;
$migration$;
COMMIT;
