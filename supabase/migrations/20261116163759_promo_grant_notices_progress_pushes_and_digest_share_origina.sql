-- @install-window: daily-maintenance
-- @locks: public.rake_attributions, public.accounting_tournament_fee_sources, public.ledger_reconcile_log
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.rake_attributions'::regclass AND tgname='ca_promo_fee_notice' AND tgenabled='O') AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.accounting_tournament_fee_sources'::regclass AND tgname='ca_promo_entry_notice' AND tgenabled='O') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ledger_reconcile_log'::regclass AND conname='ledger_reconcile_log_entity_type_check' AND convalidated AND position('promo_principal_custody' in pg_get_constraintdef(oid))>0) AND EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.reconcile_ledger_nightly()'::regprocedure AND position('FROM public.ca_promo_play_through_grants g LEFT JOIN public.ca_promo_principal_custody c' in prosrc)>0) AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.ca_promo_integrity_releases'::regclass AND tgname='ca_promo_integrity_release_notice' AND tgenabled='O') AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.ca_promo_event_fee_consumption_receipts'::regclass AND tgname='ca_promo_paid_entry_notice' AND tgenabled='O') AND to_regprocedure('public.fn_ca_promo_notice_profit_unlocked(uuid,timestamptz)') IS NOT NULL AND NOT has_function_privilege('authenticated','public.fn_ca_promo_notice_profit_unlocked(uuid,timestamptz)','EXECUTE')
-- Existing notification delivery owns push preferences, caps and devices.
-- Notices observe original grants and accepted fees; they never settle a grant,
-- acquire a member wallet lock, return chips or change an earned fee.
BEGIN;
SET LOCAL lock_timeout='1s';
DO $dependencies$ BEGIN
 IF to_regclass('public.ca_promo_event_fee_consumption_receipts') IS NULL OR to_regprocedure('public.fn_ca_promo_original_entry_fee_events(uuid,uuid,timestamptz,timestamptz)') IS NULL THEN
  RAISE EXCEPTION 'original_paid_entry_fee_source_required'; END IF;
 IF to_regclass('public.ca_promo_principal_custody') IS NULL
  OR to_regclass('public.ca_promo_principal_return_receipts') IS NULL
  OR to_regclass('public.ca_promo_integrity_source_grants') IS NULL
  OR to_regclass('public.ca_promo_integrity_cases') IS NULL
  OR to_regclass('public.ca_promo_integrity_releases') IS NULL
  OR to_regclass('public.ca_promo_integrity_custody') IS NULL THEN
  RAISE EXCEPTION 'promo_notice_original_source_dependencies_missing';
 END IF;
END $dependencies$;
CREATE TABLE public.ca_promo_notice_milestones (
 grant_id uuid NOT NULL,
 milestone text NOT NULL CHECK(milestone IN('received','half','near','unlocked','manual_release','profit_unlocked','support_override')),
 notification_id uuid UNIQUE,
 principal_amount numeric NOT NULL CHECK(principal_amount>=0),
 fee_progress numeric NOT NULL CHECK(fee_progress>=0),
 fee_target numeric NOT NULL CHECK(fee_target>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(grant_id,milestone)
);
ALTER TABLE public.ca_promo_notice_milestones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_notice_milestones FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_notice_milestones TO service_role;
CREATE FUNCTION public.fn_ca_promo_notice_is_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='public','pg_temp' AS $$
BEGIN RAISE EXCEPTION 'promo_notice_milestone_is_immutable' USING ERRCODE='55000'; END $$;
CREATE TRIGGER ca_promo_notice_is_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_notice_milestones
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_notice_is_immutable();
REVOKE ALL ON FUNCTION public.fn_ca_promo_notice_is_immutable() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_emit_notice(p_grant uuid,p_milestone text,p_principal numeric,p_progress numeric,p_target numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE g public.ca_promo_play_through_grants%ROWTYPE;n uuid:=gen_random_uuid();title text;body text;
BEGIN
 SELECT * INTO STRICT g FROM public.ca_promo_play_through_grants WHERE id=p_grant;
 -- Orphan grant history is permitted by its original owner. Preserve the
 -- accounting milestone without trying to deliver to a deleted profile.
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=g.user_id) THEN n:=NULL; END IF;
 IF p_milestone='received' THEN
  title:='Promo Chips Received';
  body:=trim(to_char(p_principal,'FM999999999999990.00'))||' Promo Chips Received. Earn '||trim(to_char(p_target,'FM999999999999990.00'))||' In Fees To Unlock The Remaining Promo Principal.';
 ELSIF p_milestone='unlocked' THEN
  IF g.closed_at IS NULL OR g.close_reason<>'met' THEN RAISE EXCEPTION 'promo_unlock_notice_requires_completed_grant'; END IF;
  title:='Promo Play Through Completed';
  body:=trim(to_char(p_principal,'FM999999999999990.00'))||' Remaining Promo Chips Are Now Unlocked.';
 ELSE
  IF p_milestone NOT IN('half','near') OR g.closed_at IS NOT NULL THEN RETURN false; END IF;
  -- Optional progress snapshots never wait across original money owners.
  -- A busy snapshot is observed by a later actual fee, without a repair task.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca-promo-progress-notice:'||p_grant::text,0)) THEN RETURN false; END IF;
  -- A jump to ninety gets one useful push, and a later refund cannot create
  -- an out-of-order fifty-percent message after the near-completion receipt.
  IF p_milestone='half' AND EXISTS(SELECT 1 FROM public.ca_promo_notice_milestones WHERE grant_id=p_grant AND milestone='near') THEN RETURN false; END IF;
  title:=CASE p_milestone WHEN 'near' THEN 'Original Promo Principal Almost Unlocked' ELSE 'Original Promo Principal Halfway' END;
  body:=trim(to_char(LEAST(p_progress,p_target),'FM999999999999990.00'))||' Of '||trim(to_char(p_target,'FM999999999999990.00'))||' In Fees Earned. The Remaining Promo Principal Unlocks When The Full Requirement Is Met.';
 END IF;
 INSERT INTO public.ca_promo_notice_milestones(grant_id,milestone,notification_id,principal_amount,fee_progress,fee_target)
 VALUES(g.id,p_milestone,n,p_principal,p_progress,p_target) ON CONFLICT(grant_id,milestone) DO NOTHING;
 IF NOT FOUND OR n IS NULL THEN RETURN false; END IF;
 INSERT INTO public.notifications(id,user_id,type,title,message,link,action_url,data)
 VALUES(n,g.user_id,'promo_play_through',title,body,'/hub/club-arena/wallet?club='||g.club_id::text,'/hub/club-arena/wallet?club='||g.club_id::text,
  jsonb_build_object('club_id',g.club_id,'grant_id',g.id,'milestone',p_milestone,'principal',p_principal,
   'fee_progress',p_progress,'fee_target',p_target));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_emit_notice(uuid,text,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated,service_role;

-- The later W owner invokes this only on its immutable earned transition.
-- Dynamic reads allow this private callback to install before that owner; no
-- trigger is attached to a future table and no ratio can manufacture a release.
CREATE FUNCTION public.fn_ca_promo_notice_profit_unlocked(p_grant uuid,p_unlocked_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE g public.ca_promo_play_through_grants%ROWTYPE;actual_at timestamptz;
 n uuid:=gen_random_uuid();profit numeric;holder_clubs jsonb;notice_club uuid;target numeric;
BEGIN
 IF p_grant IS NULL OR p_unlocked_at IS NULL OR NOT isfinite(p_unlocked_at) THEN
  RAISE EXCEPTION 'original_profit_earned_transition_required' USING ERRCODE='22023';END IF;
 EXECUTE 'SELECT unlocked_at FROM public.ca_promo_profit_gates WHERE grant_id=$1' INTO actual_at USING p_grant;
 IF actual_at IS DISTINCT FROM p_unlocked_at THEN RAISE EXCEPTION 'original_profit_earned_transition_required' USING ERRCODE='23514';END IF;
 SELECT * INTO STRICT g FROM public.ca_promo_play_through_grants WHERE id=p_grant;
 EXECUTE 'SELECT COALESCE(sum(amount),0),COALESCE(jsonb_agg(DISTINCT club_id),''[]''::jsonb),
 COALESCE(min(club_id::text) FILTER(WHERE kind IN(''player_wallet'',''agent_wallet'')),min(club_id::text))::uuid
 FROM public.ca_promo_profit_custody WHERE grant_id=$1 AND user_id=$2 AND amount>0'
 INTO profit,holder_clubs,notice_club USING p_grant,g.user_id;
 notice_club:=COALESCE(notice_club,g.club_id);target:=g.amount*2;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=g.user_id) THEN n:=NULL;END IF;
 -- This is not released original principal and never enters its digest total.
 INSERT INTO public.ca_promo_notice_milestones(grant_id,milestone,notification_id,principal_amount,fee_progress,fee_target)
 VALUES(g.id,'profit_unlocked',n,0,target,target) ON CONFLICT(grant_id,milestone) DO NOTHING;
 IF NOT FOUND OR n IS NULL THEN RETURN false;END IF;
 INSERT INTO public.notifications(id,user_id,type,title,message,link,action_url,data)
 VALUES(n,g.user_id,'promo_play_through','Promo Profit Fee Requirement Met',
 'Qualifying Fees Equal To Twice The Original Grant Have Been Earned. Separate Source Review Holds Still Apply.',
 '/hub/club-arena/wallet?club='||notice_club::text,'/hub/club-arena/wallet?club='||notice_club::text,
 jsonb_build_object('club_id',notice_club,'source_club_id',g.club_id,'holder_club_ids',holder_clubs,
 'grant_id',g.id,'milestone','profit_unlocked','profit_amount',profit,'fee_target',target,'earned_at',p_unlocked_at));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_notice_profit_unlocked(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

-- A reasoned support decision refreshes the recipient without pretending
-- that either qualifying-fee target was earned or releasing a review hold.
CREATE FUNCTION public.fn_ca_promo_notice_support_override(p_grant uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE g public.ca_promo_play_through_grants%ROWTYPE;verified boolean:=false;
 n uuid:=gen_random_uuid();notice_club uuid;
BEGIN
 SELECT * INTO STRICT g FROM public.ca_promo_play_through_grants WHERE id=p_grant;
 verified:=g.closed_at IS NOT NULL AND g.close_reason='override';
 IF NOT verified AND to_regclass('public.ca_promo_profit_overrides') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides WHERE grant_id=$1)' INTO verified USING p_grant;
 END IF;
 IF NOT COALESCE(verified,false) THEN RAISE EXCEPTION 'original_support_override_required' USING ERRCODE='23514';END IF;
 IF to_regclass('public.ca_promo_profit_custody') IS NOT NULL THEN
  EXECUTE 'SELECT COALESCE(min(club_id::text) FILTER(WHERE kind IN(''player_wallet'',''agent_wallet'')),min(club_id::text))::uuid
   FROM public.ca_promo_profit_custody WHERE grant_id=$1 AND user_id=$2 AND amount>0' INTO notice_club USING p_grant,g.user_id;
 END IF;
 notice_club:=COALESCE(notice_club,g.club_id);
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=g.user_id) THEN n:=NULL;END IF;
 INSERT INTO public.ca_promo_notice_milestones(grant_id,milestone,notification_id,principal_amount,fee_progress,fee_target)
 VALUES(g.id,'support_override',n,0,0,g.fee_target) ON CONFLICT(grant_id,milestone) DO NOTHING;
 IF NOT FOUND OR n IS NULL THEN RETURN false;END IF;
 INSERT INTO public.notifications(id,user_id,type,title,message,link,action_url,data)
 VALUES(n,g.user_id,'promo_play_through','Promo Restrictions Updated By Support',
 'Your Promo Restrictions Were Updated By Support. Separate Source Review Holds Still Apply.',
 '/hub/club-arena/wallet?club='||notice_club::text,'/hub/club-arena/wallet?club='||notice_club::text,
 jsonb_build_object('club_id',notice_club,'source_club_id',g.club_id,'grant_id',g.id,'milestone','support_override'));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_notice_support_override(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_grant_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM public.fn_ca_promo_emit_notice(NEW.id,'received',NEW.amount,0,NEW.fee_target);
 ELSIF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND NEW.close_reason='met' THEN
  PERFORM public.fn_ca_promo_emit_notice(NEW.id,'unlocked',OLD.remaining,NEW.fee_target,NEW.fee_target);
 ELSIF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND NEW.close_reason='override' THEN
  -- Record actual manual release for the digest without inventing earned fees
  -- or sending the earned-completion push.
  INSERT INTO public.ca_promo_notice_milestones(grant_id,milestone,principal_amount,fee_progress,fee_target)
  VALUES(NEW.id,'manual_release',OLD.remaining,0,NEW.fee_target) ON CONFLICT DO NOTHING;
  PERFORM public.fn_ca_promo_notice_support_override(NEW.id);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_grant_notice() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_grant_notice AFTER INSERT OR UPDATE OF closed_at ON public.ca_promo_play_through_grants
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_grant_notice();

CREATE FUNCTION public.fn_ca_promo_fee_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record;progress numeric;milestone text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants g WHERE g.club_id=NEW.club_id AND g.user_id=NEW.player_id AND g.closed_at IS NULL) THEN RETURN NULL; END IF;
 -- Read one authoritative FIFO snapshot, after the entire original financial
 -- transaction. Never call settle here: cash hands already own grant locks,
 -- while the settlement owner may need the member wallet first.
 FOR r IN SELECT s.* FROM public.fn_ca_promo_play_through_state(NEW.club_id,NEW.player_id) s
  WHERE s.state IN('locked','met_pending') AND s.remaining>0 LOOP
  progress:=LEAST(r.fee_target,GREATEST(r.cycle_fees-(r.cum_target-r.fee_target),0));
  milestone:=CASE WHEN progress>=r.fee_target*0.9 THEN 'near' WHEN progress>=r.fee_target*0.5 THEN 'half' END;
  IF milestone IS NOT NULL THEN
   PERFORM public.fn_ca_promo_emit_notice(r.grant_id,milestone,r.remaining,progress,r.fee_target);
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_fee_notice() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER ca_promo_fee_notice AFTER INSERT ON public.rake_attributions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.rake_amount>0)
 EXECUTE FUNCTION public.fn_ca_promo_fee_notice();
CREATE CONSTRAINT TRIGGER ca_promo_entry_notice AFTER INSERT ON public.accounting_tournament_fee_sources
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.rake_credit>0)
 EXECUTE FUNCTION public.fn_ca_promo_fee_notice();

-- The immutable original paid fee is available even without an earning
-- agreement. Observe only after both charge and entitlement are complete.
CREATE CONSTRAINT TRIGGER ca_promo_paid_entry_notice AFTER INSERT ON public.ca_promo_event_fee_consumption_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.gross_fee>0)
 EXECUTE FUNCTION public.fn_ca_promo_fee_notice();

-- This existing closed observer table has a validated type whitelist.
-- Preserve every existing category and validate the one new category in the
-- same maintenance transaction (live source measured 18 MB / ~54k rows).
DO $type$ DECLARE def text; BEGIN
 SELECT pg_get_constraintdef(oid) INTO STRICT def FROM pg_constraint
  WHERE conrelid='public.ledger_reconcile_log'::regclass AND conname='ledger_reconcile_log_entity_type_check' AND convalidated;
 IF position('''rake_law''::text' in def)=0 OR position('promo_principal_custody' in def)>0 THEN
  RAISE EXCEPTION 'promo_reconcile_log_type_preimage_changed'; END IF;
 EXECUTE 'ALTER TABLE public.ledger_reconcile_log DROP CONSTRAINT ledger_reconcile_log_entity_type_check, ADD CONSTRAINT ledger_reconcile_log_entity_type_check '
  ||replace(def,'''rake_law''::text','''rake_law''::text,''promo_principal_custody''::text');
END $type$;

-- A review is its own immutable source event, independent of every 4x grant.
-- The original owner locks the case and freezes released_amount before this
-- receipt INSERT. Raw positive lots are retained as historical evidence;
-- active helpers already exclude this just-reviewed case.
CREATE FUNCTION public.fn_ca_promo_integrity_release_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE holder record;observed numeric;
BEGIN
 SELECT COALESCE(sum(c.amount),0) INTO observed FROM public.ca_promo_integrity_custody c
  WHERE c.case_id=NEW.case_id AND c.amount>0;
 IF observed IS DISTINCT FROM NEW.released_amount THEN
  RAISE EXCEPTION 'source_review_notice_original_amount_mismatch' USING ERRCODE='23514'; END IF;
 FOR holder IN SELECT c.user_id,sum(c.amount) amount,jsonb_agg(DISTINCT c.club_id) clubs
  FROM public.ca_promo_integrity_custody c JOIN public.profiles profile ON profile.id=c.user_id
  WHERE c.case_id=NEW.case_id AND c.amount>0
  GROUP BY c.user_id ORDER BY c.user_id LOOP
  INSERT INTO public.notifications(user_id,type,title,message,link,action_url,data)
  VALUES(holder.user_id,'promo_play_through','Source Review Completed',
   'Source Review Completed For '||trim(to_char(holder.amount,'FM999999999999990.00'))||' Chips. Any Separate Promo Play Through Requirement Still Applies.',
   '/hub/club-arena/wallet'||CASE WHEN jsonb_array_length(holder.clubs)=1 THEN '?club='||(holder.clubs->>0) ELSE '' END,
   '/hub/club-arena/wallet'||CASE WHEN jsonb_array_length(holder.clubs)=1 THEN '?club='||(holder.clubs->>0) ELSE '' END,
   jsonb_build_object('event','source_review_released','review_case_id',NEW.case_id,
    'club_id',CASE WHEN jsonb_array_length(holder.clubs)=1 THEN holder.clubs->>0 ELSE NULL END,
    'club_ids',holder.clubs,'released_amount',holder.amount));
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_release_notice() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_integrity_release_notice AFTER INSERT ON public.ca_promo_integrity_releases
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_release_notice();

CREATE FUNCTION public.fn_ca_promo_daily_digest(p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE day date:=COALESCE(p_day,(clock_timestamp() AT TIME ZONE 'America/Chicago')::date-1);lo timestamptz;hi timestamptz;rows jsonb;clubs jsonb;
BEGIN
 IF day>=(clock_timestamp() AT TIME ZONE 'America/Chicago')::date OR day<(clock_timestamp() AT TIME ZONE 'America/Chicago')::date-366 THEN RAISE EXCEPTION 'promo_digest_requires_closed_day_within_year'; END IF;
 lo:=day::timestamp AT TIME ZONE 'America/Chicago';hi:=(day+1)::timestamp AT TIME ZONE 'America/Chicago';
 WITH stats AS (
  SELECT g.club_id,g.funded_from_type,g.funded_from_id,min(l.from_label) funding_label,
   sum(CASE WHEN g.granted_at>=lo AND g.granted_at<hi THEN g.amount ELSE 0 END) given,
   sum(CASE WHEN g.closed_at IS NULL THEN g.remaining ELSE 0 END) locked_now,
   sum(COALESCE(n.principal_amount,0)) unlocked,
   sum(COALESCE(e.amount,0)) expired
  FROM public.ca_promo_play_through_grants g
  LEFT JOIN public.chip_ledger l ON l.id=g.source_ledger_id
  LEFT JOIN public.ca_promo_notice_milestones n ON n.grant_id=g.id AND n.milestone IN('unlocked','manual_release') AND n.created_at>=lo AND n.created_at<hi
  LEFT JOIN LATERAL(SELECT sum(r.amount) amount FROM public.ca_promo_principal_return_receipts r
   WHERE r.grant_id=g.id AND r.reason='expired' AND r.created_at>=lo AND r.created_at<hi)e ON true
  GROUP BY g.club_id,g.funded_from_type,g.funded_from_id
 ), flags AS (
  SELECT x.club_id,x.funded_from_type,x.funded_from_id,count(DISTINCT c.id) flagged
  FROM public.ca_promo_integrity_cases c JOIN public.ca_promo_integrity_source_grants x
   ON x.hand_id=c.hand_id AND x.club_id=c.source_club_id AND x.user_id=c.source_user_id
  WHERE c.created_at>=lo AND c.created_at<hi AND x.amount>0
  GROUP BY x.club_id,x.funded_from_type,x.funded_from_id
 ), combined AS (
  SELECT COALESCE(s.club_id,f.club_id) club_id,COALESCE(s.funded_from_type,f.funded_from_type) funded_from_type,
   COALESCE(s.funded_from_id,f.funded_from_id) funded_from_id,s.funding_label,
   COALESCE(s.given,0) given,COALESCE(s.locked_now,0) locked_now,
   COALESCE(s.unlocked,0) unlocked,COALESCE(s.expired,0) expired,COALESCE(f.flagged,0) flagged
  FROM stats s FULL JOIN flags f ON f.club_id=s.club_id
   AND f.funded_from_type IS NOT DISTINCT FROM s.funded_from_type
   AND f.funded_from_id IS NOT DISTINCT FROM s.funded_from_id
 ) SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.club_id,s.funded_from_type,s.funded_from_id),'[]') INTO rows FROM combined s;
 WITH totals AS (
  SELECT club_id,sum(given) given,sum(locked_now) locked_now,sum(unlocked) unlocked,sum(expired) expired
  FROM jsonb_to_recordset(rows) AS x(club_id uuid,given numeric,locked_now numeric,unlocked numeric,expired numeric)
  GROUP BY club_id
 ), keys AS (
  SELECT club_id FROM totals UNION SELECT source_club_id FROM public.ca_promo_integrity_cases WHERE created_at>=lo AND created_at<hi
 ) SELECT COALESCE(jsonb_agg(to_jsonb(c)),'[]') INTO clubs FROM(
  SELECT k.club_id,COALESCE(t.given,0) given,COALESCE(t.locked_now,0) locked_now,
   COALESCE(t.unlocked,0) unlocked,COALESCE(t.expired,0) expired,
   (SELECT count(*) FROM public.ca_promo_integrity_cases f WHERE f.source_club_id=k.club_id AND f.created_at>=lo AND f.created_at<hi) flagged
  FROM keys k LEFT JOIN totals t USING(club_id) ORDER BY k.club_id)c;
 RETURN jsonb_build_object('day',day,'time_zone','America/Chicago','funding_owners',rows,'clubs',clubs,
  'club_flags',(SELECT COALESCE(jsonb_agg(to_jsonb(f)),'[]') FROM
   (SELECT source_club_id club_id,count(*) flagged FROM public.ca_promo_integrity_cases
    WHERE created_at>=lo AND created_at<hi GROUP BY source_club_id)f),
  'basis','Original Grant Funding Owner; Locked Is Current Outstanding Principal; Agent Flags Use Exact Source Grant Losses');
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_daily_digest(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_daily_digest(date) TO service_role;

DO $patch$
DECLARE def text;needle text:=$needle$  SELECT
    COUNT(*)::INT$needle$;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.reconcile_ledger_nightly()'::regprocedure) IS DISTINCT FROM '4c0a36177722538d015384594708a854' THEN RAISE EXCEPTION 'promo_notice_owner_preimage_changed: reconcile_ledger_nightly'; END IF;
 SELECT pg_get_functiondef('public.reconcile_ledger_nightly()'::regprocedure) INTO def;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_notice_owner_anchor_changed'; END IF;
 EXECUTE replace(def,needle,$addition$  -- Observe principal conservation only. Never change a wallet or grant.
  INSERT INTO public.ledger_reconcile_log(entity_type,entity_id,ledger_balance,stored_balance,severity,metadata)
  SELECT 'promo_principal_custody',p.grant_id,p.remaining,p.custody,
   CASE WHEN p.remaining=p.custody THEN 'ok' ELSE 'critical' END,
   jsonb_build_object('source','reconcile_ledger_nightly','club_id',p.club_id,'user_id',p.user_id)
  FROM (
   SELECT g.id AS grant_id,g.club_id,g.user_id,g.remaining,COALESCE(sum(c.amount),0) AS custody
   FROM public.ca_promo_play_through_grants g LEFT JOIN public.ca_promo_principal_custody c ON c.grant_id=g.id
   GROUP BY g.id HAVING g.closed_at IS NULL OR COALESCE(sum(c.amount),0)<>0
  ) p;

$addition$||needle);
END $patch$;

DO $patch$
DECLARE def text;needle text:=$needle$    'generated_at', clock_timestamp());$needle$;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_sp_daily_digest(date,boolean)'::regprocedure) IS DISTINCT FROM 'b904cc46a95e168be729c07de6fe055b' THEN RAISE EXCEPTION 'promo_notice_owner_preimage_changed: fn_sp_daily_digest'; END IF;
 SELECT pg_get_functiondef('public.fn_sp_daily_digest(date,boolean)'::regprocedure) INTO def;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_notice_owner_anchor_changed'; END IF;
 EXECUTE replace(def,needle,$addition$    'promo_play_through', public.fn_ca_promo_daily_digest(v_day),
$addition$||needle);
END $patch$;

DO $patch$
DECLARE def text;
BEGIN
 SELECT pg_get_functiondef('public.fn_ca_reconcile_owned_entity_types()'::regprocedure) INTO def;
 IF position('''negative_balance''' in def)=0 OR position('promo_principal_custody' in def)>0 THEN RAISE EXCEPTION 'promo_reconcile_types_preimage_changed'; END IF;
 EXECUTE replace(def,'''negative_balance''','''negative_balance'',''promo_principal_custody''');
END $patch$;

DO $incident$ DECLARE def text;needle text:=$needle$      WHEN 'negative_balance' THEN 'ledger_imbalance'$needle$; BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_ca_reconcile_log_to_incident()'::regprocedure) IS DISTINCT FROM '1970c2ea9bff1f8d8c970d13c3ec0f49' THEN RAISE EXCEPTION 'promo_reconcile_incident_preimage_changed'; END IF;
 SELECT pg_get_functiondef('public.fn_ca_reconcile_log_to_incident()'::regprocedure) INTO def;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_reconcile_incident_anchor_changed'; END IF;
 EXECUTE replace(def,needle,needle||E'\n      WHEN ''promo_principal_custody'' THEN ''ledger_imbalance''');
END $incident$;
COMMIT;
