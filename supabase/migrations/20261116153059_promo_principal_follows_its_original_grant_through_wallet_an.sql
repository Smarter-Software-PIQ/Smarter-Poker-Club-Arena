-- @install-window: daily-maintenance
-- @locks: public.chip_ledger, public.ca_promo_play_through_grants
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.chip_ledger'::regclass AND tgname='zzz_ca_promo_custody' AND tgenabled='O')
-- One original grant, one fee target, several places holding its principal.
-- Gameplay spends unrestricted chips first. Withdrawals spend cashable chips.
-- Accepted hands retire lost principal inside the original money transaction.
-- Ticket/event custody cannot claim an unrelated later cash deposit.
BEGIN;
SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NULL)
    OR EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants) THEN
  RAISE EXCEPTION 'promo custody must install before programme activation';
 END IF;
END $$;

ALTER TABLE public.ca_promo_play_through_grants ADD CONSTRAINT ca_promo_principal_is_finite
 CHECK(amount::text NOT IN('NaN','Infinity','-Infinity') AND remaining::text NOT IN('NaN','Infinity','-Infinity')
  AND multiplier::text NOT IN('NaN','Infinity','-Infinity'));
CREATE FUNCTION public.fn_ca_promo_closed_grant_is_terminal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF OLD.closed_at IS NOT NULL AND
  ROW(NEW.id,NEW.club_id,NEW.user_id,NEW.amount,NEW.remaining,NEW.multiplier,NEW.source_kind,NEW.source_ref,
   NEW.source_ledger_id,NEW.funded_from_type,NEW.funded_from_id,NEW.cycle_started_at,NEW.granted_at,NEW.expires_at,NEW.closed_at,NEW.close_reason)
  IS DISTINCT FROM
  ROW(OLD.id,OLD.club_id,OLD.user_id,OLD.amount,OLD.remaining,OLD.multiplier,OLD.source_kind,OLD.source_ref,
   OLD.source_ledger_id,OLD.funded_from_type,OLD.funded_from_id,OLD.cycle_started_at,OLD.granted_at,OLD.expires_at,OLD.closed_at,OLD.close_reason) THEN
  RAISE EXCEPTION 'promo_closed_grant_is_terminal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_closed_grant_is_terminal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_closed_grant_is_terminal BEFORE UPDATE ON public.ca_promo_play_through_grants
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_closed_grant_is_terminal();

CREATE TABLE public.ca_promo_principal_custody (
 grant_id uuid NOT NULL REFERENCES public.ca_promo_play_through_grants(id),
 kind text NOT NULL CHECK(kind IN('player_wallet','agent_wallet','table_stack','pending_addon','ticket','event')),
 entity_id uuid NOT NULL,
 amount numeric NOT NULL CHECK(amount>=0 AND amount::text NOT IN('NaN','Infinity','-Infinity')),
 PRIMARY KEY(grant_id,kind,entity_id)
);
CREATE INDEX ca_promo_principal_custody_place ON public.ca_promo_principal_custody(kind,entity_id) WHERE amount>0;
CREATE TABLE public.ca_promo_cash_hand_funding (
 hand_id uuid NOT NULL,club_id uuid NOT NULL,user_id uuid NOT NULL,table_id uuid NOT NULL,
 principal_before numeric NOT NULL CHECK(principal_before>0),
 contribution numeric NOT NULL CHECK(contribution>=0),
 promo_contribution numeric NOT NULL CHECK(promo_contribution>=0 AND promo_contribution<=contribution),
 principal_lost numeric NOT NULL CHECK(principal_lost>=0 AND principal_lost<=principal_before),
 PRIMARY KEY(hand_id,club_id,user_id)
);
ALTER TABLE public.ca_promo_principal_custody ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_promo_cash_hand_funding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_principal_custody,public.ca_promo_cash_hand_funding FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_principal_custody,public.ca_promo_cash_hand_funding TO service_role;
-- Cash fees can post later than the accepted hand, and the original atomic
-- commit is pruned after eight days. Preserve only its canonical money clock
-- prospectively; no history-retention or bank/source timestamp is rewritten.
CREATE TABLE public.ca_promo_cash_hand_clocks (
 hand_id uuid PRIMARY KEY,table_id uuid NOT NULL,hand_number bigint NOT NULL,
 accepted_at timestamptz NOT NULL CHECK(isfinite(accepted_at))
);
ALTER TABLE public.ca_promo_cash_hand_clocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_cash_hand_clocks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_cash_hand_clocks TO service_role;
CREATE FUNCTION public.fn_ca_promo_cash_clock_is_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='public','pg_temp' AS $$
BEGIN RAISE EXCEPTION 'original_promo_cash_hand_clock_is_immutable' USING ERRCODE='23514';END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_cash_clock_is_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_cash_clock_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_cash_hand_clocks
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_cash_clock_is_immutable();
CREATE TRIGGER ca_promo_cash_clock_no_truncate BEFORE TRUNCATE ON public.ca_promo_cash_hand_clocks
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_cash_clock_is_immutable();
CREATE FUNCTION public.fn_ca_promo_capture_cash_hand_clock(p_hand uuid,p_table uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE h public.hand_atomic_commits%ROWTYPE;prior public.ca_promo_cash_hand_clocks%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.tables WHERE id=p_table AND tournament_id IS NOT NULL) THEN RETURN; END IF;
 SELECT * INTO h FROM public.hand_atomic_commits WHERE hand_id=p_hand AND table_id=p_table;
 IF NOT FOUND OR h.committed_at IS NULL OR NOT isfinite(h.committed_at) THEN
  RAISE EXCEPTION 'promo_cash_original_accepted_hand_missing' USING ERRCODE='23514'; END IF;
 INSERT INTO public.ca_promo_cash_hand_clocks VALUES(h.hand_id,h.table_id,h.hand_number,h.committed_at)
  ON CONFLICT(hand_id) DO NOTHING;
 SELECT * INTO STRICT prior FROM public.ca_promo_cash_hand_clocks WHERE hand_id=p_hand;
 IF ROW(prior.table_id,prior.hand_number,prior.accepted_at) IS DISTINCT FROM ROW(h.table_id,h.hand_number,h.committed_at) THEN
  RAISE EXCEPTION 'original_promo_cash_hand_clock_conflict' USING ERRCODE='23514'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_capture_cash_hand_clock(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_cash_fee_clock_missing(p_hand uuid) RETURNS numeric
LANGUAGE plpgsql STABLE SET search_path='public','pg_temp' AS $$
BEGIN RAISE EXCEPTION 'promo_cash_fee_original_hand_clock_missing: %',p_hand USING ERRCODE='23514';END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_cash_fee_clock_missing(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_seed_custody() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE place text;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT CASE WHEN l.to_type='agent_wallet' THEN 'agent_wallet' ELSE 'player_wallet' END
   INTO place FROM public.chip_ledger l WHERE l.id=NEW.source_ledger_id;
  INSERT INTO public.ca_promo_principal_custody VALUES(NEW.id,COALESCE(place,'player_wallet'),NEW.user_id,NEW.remaining);
 ELSIF NEW.closed_at IS NOT NULL THEN
  UPDATE public.ca_promo_principal_custody SET amount=0 WHERE grant_id=NEW.id AND amount<>0;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_seed_custody() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ca_promo_seed_custody AFTER INSERT OR UPDATE OF closed_at
 ON public.ca_promo_play_through_grants FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_seed_custody();

-- Exact positive fee sources remain eligible until an original immutable
-- refund receipt names their rake-record identity. A refund from an older
-- cycle cannot subtract a later entry's fee merely because the event matches.
-- These are the same direct-positive references required by the canonical
-- fn_accounting_tournament_fee_net_plan, including its nested-refund case.
CREATE FUNCTION public.fn_ca_promo_fee_events(p_club uuid,p_user uuid,p_from timestamptz,p_to timestamptz)
RETURNS TABLE(earned_at timestamptz,fee_credit numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
 WITH cash AS MATERIALIZED (
  SELECT COALESCE(h.accepted_at,CASE WHEN isfinite(original.committed_at) THEN original.committed_at END,a.created_at) AS earned_at,
   CASE WHEN h.hand_id IS NULL AND (original.committed_at IS NULL OR NOT isfinite(original.committed_at))
    AND a.rake_amount<>0 AND a.created_at>=(SELECT enforced_from FROM public.ca_promo_play_through_settings WHERE id)
    THEN public.fn_ca_promo_cash_fee_clock_missing(a.hand_id) ELSE a.rake_amount END AS fee_credit
  FROM public.rake_attributions a LEFT JOIN public.ca_promo_cash_hand_clocks h ON h.hand_id=a.hand_id
   LEFT JOIN public.hand_atomic_commits original ON h.hand_id IS NULL AND original.hand_id=a.hand_id
  WHERE a.player_id=p_user AND a.club_id=p_club AND (a.created_at<p_to OR h.accepted_at<p_to OR original.committed_at<p_to)
 ), sources AS MATERIALIZED (
  SELECT s.id,s.rake_record_id,s.tournament_id,s.charged_at,s.rake_credit
   FROM public.accounting_tournament_fee_sources s
   WHERE s.club_id=p_club AND s.player_id=p_user AND s.charged_at>=p_from AND s.charged_at<p_to
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
    OR COALESCE((c.metadata->'original_rake_record_ids') ? s.rake_record_id::text,false)));
$$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.fn_ca_promo_play_through_fees_between(p_club_id uuid,p_user_id uuid,p_from timestamptz,p_to timestamptz)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
 SELECT COALESCE(sum(e.fee_credit),0) FROM public.fn_ca_promo_fee_events(p_club_id,p_user_id,p_from,p_to) e;
$$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_play_through_fees_between(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_play_through_fees_between(uuid,uuid,timestamptz,timestamptz) TO service_role;

-- A closed grant retains the fees it actually consumed before closing. Its
-- unused target disappears, but its already-used fees cannot pay a newer grant
-- again. Recompute that consumed prefix from current net fee sources at the
-- immutable closure time: a later refund reverses the proper old consumption.
-- A completed unlock is terminal. Its original target and completion stamp
-- remain history; a refund neither resurrects its principal nor creates debt
-- for a later grant. All fee-source and closure boundaries are evaluated in
-- one scan, rather than scanning thirty days again for every closed grant.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_play_through_state(p_club_id uuid,p_user_id uuid)
RETURNS TABLE(grant_id uuid,amount numeric,remaining numeric,fee_target numeric,cum_target numeric,
 cycle_started_at timestamptz,cycle_fees numeric,granted_at timestamptz,expires_at timestamptz,state text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE v_cycle timestamptz;v_now timestamptz:=clock_timestamp();v_fees numeric;
 v_observed jsonb;v_prefix numeric:=0;v_forfeited numeric:=0;v_consumed numeric;
 v_rows jsonb:='[]';v_status text;r record;
BEGIN
 SELECT min(g.cycle_started_at) INTO v_cycle FROM public.ca_promo_play_through_grants g
  WHERE g.club_id=p_club_id AND g.user_id=p_user_id AND g.closed_at IS NULL;
 IF v_cycle IS NULL THEN RETURN; END IF;
 WITH events AS MATERIALIZED (
  SELECT e.earned_at AS at,e.fee_credit AS credit FROM public.fn_ca_promo_fee_events(p_club_id,p_user_id,v_cycle,v_now) e
 ), boundaries AS (
  SELECT v_now AS at,'now'::text AS key
  UNION ALL
  SELECT LEAST(g.closed_at,COALESCE(g.expires_at,g.closed_at)),'c:'||g.id
   FROM public.ca_promo_play_through_grants g
   WHERE g.club_id=p_club_id AND g.user_id=p_user_id AND g.cycle_started_at=v_cycle AND g.closed_at IS NOT NULL
  UNION ALL
  SELECT g.expires_at,'e:'||g.id FROM public.ca_promo_play_through_grants g
   WHERE g.club_id=p_club_id AND g.user_id=p_user_id AND g.cycle_started_at=v_cycle AND g.expires_at<=v_now
 ), observations AS (
  SELECT x.key,sum(x.credit) OVER(ORDER BY x.at,x.ordinal ROWS UNBOUNDED PRECEDING) AS fees
   FROM(SELECT e.at,1 AS ordinal,e.credit,NULL::text AS key FROM events e
    UNION ALL SELECT b.at,0,0::numeric,b.key FROM boundaries b) x
 ) SELECT jsonb_object_agg(o.key,COALESCE(o.fees,0)) INTO v_observed FROM observations o WHERE o.key IS NOT NULL;
 v_fees:=COALESCE((v_observed->>'now')::numeric,0);
 FOR r IN SELECT g.* FROM public.ca_promo_play_through_grants g
  WHERE g.club_id=p_club_id AND g.user_id=p_user_id AND g.cycle_started_at=v_cycle ORDER BY g.granted_at,g.id LOOP
  IF r.closed_at IS NOT NULL THEN
   v_consumed:=LEAST(r.fee_target,GREATEST(COALESCE((v_observed->>('c:'||r.id))::numeric,0)-v_prefix,0));
   v_prefix:=v_prefix+v_consumed;
   IF r.close_reason<>'met' THEN v_forfeited:=v_forfeited+v_consumed; CONTINUE; END IF;
   v_status:='met';
  ELSIF r.expires_at IS NOT NULL AND r.expires_at<=v_now
    AND COALESCE((v_observed->>('e:'||r.id))::numeric,0)<v_prefix+r.fee_target THEN
   -- Expiry ends the unearned target even while principal is still on felt.
   -- Preserve only fees actually consumed before expiry, refund-safe, and
   -- retain this row so its surviving principal still returns to its fund.
   v_consumed:=LEAST(r.fee_target,GREATEST(COALESCE((v_observed->>('e:'||r.id))::numeric,0)-v_prefix,0));
   v_prefix:=v_prefix+v_consumed;v_forfeited:=v_forfeited+v_consumed;
   v_status:='expired_pending';
  ELSE
   v_prefix:=v_prefix+r.fee_target;
   v_status:=CASE WHEN v_fees>=v_prefix AND (r.expires_at IS NULL OR r.expires_at>v_now
    OR COALESCE((v_observed->>('e:'||r.id))::numeric,0)>=v_prefix) THEN 'met_pending'
    WHEN r.expires_at IS NOT NULL AND r.expires_at<=v_now THEN 'expired_pending' ELSE 'locked' END;
  END IF;
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object('grant_id',r.id,'amount',r.amount,'remaining',r.remaining,
   'fee_target',r.fee_target,'cum_target',v_prefix-v_forfeited,'granted_at',r.granted_at,'expires_at',r.expires_at,'state',v_status));
 END LOOP;
 RETURN QUERY SELECT j.grant_id,j.amount,j.remaining,j.fee_target,j.cum_target,v_cycle,
  GREATEST(v_fees-v_forfeited,0),j.granted_at,j.expires_at,j.state
  FROM jsonb_to_recordset(v_rows) AS j(grant_id uuid,amount numeric,remaining numeric,fee_target numeric,
   cum_target numeric,granted_at timestamptz,expires_at timestamptz,state text) ORDER BY j.granted_at,j.grant_id;
END $$;

REVOKE ALL ON FUNCTION public.fn_ca_promo_play_through_state(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_play_through_state(uuid,uuid) TO service_role;

-- Owner-only helper. NULL destination consumes or returns actual principal;
-- actual chip movement remains owned by the original ledger-backed door.
CREATE FUNCTION public.fn_ca_promo_move_selected_custody(
 p_club uuid,p_user uuid,p_from text,p_from_id uuid,p_to text,p_to_id uuid,p_amount numeric,p_reason text,p_grants uuid[]
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record;take numeric;left_to_move numeric:=p_amount;moved numeric:=0;
BEGIN
 IF p_amount IS NULL OR p_amount<0 OR p_amount::text IN('NaN','Infinity','-Infinity')
  OR p_reason NOT IN('spent','returned','expired','left_club') THEN RAISE EXCEPTION 'invalid_promo_custody_move'; END IF;
 IF p_to=p_from AND p_to_id=p_from_id THEN RETURN 0; END IF;
 FOR r IN SELECT c.grant_id,c.amount FROM public.ca_promo_principal_custody c
  JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
  WHERE g.club_id=p_club AND g.user_id=p_user AND g.closed_at IS NULL
   AND c.kind=p_from AND c.entity_id=p_from_id AND c.amount>0
   AND g.id=ANY(p_grants)
  ORDER BY g.granted_at,g.id FOR UPDATE OF g,c LOOP
  EXIT WHEN left_to_move<=0;
  take:=LEAST(r.amount,left_to_move);
  IF p_to IS NOT NULL THEN
   -- Both places change in one statement. This also conserves principal when
   -- an original money owner has SET CONSTRAINTS ALL IMMEDIATE in force.
   WITH departed AS (
    UPDATE public.ca_promo_principal_custody SET amount=amount-take
     WHERE grant_id=r.grant_id AND kind=p_from AND entity_id=p_from_id RETURNING grant_id
   ) INSERT INTO public.ca_promo_principal_custody(grant_id,kind,entity_id,amount)
    SELECT departed.grant_id,p_to,p_to_id,take FROM departed
    ON CONFLICT(grant_id,kind,entity_id) DO UPDATE SET amount=ca_promo_principal_custody.amount+EXCLUDED.amount;
  ELSE
   WITH departed AS (
    UPDATE public.ca_promo_principal_custody SET amount=amount-take
     WHERE grant_id=r.grant_id AND kind=p_from AND entity_id=p_from_id RETURNING grant_id
   ) UPDATE public.ca_promo_play_through_grants SET remaining=remaining-take,
    closed_at=CASE WHEN remaining=take THEN clock_timestamp() ELSE NULL END,
    close_reason=CASE WHEN remaining=take THEN p_reason ELSE NULL END WHERE id IN(SELECT grant_id FROM departed);
  END IF;
  moved:=moved+take;left_to_move:=left_to_move-take;
 END LOOP;
 RETURN moved;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_move_selected_custody(uuid,uuid,text,uuid,text,uuid,numeric,text,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_move_custody(
 p_club uuid,p_user uuid,p_from text,p_from_id uuid,p_to text,p_to_id uuid,p_amount numeric,p_reason text DEFAULT 'spent'
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE ids uuid[];
BEGIN
 SELECT array_agg(s.grant_id) INTO ids FROM public.fn_ca_promo_play_through_state(p_club,p_user) s
  WHERE s.state IN('locked','expired_pending');
 RETURN public.fn_ca_promo_move_selected_custody(p_club,p_user,p_from,p_from_id,p_to,p_to_id,p_amount,p_reason,ids);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_move_custody(uuid,uuid,text,uuid,text,uuid,numeric,text) FROM PUBLIC,anon,authenticated,service_role;

-- Admission uses the original money owner's exact source balance, not a
-- guessed current wallet balance. This makes cashout/rebuy and moving an own
-- wallet behave exactly like leaving the same chips in place.
CREATE TABLE public.ca_promo_funding_custody_receipts (
 ledger_id uuid PRIMARY KEY,source_balance_before numeric NOT NULL,
 amount numeric NOT NULL,covered_amount numeric NOT NULL DEFAULT 0,
 wallet_funded_amount numeric GENERATED ALWAYS AS(amount-covered_amount) STORED,
 destination_kind text NOT NULL,destination_id uuid NOT NULL,principal_before numeric NOT NULL CHECK(principal_before>=0),
 principal_moved numeric NOT NULL CHECK(principal_moved>=0 AND principal_moved<=principal_before),
 CHECK(amount>0 AND covered_amount>=0 AND covered_amount<=amount)
);
ALTER TABLE public.ca_promo_funding_custody_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_funding_custody_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_funding_custody_receipts TO service_role;
CREATE FUNCTION public.fn_ca_promo_fund_from_balance(p_ledger uuid,p_before numeric,p_kind text,p_entity uuid,p_covered numeric DEFAULT 0)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;prior public.ca_promo_funding_custody_receipts%ROWTYPE;
 ids uuid[];active_ids uuid[];expired_ids uuid[];locked numeric:=0;expired numeric:=0;requested numeric;moved numeric:=0;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 IF l.from_type NOT IN('player_wallet','agent_wallet') OR l.amount<=0 OR l.club_id IS NULL
  OR COALESCE(l.status,'posted')<>'posted' OR p_before IS NULL OR p_before<l.amount
  OR p_before::text IN('NaN','Infinity','-Infinity') OR p_entity IS NULL
  OR p_covered IS NULL OR p_covered<0 OR p_covered>l.amount THEN
  RAISE EXCEPTION 'original_promo_funding_balance_required'; END IF;
 SELECT * INTO prior FROM public.ca_promo_funding_custody_receipts WHERE ledger_id=l.id;
 IF FOUND THEN
  IF prior.source_balance_before IS DISTINCT FROM p_before OR prior.destination_kind IS DISTINCT FROM p_kind
   OR prior.destination_id IS DISTINCT FROM p_entity OR prior.covered_amount IS DISTINCT FROM p_covered THEN RAISE EXCEPTION 'original_promo_funding_receipt_conflict'; END IF;
  RETURN prior.principal_moved;
 END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN
  PERFORM public.fn_ca_promo_play_through_settle(l.club_id,l.from_entity_id);
  SELECT array_agg(s.grant_id),array_agg(s.grant_id) FILTER(WHERE s.state='locked'),
   array_agg(s.grant_id) FILTER(WHERE s.state='expired_pending') INTO ids,active_ids,expired_ids
   FROM public.fn_ca_promo_play_through_state(l.club_id,l.from_entity_id) s
   WHERE s.state IN('locked','expired_pending');
  SELECT COALESCE(sum(c.amount),0),COALESCE(sum(c.amount) FILTER(WHERE c.grant_id=ANY(expired_ids)),0)
   INTO locked,expired FROM public.ca_promo_principal_custody c
   WHERE c.grant_id=ANY(ids) AND c.kind=l.from_type AND c.entity_id=l.from_entity_id;
  -- Table exits remain unconditional. A new admission cannot renew expired
  -- principal while its original fund return awaits the bounded expiry tick.
  IF p_kind IN('table_stack','pending_addon','event') AND l.amount>p_before-expired THEN
   RAISE EXCEPTION 'Expired Promo Is Awaiting Return To Its Original Fund. Use Your Cashable Chips Or Unexpired Promo For A New Entry.'
    USING ERRCODE='P0001',HINT='expired_promo_cannot_fund_new_play';
  END IF;
  requested:=LEAST(locked,GREATEST(l.amount-GREATEST(p_before-locked,0),0));
  moved:=public.fn_ca_promo_move_selected_custody(l.club_id,l.from_entity_id,l.from_type,l.from_entity_id,p_kind,p_entity,requested,'spent',
   CASE WHEN p_kind IN('table_stack','pending_addon','event') THEN active_ids ELSE ids END);
 END IF;
 INSERT INTO public.ca_promo_funding_custody_receipts(ledger_id,source_balance_before,amount,covered_amount,destination_kind,destination_id,principal_before,principal_moved)
  VALUES(l.id,p_before,l.amount,p_covered,p_kind,p_entity,locked,moved);
 RETURN moved;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_fund_from_balance(uuid,numeric,text,uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_move_owned_wallet(p_ledger uuid,p_before numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 IF l.from_type NOT IN('player_wallet','agent_wallet') OR l.to_type NOT IN('player_wallet','agent_wallet')
  OR l.from_entity_id IS DISTINCT FROM l.to_entity_id THEN RAISE EXCEPTION 'original_own_wallet_movement_required'; END IF;
 RETURN public.fn_ca_promo_fund_from_balance(l.id,p_before,l.to_type,l.to_entity_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_move_owned_wallet(uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_apply_original_cash_funding(p_receipt uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE f public.cash_participant_funding_receipts%ROWTYPE;
BEGIN
 SELECT * INTO STRICT f FROM public.cash_participant_funding_receipts WHERE id=p_receipt;
 IF f.account_type<>'player_wallet' THEN RETURN 0; END IF;
 RETURN public.fn_ca_promo_fund_from_balance(f.source_ledger_id,f.balance_before,
  CASE WHEN f.pending_addon_id IS NULL THEN 'table_stack' ELSE 'pending_addon' END,COALESCE(f.pending_addon_id,f.table_id));
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_apply_original_cash_funding(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.ca_promo_pending_custody_receipts (
 pending_addon_id uuid PRIMARY KEY,principal_before numeric NOT NULL,principal_applied numeric NOT NULL,principal_refunded numeric NOT NULL,
 CHECK(principal_applied>=0 AND principal_refunded>=0 AND principal_applied+principal_refunded=principal_before)
);
ALTER TABLE public.ca_promo_pending_custody_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_pending_custody_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_pending_custody_receipts TO service_role;
CREATE FUNCTION public.fn_ca_promo_apply_pending_cash_funding(p_pending uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE f public.cash_participant_funding_receipts%ROWTYPE;a public.cash_funding_application_receipts%ROWTYPE;
 pending numeric;applied numeric;refunded numeric;unused numeric;place uuid;
BEGIN
 SELECT * INTO STRICT a FROM public.cash_funding_application_receipts WHERE pending_addon_id=p_pending;
 SELECT * INTO STRICT f FROM public.cash_participant_funding_receipts WHERE id=a.funding_receipt_id;
 IF EXISTS(SELECT 1 FROM public.ca_promo_pending_custody_receipts WHERE pending_addon_id=p_pending) THEN RETURN; END IF;
 PERFORM public.fn_ca_promo_play_through_settle(f.funding_club_id,f.user_id);
 pending:=public.fn_ca_promo_locked_at(f.funding_club_id,f.user_id,'pending_addon',p_pending);
 applied:=LEAST(pending,GREATEST(a.applied-GREATEST(f.amount-pending,0),0));refunded:=pending-applied;
 IF applied>0 THEN
  SELECT s.table_id INTO STRICT place FROM public.table_seats s WHERE s.occupancy_id=a.applied_occupancy_id AND s.user_id=f.user_id;
  unused:=public.fn_ca_promo_move_custody(f.funding_club_id,f.user_id,'pending_addon',p_pending,'table_stack',place,applied);
 END IF;
 IF refunded>0 THEN
  unused:=public.fn_ca_promo_move_custody(f.funding_club_id,f.user_id,'pending_addon',p_pending,'player_wallet',f.user_id,refunded);
 END IF;
 INSERT INTO public.ca_promo_pending_custody_receipts VALUES(p_pending,pending,applied,refunded);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_apply_pending_cash_funding(uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $funding$
DECLARE def text;needle text:=E' RETURN v_id;';signature text:='public.fn_cash_record_original_funding(text,text,uuid,uuid,uuid,uuid,uuid,numeric,numeric,uuid)';
BEGIN
 SELECT pg_get_functiondef(signature::regprocedure) INTO def;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_cash_funding_promo_anchor_changed'; END IF;
 EXECUTE replace(def,needle,E' PERFORM public.fn_ca_promo_apply_original_cash_funding(v_id);\n'||needle);
 signature:='public.fn_cash_record_funding_application(uuid,numeric,numeric,uuid)';
 SELECT pg_get_functiondef(signature::regprocedure) INTO def;
 needle:=' VALUES(p_pending,f.id,f.occupancy_id,p_occupancy,p_applied,p_refunded);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_pending_cash_funding_promo_anchor_changed'; END IF;
 EXECUTE replace(def,needle,needle||E'\n PERFORM public.fn_ca_promo_apply_pending_cash_funding(p_pending);');
END $funding$;

CREATE FUNCTION public.fn_ca_promo_locked_at(p_club uuid,p_user uuid,p_kind text,p_entity uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
 SELECT COALESCE(sum(c.amount),0) FROM public.ca_promo_principal_custody c
 JOIN public.fn_ca_promo_play_through_state(p_club,p_user) s ON s.grant_id=c.grant_id
 WHERE c.kind=p_kind AND c.entity_id=p_entity AND s.state IN('locked','expired_pending');
$$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_locked_at(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_custody_on_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE uid uuid;dest text;dest_id uuid;debit jsonb;moved numeric:=0;
BEGIN
 IF NEW.amount<=0 OR NEW.club_id IS NULL OR COALESCE(NEW.status,'posted')<>'posted' THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN RETURN NULL; END IF;
 IF NEW.to_type='agent_wallet' AND (NEW.from_type='promo_wallet'
  OR (NEW.from_type='union_wallet' AND NEW.from_label='union_wallets.promo_wallet'))
  AND NEW.category NOT IN('settlement','reversal','refund','correction','adjustment') THEN
  PERFORM public.fn_ca_promo_play_through_record_grant(NEW.club_id,NEW.to_entity_id,NEW.amount,
   'agent_promo','chip_ledger:'||NEW.id,NEW.id,NEW.from_type,NEW.from_entity_id,NULL);
 END IF;
 IF NEW.from_type IN('player_wallet','agent_wallet') THEN
  uid:=NEW.from_entity_id;
  -- Own-wallet and cash-table admissions run at their original balance owner,
  -- which supplies exact source balance. Never guess it from this ledger hook.
  IF NEW.to_type='prize_liability' AND NEW.category IN('tournament_buyin','tournament_rebuy','rebuy','reentry','addon') THEN dest:='event';dest_id:=NEW.to_entity_id;
  END IF;
  IF dest IS NOT NULL THEN
   PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id,uid);
   IF dest='event' THEN
    debit:=NULLIF(current_setting('app.ca_promo_wallet_debit',true),'')::jsonb;
    IF debit->>'user_id' IS DISTINCT FROM uid::text OR debit->>'club_id' IS DISTINCT FROM NEW.club_id::text
     OR debit->>'category' IS DISTINCT FROM NEW.category OR debit->>'tournament_id' IS DISTINCT FROM NEW.to_entity_id::text
     OR (debit->>'amount')::numeric IS DISTINCT FROM NEW.amount
     OR COALESCE(NULLIF(debit->>'operation_key',''),NULLIF(debit->>'context_token','')) IS NULL THEN
     RAISE EXCEPTION 'original_tournament_promo_balance_required'; END IF;
    moved:=public.fn_ca_promo_fund_from_balance(NEW.id,(debit->>'balance_before')::numeric,dest,dest_id);
   ELSE
    moved:=public.fn_ca_promo_move_custody(NEW.club_id,uid,NEW.from_type,uid,dest,dest_id,NEW.amount);
   END IF;
   IF dest='event' THEN
    PERFORM public.fn_ca_promo_record_event_charge(NEW.id);
    PERFORM public.fn_ca_promo_capture_entry_funding(NEW.id,moved);
   END IF;
  END IF;
 ELSIF NEW.to_type='player_wallet' AND NEW.from_type IN('table_stack','prize_liability') THEN
  uid:=NEW.to_entity_id;
  dest:=CASE NEW.from_type WHEN 'table_stack' THEN 'table_stack' ELSE 'event' END;
  PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id,uid);
  IF dest='event' THEN
   PERFORM public.fn_ca_promo_realize_event_principal(NEW.id);
  ELSIF NEW.category='table_cashout' THEN
   PERFORM public.fn_ca_promo_move_custody(NEW.club_id,uid,dest,NEW.from_entity_id,'player_wallet',uid,NEW.amount);
  END IF;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_custody_on_ledger() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzz_ca_promo_custody AFTER INSERT ON public.chip_ledger
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_custody_on_ledger();
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note) VALUES
 ('chip_ledger','zzz_ca_promo_custody','Original promo principal follows gameplay and same-owner wallet movements without another fee target. Moves no chips.');

-- Only principal held in this wallet restricts this wallet.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_play_through_on_exit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE locked numeric;balance numeric;s jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE club_id=NEW.club_id AND user_id=NEW.from_entity_id AND closed_at IS NULL) THEN RETURN NULL; END IF;
 PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id,NEW.from_entity_id);
 locked:=public.fn_ca_promo_locked_at(NEW.club_id,NEW.from_entity_id,NEW.from_type,NEW.from_entity_id);
 IF locked<=0 THEN RETURN NULL; END IF;
 IF NEW.from_type='agent_wallet' THEN
  SELECT agent_wallet_balance INTO balance FROM public.agents WHERE club_id=NEW.club_id AND user_id=NEW.from_entity_id;
 ELSE
  SELECT chip_balance INTO balance FROM public.club_members WHERE club_id=NEW.club_id AND user_id=NEW.from_entity_id;
 END IF;
 IF COALESCE(balance,0)>=locked THEN RETURN NULL; END IF;
 IF NEW.to_type IN('club_treasury','promo_wallet','union_wallet') THEN
  PERFORM public.fn_ca_promo_move_custody(NEW.club_id,NEW.from_entity_id,NEW.from_type,NEW.from_entity_id,
   NULL,NULL,locked-GREATEST(COALESCE(balance,0),0),'returned');
 ELSE
  s:=public.fn_ca_promo_play_through_summary(NEW.club_id,NEW.from_entity_id);
  RAISE EXCEPTION 'Promo Play Through: % Promo Chips Stay Locked Until % More Chips In Fees Are Paid.',
   trim(to_char(locked,'FM999999999990.00')),trim(to_char((s->>'fee_remaining')::numeric,'FM999999999990.00'))
   USING ERRCODE='P0001',HINT='promo_play_through_locked';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER zz_ca_agent_promo_exit AFTER INSERT ON public.chip_ledger
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN(NEW.from_type='agent_wallet' AND NEW.amount>0 AND NEW.club_id IS NOT NULL
  AND COALESCE(NEW.status,'posted')='posted' AND
  (NEW.to_type IN('player_wallet','agent_wallet','club_treasury','promo_wallet','union_wallet','escrow','credit_facility')))
 EXECUTE FUNCTION public.fn_ca_promo_play_through_on_exit();
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note) VALUES
 ('chip_ledger','zz_ca_agent_promo_exit','An agent cannot cash out or transfer locked principal; same-owner movements retain its custody.');
CREATE CONSTRAINT TRIGGER zz_ca_player_promo_credit_repayment AFTER INSERT ON public.chip_ledger
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN(NEW.from_type='player_wallet' AND NEW.to_type='credit_facility' AND NEW.amount>0
  AND NEW.club_id IS NOT NULL AND COALESCE(NEW.status,'posted')='posted')
 EXECUTE FUNCTION public.fn_ca_promo_play_through_on_exit();
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note) VALUES
 ('chip_ledger','zz_ca_player_promo_credit_repayment','Credit repayment cannot consume locked promo principal; unrestricted chips remain usable.');
CREATE CONSTRAINT TRIGGER zz_ca_player_promo_ticket_issue_exit AFTER INSERT ON public.chip_ledger
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN(NEW.from_type='player_wallet' AND NEW.to_type='escrow' AND NEW.category='ticket_issue' AND NEW.amount>0
  AND NEW.club_id IS NOT NULL AND COALESCE(NEW.status,'posted')='posted')
 EXECUTE FUNCTION public.fn_ca_promo_play_through_on_exit();
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note) VALUES
 ('chip_ledger','zz_ca_player_promo_ticket_issue_exit','A ticket cannot transfer locked promo to another player. Original same-holder ticket funding retains its principal.');

-- Retire the estimated-loss owner: exact accepted-hand custody replaces it.
DROP TRIGGER zz_ca_promo_play_through_real_chips ON public.chip_ledger;
DROP FUNCTION public.fn_ca_promo_play_through_on_real_chips();
DELETE FROM public.ca_declared_money_triggers WHERE table_name='chip_ledger' AND trigger_name='zz_ca_promo_play_through_real_chips';

DO $summary$
DECLARE def text;needle text:=E'''cashable'',      GREATEST(v_balance - v_locked, 0),';anchor text;
BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_play_through_summary(uuid,uuid)'::regprocedure) INTO def;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_summary_custody_anchor_changed'; END IF;
 def:=replace(def,needle,E'''cashable'', GREATEST(v_balance - public.fn_ca_promo_locked_at(p_club_id,p_user_id,''player_wallet'',p_user_id),0),\n    ''expired_locked'',v_expired,\n    ''wallet_locked'',public.fn_ca_promo_locked_at(p_club_id,p_user_id,''player_wallet'',p_user_id),\n    ''agent_locked'',public.fn_ca_promo_locked_at(p_club_id,p_user_id,''agent_wallet'',p_user_id),');
 anchor:=E'  v_progress    numeric := 0;';
 IF length(def)-length(replace(def,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'promo_summary_expired_variable_changed'; END IF;
 def:=replace(def,anchor,anchor||E'\n  v_expired numeric := 0;');
 anchor:=E'         count(*) FILTER (WHERE s.state IN (''locked'', ''expired_pending'')),';
 IF length(def)-length(replace(def,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'promo_summary_expired_source_changed'; END IF;
 def:=replace(def,anchor,anchor||E'\n         COALESCE(sum(s.remaining) FILTER (WHERE s.state = ''expired_pending''),0),');
 anchor:='INTO v_locked, v_target, v_fees, v_open, v_next_expiry';
 IF length(def)-length(replace(def,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'promo_summary_expired_result_changed'; END IF;
 def:=replace(def,anchor,'INTO v_locked, v_target, v_fees, v_open, v_expired, v_next_expiry');
 EXECUTE def;
END $summary$;

CREATE FUNCTION public.fn_ca_promo_custody_is_conserved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE gid uuid;held numeric;owed numeric;
BEGIN
 IF TG_TABLE_NAME='ca_promo_play_through_grants' THEN gid:=NEW.id; ELSE gid:=NEW.grant_id; END IF;
 SELECT remaining INTO owed FROM public.ca_promo_play_through_grants WHERE id=gid;
 SELECT COALESCE(sum(amount),0) INTO held FROM public.ca_promo_principal_custody WHERE grant_id=gid;
 IF held IS DISTINCT FROM owed THEN RAISE EXCEPTION 'promo_principal_custody_not_conserved' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_custody_is_conserved() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER ca_promo_custody_conserved AFTER INSERT OR UPDATE ON public.ca_promo_principal_custody
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_custody_is_conserved();
CREATE CONSTRAINT TRIGGER ca_promo_grant_custody_conserved AFTER INSERT OR UPDATE ON public.ca_promo_play_through_grants
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_custody_is_conserved();

CREATE FUNCTION public.fn_ca_promo_accept_cash_hand(p_hand uuid,p_table uuid,p_stacks jsonb,p_facts jsonb,p_places jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE s jsonb;r record;before_promo numeric;investment numeric;loss numeric;unused numeric;place uuid;ids uuid[];promo_investment numeric;
BEGIN
 PERFORM public.fn_ca_promo_capture_cash_hand_clock(p_hand,p_table);
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_principal_custody c WHERE c.kind='table_stack' AND c.amount>0
  AND (c.entity_id=p_table OR c.entity_id IN(SELECT value::uuid FROM jsonb_each_text(p_places)))) THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.tables WHERE id=p_table AND tournament_id IS NOT NULL) THEN RETURN; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_stacks) ORDER BY value->>'user_id' LOOP
  place:=COALESCE((p_places->>(s->>'user_id'))::uuid,p_table);
  FOR r IN SELECT DISTINCT g.club_id,g.user_id FROM public.ca_promo_principal_custody c
   JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
   WHERE c.kind='table_stack' AND c.entity_id=place AND c.amount>0 AND g.closed_at IS NULL
    AND g.user_id=(s->>'user_id')::uuid ORDER BY g.club_id,g.user_id LOOP
   -- The table's original money owner already holds its table mutex. Lock the
   -- member's grants in FIFO order before taking one fee snapshot, so another
   -- table cannot retire the same principal from a stale snapshot.
   PERFORM 1 FROM public.ca_promo_play_through_grants g WHERE g.club_id=r.club_id AND g.user_id=r.user_id
    AND g.closed_at IS NULL ORDER BY g.granted_at,g.id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.ca_promo_cash_hand_funding WHERE hand_id=p_hand AND club_id=r.club_id AND user_id=r.user_id) THEN CONTINUE; END IF;
   SELECT array_agg(state.grant_id) INTO ids FROM public.fn_ca_promo_play_through_state(r.club_id,r.user_id) state
    WHERE state.state IN('locked','expired_pending');
   SELECT COALESCE(sum(c.amount),0) INTO before_promo FROM public.ca_promo_principal_custody c
    WHERE c.grant_id=ANY(ids) AND c.kind='table_stack' AND c.entity_id=place;
   IF before_promo<=0 THEN CONTINUE; END IF;
   investment:=GREATEST(COALESCE((p_facts->'contributions'->>r.user_id::text)::numeric,0)
    -COALESCE((p_facts->'returned_uncalled'->>r.user_id::text)::numeric,0),0);
   -- A win does not create more promo. A later loss first consumes the free
   -- winnings/own chips in this same position, so returning to the original
   -- fifty after winning fifty still holds the original fifty principal.
   loss:=LEAST(before_promo,GREATEST(before_promo-(s->>'stack')::numeric,0));
   promo_investment:=LEAST(before_promo,GREATEST(investment-GREATEST((s->>'stack_before')::numeric-before_promo,0),0));
   INSERT INTO public.ca_promo_cash_hand_funding VALUES(p_hand,r.club_id,r.user_id,place,before_promo,
    investment,promo_investment,loss);
   unused:=public.fn_ca_promo_move_selected_custody(r.club_id,r.user_id,'table_stack',place,NULL,NULL,loss,'spent',ids);
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_accept_cash_hand(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Before the immutable envelope can wake the existing rake consumer. Replay
-- skips this branch. The payload stays compatible. Programme activation waits
-- for the engine's original addon owner to queue credits during settlement.
DO $patch$
DECLARE def text;needle text:=E'  IF v_existing_request_hash IS NULL THEN\n';
BEGIN
 SELECT pg_get_functiondef('public.fn_ca_commit_hand_settlement(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid,jsonb)'::regprocedure) INTO def;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'accepted_hand_promo_patch_anchor_changed'; END IF;
 def:=replace(def,needle,needle||E'    PERFORM public.fn_ca_promo_accept_cash_hand(v_hand_id,p_table_id,p_stacks,p_hand_row->''_accepted_post_commit_facts'',v_lightning_seats);\n');
 EXECUTE def;
END $patch$;
COMMIT;
