-- A promo fee reader never scans the platform's hands for one member's fees.
-- Incident 9408cfd4 (2026-11-22 20:15 UTC): hand 60560424 on table 6165c59d
-- froze a 400.00 add-on whose promo settlement reads this function. The member
-- (86e42f5e) had 17,748 lifetime fees, and the line `WHEN n=16385 THEN true`
-- sent every member at that size to the clock window without measuring it:
-- 1,001,547 clocks probed since the account's first grant to find 1,488 fees.
-- The envelope timed out on every retry, so no later hand at the table could
-- bank its rake, jackpot drop or play-through. 271 of 558 open accounts were on
-- that route and it timed out 1,003 times in 24 hours.
-- The route is now measured at every size, and the member's postings are read
-- from one day before the earliest instant the reader can use instead of from
-- the start of their history. Same rows: 1,488 fees, 922.65, both ways; 123 ms.
-- @live-proof: (SELECT md5(pg_get_functiondef(oid))='9fbd419ad5ae2b8311d4167547415715' AND prosecdef AND proowner='postgres'::regrole AND proacl::text='{postgres=X/postgres}' FROM pg_proc WHERE oid='public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure)

BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';

DO $before$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure)) <> 'cadf29b87340d1d1d6884ac91f0a6b48' THEN
    RAISE EXCEPTION 'promo fee reader changed before the measured-route install';
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
  -- Choose between the member's own postings and the global clock window by
  -- measuring both, at every history size. Until 20261122 a member with 16,385
  -- lifetime fees was sent to the clock window unmeasured: 271 of 558 open
  -- accounts then probed every hand the platform accepted since their first
  -- grant (1,001,547 clocks for 1,483 of their own fees) and timed out inside
  -- hand post-commit envelopes (incident 9408cfd4).
  -- A fee is posted after its hand is accepted, never before it (70,590 of
  -- 70,590 measured; the latest clock trails its posting by 0.24 s), so the
  -- member's postings are read from one day before the earliest instant this
  -- reader can use: the interval start or the enforcement start, whichever is
  -- earlier. Older postings can neither fall in the interval nor be refused.
  WITH posting_floor AS MATERIALIZED (
    SELECT LEAST(p_from,(SELECT enforced_from FROM public.ca_promo_play_through_settings WHERE id))
           - interval '1 day' AS posted_from
  ), member_size AS MATERIALIZED (
    SELECT count(*) AS n FROM (
      SELECT 1 FROM public.rake_attributions
      WHERE player_id=p_user AND created_at>=(SELECT posted_from FROM posting_floor) LIMIT 16385
    ) probe
  ), route AS MATERIALIZED (
    SELECT CASE
      WHEN n<257 THEN false
      ELSE NOT EXISTS (
        SELECT 1 FROM public.hand_atomic_commits c WHERE c.committed_at>=p_from AND c.committed_at<p_to
        OFFSET (SELECT n FROM member_size) LIMIT 1
      ) AND NOT EXISTS (
        SELECT 1 FROM public.ca_promo_cash_hand_clocks c WHERE c.accepted_at>=p_from AND c.accepted_at<p_to
        OFFSET (SELECT n FROM member_size) LIMIT 1
      )
    END AS use_clock_window FROM member_size
  )
  SELECT COALESCE(h.accepted_at,CASE WHEN isfinite(original.committed_at) THEN original.committed_at END,a.created_at) AS earned_at,
    CASE WHEN h.hand_id IS NULL AND (original.committed_at IS NULL OR NOT isfinite(original.committed_at))
      AND a.rake_amount<>0 AND a.created_at>=(SELECT enforced_from FROM public.ca_promo_play_through_settings WHERE id)
      THEN public.fn_ca_promo_cash_fee_clock_missing(a.hand_id) ELSE a.rake_amount END AS fee_credit
  FROM public.rake_attributions a
  LEFT JOIN public.ca_promo_cash_hand_clocks h ON h.hand_id=a.hand_id
  LEFT JOIN public.hand_atomic_commits original ON h.hand_id IS NULL AND original.hand_id=a.hand_id
  WHERE NOT (SELECT use_clock_window FROM route) AND a.player_id=p_user AND a.club_id=p_club
    AND a.created_at>=(SELECT posted_from FROM posting_floor)
    AND (a.created_at<p_to OR h.accepted_at<p_to OR original.committed_at<p_to)
  UNION ALL
  SELECT by_clock.earned_at,by_clock.fee_credit FROM (
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
      -- Visit adjacent B-tree keys together across the global time window.
      ORDER BY hand_id
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
  ) by_clock WHERE (SELECT use_clock_window FROM route)
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
