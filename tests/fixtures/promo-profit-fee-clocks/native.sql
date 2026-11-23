-- Both the original and the indexed reader must give the same independent
-- answer. Posting dates deliberately disagree with the authoritative clocks.
BEGIN;
UPDATE public.ca_promo_play_through_settings SET enforced_from=now()-interval '4 hours' WHERE id;
-- Vary only unrelated, fully historical player attributions to exercise both
-- the short membership lookup and the clock-window lookup with every case.
INSERT INTO public.rake_attributions(hand_id,club_id,player_id,rake_amount,created_at)
SELECT md5('historic-fee-'||n)::uuid,:'club',:'member',1,now()-interval '30 days'
FROM generate_series(1,:historical_rows) n;
-- Exercise both sources of original cash timestamps and both cost routes.
-- These are other hands inside the requested window, with no fee for this player.
\if :{?window_rows}
INSERT INTO public.hand_atomic_commits(hand_id,table_id,hand_number,committed_at)
SELECT md5('other-in-window-'||n)::uuid,:'table',40000+n,now()-interval '30 minutes'
FROM generate_series(1,:window_rows) n;
\endif
-- Incident 9408cfd4 (2026-11-22): a member whose own recent postings fill the
-- size probe, inside a window holding more hands than that. These zero-fee
-- postings sit outside both intervals below, so every answer is unchanged.
\if :{?recent_rows}
INSERT INTO public.rake_attributions(hand_id,club_id,player_id,rake_amount,created_at)
SELECT md5('recent-fee-'||n)::uuid,:'club',:'member',0,now()-interval '90 minutes'
FROM generate_series(1,:recent_rows) n;
\endif
CREATE TEMP TABLE fee_clock_case (
  n integer PRIMARY KEY, posted interval NOT NULL, retained interval,
  original interval, amount numeric NOT NULL
);
INSERT INTO fee_clock_case VALUES
  (1, interval '-6 hours', interval '-40 minutes', interval '-3 days', 1),
  (2, interval '-6 hours', NULL, interval '-20 minutes', 2),
  (3, interval '3 hours', interval '-10 minutes', NULL, 4),
  (4, interval '-15 minutes', interval '-5 days', interval '-15 minutes', 8),
  (5, interval '-3 days', NULL, NULL, 16),
  (6, interval '-2 minutes', interval '0 seconds', NULL, 32),
  (7, interval '2 hours', interval '-1 hour', NULL, 64),
  (8, interval '-1 minute', NULL, NULL, 0),
  (9, interval '-9 hours', interval '-12 minutes', NULL, -3);

INSERT INTO public.hand_atomic_commits(hand_id,table_id,hand_number,committed_at)
SELECT md5('window-'||n)::uuid, :'table',n,now()+original FROM fee_clock_case WHERE original IS NOT NULL;
INSERT INTO public.ca_promo_cash_hand_clocks(hand_id,table_id,hand_number,accepted_at)
SELECT md5('window-'||n)::uuid, :'table',n,now()+retained FROM fee_clock_case WHERE retained IS NOT NULL;
INSERT INTO public.rake_attributions(hand_id,club_id,player_id,rake_amount,created_at)
SELECT md5('window-'||n)::uuid, :'club', :'member',amount,now()+posted FROM fee_clock_case;

CREATE FUNCTION pg_temp.check_window(p_club uuid,p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE result numeric[]; legacy numeric;
BEGIN
  SELECT array_agg(fee_credit ORDER BY fee_credit) INTO result
  FROM public.fn_ca_promo_fee_events(p_club,p_user,now()-interval '1 hour',now());
  IF result IS DISTINCT FROM ARRAY[-3,0,1,2,4,64]::numeric[] THEN
    RAISE EXCEPTION 'cash fee clock precedence or [start,end) changed: %',result;
  END IF;
  SELECT sum(fee_credit) INTO legacy FROM public.fn_ca_promo_fee_events(
    p_club,p_user,now()-interval '4 days',now()-interval '2 days');
  IF legacy IS DISTINCT FROM 16::numeric THEN
    RAISE EXCEPTION 'legacy posting fallback changed: %',legacy;
  END IF;
END $$;
-- Every scan of the fee postings in this transaction, by table or by index.
CREATE FUNCTION pg_temp.fee_posting_scans() RETURNS bigint LANGUAGE sql AS $$
  SELECT COALESCE(pg_stat_get_xact_numscans('public.rake_attributions'::regclass),0)
       + COALESCE((SELECT sum(pg_stat_get_xact_numscans(i.indexrelid))
                     FROM pg_index i WHERE i.indrelid='public.rake_attributions'::regclass),0)
$$;
SELECT pg_temp.fee_posting_scans() AS scans_before \gset
SELECT pg_temp.check_window(:'club',:'member');
-- The clock window probes the postings once per hand in the window. A member
-- is never sent there when the window holds more hands than the member has
-- postings: reading this member must not cost one probe per platform hand.
\if :{?recent_rows}
CREATE FUNCTION pg_temp.require_member_route(p_before bigint,p_window bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE spent bigint := pg_temp.fee_posting_scans() - p_before;
BEGIN
  IF spent >= p_window THEN
    RAISE EXCEPTION 'a heavy member was sent through the global clock window: % posting scans for % window hands',spent,p_window;
  END IF;
END $$;
SELECT pg_temp.require_member_route(:scans_before,:window_rows);
\endif

-- Nonfinite historical commits provide no earned time. A minus-infinity
-- commit did admit an otherwise future posting to the original integrity check.
SAVEPOINT sentinel;
INSERT INTO public.hand_atomic_commits(hand_id,table_id,hand_number,committed_at)
VALUES(md5('fee-sentinel')::uuid,:'table',10,'-infinity');
INSERT INTO public.rake_attributions(hand_id,club_id,player_id,rake_amount,created_at)
VALUES(md5('fee-sentinel')::uuid,:'club',:'member',5,now()+interval '1 hour');
CREATE FUNCTION pg_temp.check_sentinel(p_club uuid,p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM sum(fee_credit) FROM public.fn_ca_promo_fee_events(p_club,p_user,now()-interval '1 hour',now());
  RAISE EXCEPTION 'missing original timestamp with historical sentinel was accepted';
EXCEPTION WHEN check_violation THEN
  IF SQLERRM NOT LIKE 'promo_cash_fee_original_hand_clock_missing:%' THEN RAISE; END IF;
END $$;
SELECT pg_temp.check_sentinel(:'club',:'member');
ROLLBACK TO SAVEPOINT sentinel;

-- A nonzero original fee can exist before this member is given a grant.
-- Activate a genuine grant, then read its unfinished lock with an old missing
-- clock. An attribution timestamp alone cannot certify earned progress.
INSERT INTO public.rake_attributions(hand_id,club_id,player_id,rake_amount,created_at)
VALUES(md5('unresolved-old-fee')::uuid,:'club',:'member',10,now()-interval '2 hours');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
UPDATE public.club_members SET chip_balance=10000 WHERE club_id=:'club' AND user_id=:'member';
SELECT public.fn_ca_promo_play_through_record_grant(
  :'club',:'member',50,'club_promo','fee-clock-guard',NULL,'promo_wallet',:'club',NULL);
CREATE FUNCTION pg_temp.require_refusal(p_club uuid,p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM sum(fees) FROM public.fn_ca_promo_shared_fee_state(p_club,p_user)
  WHERE principal_state='locked';
  RAISE EXCEPTION 'unfinished grant accepted a post-enforcement fee with no authoritative clock';
EXCEPTION WHEN check_violation THEN
  IF SQLERRM NOT LIKE 'promo_cash_fee_original_hand_clock_missing:%' THEN RAISE; END IF;
END $$;
SELECT pg_temp.require_refusal(:'club',:'member');
ROLLBACK;
