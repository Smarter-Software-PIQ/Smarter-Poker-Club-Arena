-- Seek each original cash fee clock in its own time index. A late posting
-- retains the hand's earned clock. Missing post-enforcement clocks still refuse.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure))='a66fb0f9c2151ec077ea5c52ba1a4b5b' AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.ca_promo_cash_clock_earned_hand') AND i.indisvalid AND i.indisready AND pg_get_indexdef(i.indexrelid)='CREATE INDEX ca_promo_cash_clock_earned_hand ON public.ca_promo_cash_hand_clocks USING btree (accepted_at, hand_id)'))

CREATE INDEX CONCURRENTLY IF NOT EXISTS ca_promo_cash_clock_earned_hand
  ON public.ca_promo_cash_hand_clocks (accepted_at, hand_id);

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $before$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.ca_promo_cash_clock_earned_hand')
      AND i.indisvalid AND i.indisready AND pg_get_indexdef(i.indexrelid)='CREATE INDEX ca_promo_cash_clock_earned_hand ON public.ca_promo_cash_hand_clocks USING btree (accepted_at, hand_id)') THEN
    RAISE EXCEPTION 'promo cash clock window index has an unexpected definition';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure)) <> 'b3d5f3e699d86645bad46ff11ea38d6c' THEN
    RAISE EXCEPTION 'fee authority changed; revalidate promo cash clocks before installing';
  END IF;
END
$before$;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_fee_events(p_club uuid, p_user uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(earned_at timestamp with time zone, fee_credit numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 WITH cash AS MATERIALIZED (
  -- A retained clock outranks the original commit, even if that commit is
  -- outside the interval or was pruned. Seek by the actual earned timestamp.
  SELECT clock.earned_at,a.rake_amount AS fee_credit
  FROM (
    SELECT h.hand_id,h.accepted_at AS earned_at
    FROM public.ca_promo_cash_hand_clocks h
    WHERE h.accepted_at>=p_from AND h.accepted_at<p_to
    UNION ALL
    SELECT original.hand_id,original.committed_at
    FROM public.hand_atomic_commits original
    WHERE original.committed_at>=p_from AND original.committed_at<p_to
      AND isfinite(original.committed_at)
      AND NOT EXISTS(SELECT 1 FROM public.ca_promo_cash_hand_clocks h
                     WHERE h.hand_id=original.hand_id)
  ) clock
  CROSS JOIN LATERAL (
    -- Probe the unique (hand_id,player_id) key for each clock in the window.
    -- Keep the parameterized lookup so a skewed player cardinality cannot
    -- pull that player's entire attribution history through both clock joins.
    SELECT r.rake_amount FROM public.rake_attributions r
    WHERE r.hand_id=clock.hand_id AND r.player_id=p_user AND r.club_id=p_club
    OFFSET 0
  ) a
  UNION ALL
  -- Without either clock the attribution timestamp is the legacy fallback.
  -- A nonzero post-enforcement fee with no clock must still refuse even
  -- when its posting predates this grant. Retain the materialization barrier
  -- so the caller's earned-at filter cannot erase the integrity check.
  SELECT a.created_at,
    CASE WHEN a.rake_amount<>0 AND a.created_at>=s.enforced_from
         THEN public.fn_ca_promo_cash_fee_clock_missing(a.hand_id)
         ELSE a.rake_amount END
  FROM public.rake_attributions a
  CROSS JOIN (SELECT (SELECT enforced_from FROM public.ca_promo_play_through_settings WHERE id) AS enforced_from) s
  WHERE a.player_id=p_user AND a.club_id=p_club
    AND a.created_at>=LEAST(p_from,s.enforced_from) AND a.created_at<p_to
    AND NOT EXISTS(SELECT 1 FROM public.ca_promo_cash_hand_clocks h WHERE h.hand_id=a.hand_id)
    AND NOT EXISTS(SELECT 1 FROM public.hand_atomic_commits original WHERE original.hand_id=a.hand_id
                   AND isfinite(original.committed_at))
  UNION ALL
  -- The old upper bound also admitted a missing clock with a minus-infinity
  -- original before p_to even when its attribution was posted later.
  SELECT a.created_at,public.fn_ca_promo_cash_fee_clock_missing(a.hand_id)
  FROM public.hand_atomic_commits original
  JOIN public.rake_attributions a ON a.hand_id=original.hand_id
  WHERE original.committed_at='-infinity'::timestamptz AND original.committed_at<p_to
    AND a.created_at>=p_to AND a.created_at>=(SELECT enforced_from FROM public.ca_promo_play_through_settings WHERE id)
    AND a.player_id=p_user AND a.club_id=p_club AND a.rake_amount<>0
    AND NOT EXISTS(SELECT 1 FROM public.ca_promo_cash_hand_clocks h WHERE h.hand_id=original.hand_id)
 ), sources AS MATERIALIZED (
  SELECT s.id,s.rake_record_id,s.tournament_id,s.charged_at,s.rake_credit
   FROM public.accounting_tournament_fee_sources s
   WHERE s.club_id=p_club AND s.player_id=p_user AND s.charged_at>=p_from AND s.charged_at<p_to AND NOT EXISTS(SELECT 1 FROM public.ca_promo_event_fee_consumption_receipts fee WHERE fee.charge_ledger_id=s.source_charge_ledger_id)
 ), unregistered AS MATERIALIZED (
  SELECT u.tournament_id,u.fee_source_rake_record_ids,r.metadata
   FROM public.tournament_unregistration_receipts u
   CROSS JOIN LATERAL unnest(u.fee_reversal_ids) n(id)
   JOIN public.rake_records r ON r.id=n.id
   WHERE u.user_id=p_user AND u.fees_reversed>0
    AND u.tournament_id IN(SELECT s.tournament_id FROM sources s)
    AND r.tournament_id=u.tournament_id AND r.is_tournament AND r.rake_amount<0
    AND r.source='fn_unregister_from_tournament' AND r.metadata->>'user_id'=p_user::text
 ), cancelled AS MATERIALIZED (
  SELECT c.tournament_id,r.metadata FROM public.tournament_cancellation_receipts c
   CROSS JOIN LATERAL unnest(c.fee_reversal_ids) n(id)
   JOIN public.rake_records r ON r.id=n.id
   WHERE c.total_rake_after=0 AND c.fees_reversed=c.total_rake_before
    AND c.tournament_id IN(SELECT s.tournament_id FROM sources s)
    AND r.tournament_id=c.tournament_id AND r.is_tournament AND r.rake_amount<0
    AND r.source IN('atomic_cancel_tournament','operator_abort_tournament')
    AND r.metadata->>'user_id'=p_user::text
 )
 SELECT c.earned_at,c.fee_credit FROM cash c WHERE c.earned_at>=p_from AND c.earned_at<p_to
 UNION ALL
 SELECT s.charged_at,s.rake_credit FROM sources s
  WHERE NOT EXISTS(SELECT 1 FROM unregistered u WHERE u.tournament_id=s.tournament_id
   AND s.rake_record_id=ANY(u.fee_source_rake_record_ids)
   AND (u.metadata->>'original_rake_record_id'=s.rake_record_id::text
    OR COALESCE((u.metadata->'original_rake_record_ids') ? s.rake_record_id::text,false)))
  AND NOT EXISTS(SELECT 1 FROM cancelled c WHERE c.tournament_id=s.tournament_id
   AND (c.metadata->>'original_rake_record_id'=s.rake_record_id::text
    OR COALESCE((c.metadata->'original_rake_record_ids') ? s.rake_record_id::text,false)))
 UNION ALL SELECT paid.earned_at,paid.fee_credit FROM public.fn_ca_promo_original_entry_fee_events(p_club,p_user,p_from,p_to) paid;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
