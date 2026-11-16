-- @install-window: daily-maintenance
-- @locks: public.ca_promo_play_through_grants, public.ca_promo_cash_hand_clocks, public.rake_attributions, public.club_members, public.tournament_obligations
-- @live-proof: EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.ca_promo_play_through_grants'::regclass AND tgname='ca_promo_profit_seed' AND tgenabled='O') AND position('fn_ca_promo_profit_capture_cash' in pg_get_functiondef('public.fn_ca_promo_accept_cash_hand(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure))>0 AND to_regprocedure('public.fn_ca_promo_notice_profit_unlocked(uuid,timestamptz)') IS NOT NULL AND to_regprocedure('public.fn_ca_promo_notice_support_override(uuid)') IS NOT NULL
-- W winnings belong to the player. They have no expiry or original-fund return.
-- The original gift shares one FIFO fee block: 2x unlocks W, 4x unlocks P.
-- P funding/commission helpers retain P-only semantics.
BEGIN;
SET LOCAL lock_timeout='1s';
DO $before_first_gift$ BEGIN IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants) THEN RAISE EXCEPTION 'winnings_source_contract_must_install_before_first_promo_gift';END IF;END $before_first_gift$;
CREATE TABLE public.ca_promo_profit_gates (
 grant_id uuid PRIMARY KEY REFERENCES public.ca_promo_play_through_grants(id),
 unlocked_at timestamptz
);
CREATE TABLE public.ca_promo_profit_overrides (
 grant_id uuid PRIMARY KEY REFERENCES public.ca_promo_profit_gates(grant_id),reviewed_by uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),overridden_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.ca_promo_profit_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_profit_overrides FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_profit_overrides TO service_role;
CREATE TABLE public.ca_promo_profit_fee_phases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),grant_id uuid NOT NULL REFERENCES public.ca_promo_profit_gates(grant_id),
 source_kind text NOT NULL CHECK(source_kind IN('gift','cash_win','tournament_win','bbj','stake_refund')),
 source_id uuid NOT NULL,activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 closed_at timestamptz,CHECK(closed_at IS NULL OR closed_at>=activated_at),
 UNIQUE(grant_id,source_kind,source_id)
);
CREATE FUNCTION public.fn_ca_promo_profit_phase_is_final() RETURNS trigger
LANGUAGE plpgsql SET search_path='public','pg_temp' AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.grant_id,NEW.source_kind,NEW.source_id,NEW.activated_at) IS NOT DISTINCT FROM ROW(OLD.id,OLD.grant_id,OLD.source_kind,OLD.source_id,OLD.activated_at)
 AND OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND isfinite(NEW.closed_at) AND NEW.closed_at>=OLD.activated_at THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'original_winnings_fee_phase_is_final' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_phase_is_final() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_profit_phase_final BEFORE UPDATE OR DELETE ON public.ca_promo_profit_fee_phases FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_phase_is_final();
CREATE TRIGGER ca_promo_profit_phase_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_fee_phases FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE INDEX ca_promo_profit_phases_order ON public.ca_promo_profit_fee_phases(activated_at,id);
ALTER TABLE public.ca_promo_profit_fee_phases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_profit_fee_phases FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_profit_fee_phases TO service_role;
CREATE TABLE public.ca_promo_profit_custody (
 grant_id uuid NOT NULL REFERENCES public.ca_promo_profit_gates(grant_id),club_id uuid NOT NULL,user_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('player_wallet','agent_wallet','table_stack','pending_addon','event','ticket')),
 entity_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>=0 AND amount=round(amount,2) AND amount::text NOT IN('NaN','Infinity','-Infinity')),
 PRIMARY KEY(grant_id,club_id,user_id,kind,entity_id)
);
CREATE INDEX ca_promo_profit_position ON public.ca_promo_profit_custody(club_id,user_id,kind,entity_id) WHERE amount>0;
CREATE TABLE public.ca_promo_profit_integrity_overlap (
 grant_id uuid NOT NULL REFERENCES public.ca_promo_profit_gates(grant_id),case_id uuid NOT NULL REFERENCES public.ca_promo_integrity_cases(id),
 club_id uuid NOT NULL,user_id uuid NOT NULL,kind text NOT NULL,entity_id uuid NOT NULL,
 amount numeric NOT NULL CHECK(amount>=0 AND amount=round(amount,2) AND amount::text NOT IN('NaN','Infinity','-Infinity')),
 PRIMARY KEY(grant_id,case_id,club_id,user_id,kind,entity_id)
);
ALTER TABLE public.ca_promo_profit_gates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_profit_gates FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_profit_gates TO service_role;
ALTER TABLE public.ca_promo_profit_custody ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_profit_custody FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_profit_custody TO service_role;
ALTER TABLE public.ca_promo_profit_integrity_overlap ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_profit_integrity_overlap FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_profit_integrity_overlap TO service_role;
CREATE FUNCTION public.fn_ca_promo_profit_seed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 INSERT INTO public.ca_promo_profit_gates(grant_id) VALUES(NEW.id);
 INSERT INTO public.ca_promo_profit_fee_phases(grant_id,source_kind,source_id,activated_at) VALUES(NEW.id,'gift',NEW.id,NEW.granted_at);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_seed() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_profit_seed AFTER INSERT ON public.ca_promo_play_through_grants
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_seed();

-- Read current exact original net sources once per member, including cash's
-- accepted-hand clock and the original paid-entry expense clock. Closed block
-- observations remain source-refund sensitive; an earned W release never reopens.
CREATE FUNCTION public.fn_ca_promo_shared_fee_state(p_club uuid,p_user uuid)
RETURNS TABLE(grant_id uuid,fee_start numeric,fees numeric,principal_target numeric,profit_target numeric,
 principal_state text,profit_state text,consumed_prefix numeric,phase_id uuid,phase_kind text,profit_earned numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record;observed jsonb;credited jsonb:='{}';prefix numeric:=0;start_at numeric;at_start numeric;
 p_end timestamptz;w_end timestamptz;p_cap numeric;w_cap numeric;at_end numeric;prior_profit numeric;
 block_earned numeric;profit_earned numeric;total numeric:=0;now_at timestamptz:=clock_timestamp();from_at timestamptz;
 rows jsonb:='[]';
BEGIN
 SELECT min(p.activated_at) INTO from_at FROM public.ca_promo_profit_fee_phases p
 JOIN public.ca_promo_play_through_grants g ON g.id=p.grant_id WHERE g.club_id=p_club AND g.user_id=p_user;
 IF from_at IS NULL THEN RETURN;END IF;
 WITH events AS MATERIALIZED(
  SELECT e.earned_at at,e.fee_credit credit FROM public.fn_ca_promo_fee_events(p_club,p_user,from_at,now_at)e
 ), phases AS MATERIALIZED(
  SELECT p.*,g.closed_at principal_closed_at,g.expires_at,w.unlocked_at,o.overridden_at,
   EXISTS(SELECT 1 FROM public.ca_promo_profit_custody c WHERE c.grant_id=g.id AND c.amount>0) has_profit
  FROM public.ca_promo_profit_fee_phases p JOIN public.ca_promo_play_through_grants g ON g.id=p.grant_id
  JOIN public.ca_promo_profit_gates w ON w.grant_id=g.id
  LEFT JOIN public.ca_promo_profit_overrides o ON o.grant_id=g.id WHERE g.club_id=p_club AND g.user_id=p_user
 ), boundaries AS(
  SELECT now_at at,'now'::text key
  UNION ALL SELECT p.activated_at,'a:'||p.id FROM phases p
  UNION ALL SELECT COALESCE(LEAST(p.principal_closed_at,p.expires_at),now_at),'p:'||p.id FROM phases p
  UNION ALL SELECT COALESCE(p.closed_at,p.unlocked_at,p.overridden_at,CASE WHEN p.source_kind='gift' AND NOT p.has_profit AND p.expires_at<=now_at THEN p.expires_at END,now_at),'w:'||p.id FROM phases p
 ), observations AS(
  SELECT x.key,sum(x.credit) OVER(ORDER BY x.at,x.ordinal ROWS UNBOUNDED PRECEDING) value
  FROM(SELECT e.at,1 ordinal,e.credit,NULL::text key FROM events e
   UNION ALL SELECT b.at,0,0::numeric,b.key FROM boundaries b)x
 ) SELECT jsonb_object_agg(x.key,COALESCE(x.value,0)) INTO observed FROM observations x WHERE x.key IS NOT NULL;
 total:=COALESCE((observed->>'now')::numeric,0);
 FOR r IN SELECT g.*,w.unlocked_at,o.overridden_at,p.id phase_id,p.source_kind phase_kind,p.activated_at,p.closed_at phase_closed_at,
 EXISTS(SELECT 1 FROM public.ca_promo_profit_custody c WHERE c.grant_id=g.id AND c.amount>0) has_profit
 FROM public.ca_promo_profit_fee_phases p JOIN public.ca_promo_play_through_grants g ON g.id=p.grant_id
 JOIN public.ca_promo_profit_gates w ON w.grant_id=g.id
 LEFT JOIN public.ca_promo_profit_overrides o ON o.grant_id=g.id
 WHERE g.club_id=p_club AND g.user_id=p_user ORDER BY p.activated_at,p.id LOOP
  -- Idle fees before the authoritative source activates cannot pay a later
  -- block. A late original earning receives no retroactive FIFO priority.
  at_start:=COALESCE((observed->>('a:'||r.phase_id))::numeric,0);
  start_at:=GREATEST(prefix,at_start);
  prior_profit:=COALESCE((credited->>r.id::text)::numeric,0);
  p_cap:=0;principal_state:='closed';p_end:=LEAST(r.closed_at,r.expires_at);
  IF r.phase_kind='gift' THEN
   p_cap:=r.fee_target;principal_state:='locked';
   IF r.closed_at IS NOT NULL OR r.expires_at<=now_at THEN
    at_end:=COALESCE((observed->>('p:'||r.phase_id))::numeric,0);
    p_cap:=LEAST(r.fee_target,GREATEST(at_end-start_at,0));
    principal_state:=CASE WHEN r.close_reason='met' THEN 'met'
     WHEN r.closed_at IS NOT NULL THEN 'closed'
     WHEN p_cap>=r.fee_target THEN 'met_pending' ELSE 'expired_pending' END;
   ELSIF total-start_at>=r.fee_target THEN principal_state:='met_pending';END IF;
  END IF;
  -- All realization phases share the same original two-times threshold.
  -- Refunds before completion reduce the valid credit of their exact phase;
  -- the immutable completed release remains final after later refunds.
  w_cap:=GREATEST(r.amount*2-prior_profit,0);w_end:=COALESCE(r.phase_closed_at,r.unlocked_at,r.overridden_at,CASE WHEN r.phase_kind='gift' AND NOT r.has_profit AND r.expires_at<=now_at THEN r.expires_at END);
  profit_state:='locked';
  IF w_end IS NOT NULL THEN
   at_end:=COALESCE((observed->>('w:'||r.phase_id))::numeric,0);
   w_cap:=LEAST(w_cap,GREATEST(at_end-start_at,0));
   profit_state:=CASE WHEN r.unlocked_at IS NOT NULL THEN 'met' WHEN r.overridden_at IS NOT NULL THEN 'override' ELSE 'lost' END;
  ELSIF total-start_at+prior_profit>=r.amount*2 THEN profit_state:='met_pending';END IF;
  block_earned:=LEAST(GREATEST(p_cap,w_cap),GREATEST(total-start_at,0));
  profit_earned:=LEAST(GREATEST(r.amount*2-prior_profit,0),block_earned);
  credited:=jsonb_set(credited,ARRAY[r.id::text],to_jsonb(prior_profit+profit_earned));
  prefix:=start_at+GREATEST(p_cap,w_cap);
  rows:=rows||jsonb_build_array(jsonb_build_object('grant_id',r.id,'fee_start',start_at,
   'fees',GREATEST(total-start_at,0),'principal_target',r.fee_target,'profit_target',r.amount*2,
   'principal_state',principal_state,'profit_state',profit_state,'consumed_prefix',prefix,
   'phase_id',r.phase_id,'phase_kind',r.phase_kind,'profit_earned',prior_profit+profit_earned,'phase_closed_at',r.phase_closed_at));
 END LOOP;
 RETURN QUERY SELECT x.grant_id,x.fee_start,x.fees,x.principal_target,x.profit_target,x.principal_state,x.profit_state,x.consumed_prefix,x.phase_id,x.phase_kind,x.profit_earned
 FROM jsonb_to_recordset(rows)x(grant_id uuid,fee_start numeric,fees numeric,principal_target numeric,profit_target numeric,
 principal_state text,profit_state text,consumed_prefix numeric,phase_id uuid,phase_kind text,profit_earned numeric,phase_closed_at timestamptz);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_shared_fee_state(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_locked_at(p_club uuid,p_user uuid,p_kind text,p_entity uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
 SELECT COALESCE(sum(c.amount),0) FROM public.ca_promo_profit_custody c
 JOIN public.ca_promo_profit_gates g ON g.grant_id=c.grant_id AND g.unlocked_at IS NULL
 WHERE c.club_id=p_club AND c.user_id=p_user AND c.kind=p_kind AND c.entity_id=p_entity
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=c.grant_id);
$$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_locked_at(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $original_state$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_ca_promo_play_through_state(uuid,uuid)'::regprocedure)<>'504d77f786dc6a2b0cc6b6f89937fa61' THEN
  RAISE EXCEPTION 'original_promo_fifo_reader_changed';
 END IF;
END $original_state$;
CREATE OR REPLACE FUNCTION public.fn_ca_promo_play_through_state(p_club_id uuid,p_user_id uuid)
RETURNS TABLE(grant_id uuid,amount numeric,remaining numeric,fee_target numeric,cum_target numeric,
 cycle_started_at timestamptz,cycle_fees numeric,granted_at timestamptz,expires_at timestamptz,state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
 WITH shared AS MATERIALIZED(SELECT * FROM public.fn_ca_promo_shared_fee_state(p_club_id,p_user_id)),
 current_principal AS MATERIALIZED(
 SELECT g.*,s.fee_start,s.fees,s.principal_state FROM public.ca_promo_play_through_grants g JOIN shared s ON s.grant_id=g.id
 WHERE s.phase_kind='gift' AND g.club_id=p_club_id AND g.user_id=p_user_id AND g.closed_at IS NULL),
 baseline AS(SELECT min(c.fee_start) FILTER(WHERE c.principal_state IN('locked','met_pending')) value, max(c.fees+c.fee_start) total FROM current_principal c)
 SELECT c.id,c.amount,c.remaining,c.fee_target,CASE WHEN c.principal_state IN('locked','met_pending') THEN c.fee_start+c.fee_target-b.value ELSE 0 END,c.cycle_started_at,
 GREATEST(COALESCE(b.total-b.value,0),0),c.granted_at,c.expires_at,c.principal_state
 FROM current_principal c CROSS JOIN baseline b ORDER BY c.granted_at,c.id;
$$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_play_through_state(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_play_through_state(uuid,uuid) TO service_role;

CREATE FUNCTION public.fn_ca_promo_profit_settle(p_club uuid,p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record;
BEGIN
 PERFORM 1 FROM public.ca_promo_play_through_grants g WHERE g.club_id=p_club AND g.user_id=p_user ORDER BY g.granted_at,g.id FOR UPDATE;
 FOR r IN SELECT DISTINCT s.grant_id FROM public.fn_ca_promo_shared_fee_state(p_club,p_user)s WHERE s.profit_earned>=s.profit_target AND s.profit_target>0 LOOP
  UPDATE public.ca_promo_profit_gates SET unlocked_at=clock_timestamp() WHERE grant_id=r.grant_id AND unlocked_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=r.grant_id);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_settle(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_profit_after_original_fee() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 PERFORM public.fn_ca_promo_profit_settle(NEW.club_id,NEW.player_id);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_after_original_fee() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER ca_promo_profit_original_cash_fee AFTER INSERT ON public.rake_attributions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_after_original_fee();
-- Paid-entry finalization runs only after the original P/H/W expense rendezvous.
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note) VALUES
 ('rake_attributions','ca_promo_profit_original_cash_fee','Only the actual original gross fee can finalize the original gift two-times winnings milestone.');
CREATE FUNCTION public.fn_ca_promo_profit_close_empty_phase(p_grant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants g WHERE g.id=p_grant AND g.remaining>0 AND g.closed_at IS NULL)
  OR EXISTS(SELECT 1 FROM public.ca_promo_profit_custody c WHERE c.grant_id=p_grant AND c.amount>0) THEN RETURN;END IF;
 UPDATE public.ca_promo_profit_fee_phases SET closed_at=clock_timestamp() WHERE grant_id=p_grant AND closed_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_close_empty_phase(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_profit_after_principal_close() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN PERFORM public.fn_ca_promo_profit_close_empty_phase(NEW.id);RETURN NULL;END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_after_principal_close() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_profit_principal_close AFTER UPDATE OF closed_at ON public.ca_promo_play_through_grants
 FOR EACH ROW WHEN(OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL)
 EXECUTE FUNCTION public.fn_ca_promo_profit_after_principal_close();

CREATE FUNCTION public.fn_ca_promo_profit_overlap_at(p_club uuid,p_user uuid,p_kind text,p_entity uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
 SELECT COALESCE(sum(o.amount),0) FROM public.ca_promo_profit_integrity_overlap o
 JOIN public.ca_promo_profit_gates g ON g.grant_id=o.grant_id AND g.unlocked_at IS NULL
 WHERE o.club_id=p_club AND o.user_id=p_user AND o.kind=p_kind AND o.entity_id=p_entity
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases r WHERE r.case_id=o.case_id)
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides z WHERE z.grant_id=o.grant_id);
$$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_overlap_at(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_profit_move_grant(p_grant uuid,p_club uuid,p_user uuid,p_from text,p_from_id uuid,p_to text,p_to_id uuid,p_amount numeric,p_to_club uuid DEFAULT NULL,p_to_user uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF p_amount IS NULL OR p_amount<0 OR p_amount<>round(p_amount,2) OR p_amount::text IN('NaN','Infinity','-Infinity')
 OR (p_to IS NULL) IS DISTINCT FROM (p_to_id IS NULL) THEN RAISE EXCEPTION 'invalid_original_winnings_movement';END IF;
 IF COALESCE(p_to_user,p_user)<>p_user THEN RAISE EXCEPTION 'winnings_cannot_transfer_to_another_player';END IF;
 IF p_amount=0 OR (p_from=p_to AND p_from_id=p_to_id AND COALESCE(p_to_club,p_club)=p_club) THEN RETURN;END IF;
 PERFORM 1 FROM public.ca_promo_play_through_grants WHERE id=p_grant FOR UPDATE;
 UPDATE public.ca_promo_profit_custody SET amount=amount-p_amount WHERE grant_id=p_grant AND club_id=p_club AND user_id=p_user
 AND kind=p_from AND entity_id=p_from_id AND amount>=p_amount;
 IF NOT FOUND THEN RAISE EXCEPTION 'original_winnings_position_missing';END IF;
 IF p_to IS NOT NULL THEN
 INSERT INTO public.ca_promo_profit_custody VALUES(p_grant,COALESCE(p_to_club,p_club),p_user,p_to,p_to_id,p_amount)
 ON CONFLICT(grant_id,club_id,user_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_profit_custody.amount+EXCLUDED.amount;
 ELSE PERFORM public.fn_ca_promo_profit_close_empty_phase(p_grant);END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_move_grant(uuid,uuid,uuid,text,uuid,text,uuid,numeric,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- H already owns the exact per-case FIFO movement. Observe that original
-- movement before its update; H-only chips precede this case's W intersection.
CREATE FUNCTION public.fn_ca_promo_profit_follow_integrity(p_case uuid,p_club uuid,p_user uuid,p_from text,p_from_id uuid,
 p_to text,p_to_id uuid,p_to_club uuid,p_to_user uuid,p_case_before numeric,p_amount numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record;overlap numeric;leftover numeric;n numeric;destination text;destination_id uuid;
BEGIN
 IF p_from=p_to AND p_from_id=p_to_id AND p_club=p_to_club AND p_user=p_to_user THEN RETURN;END IF;
 SELECT COALESCE(sum(o.amount),0) INTO overlap FROM public.ca_promo_profit_integrity_overlap o
 JOIN public.ca_promo_profit_gates g ON g.grant_id=o.grant_id AND g.unlocked_at IS NULL
 WHERE o.case_id=p_case AND o.club_id=p_club AND o.user_id=p_user AND o.kind=p_from AND o.entity_id=p_from_id AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides z WHERE z.grant_id=o.grant_id);
 IF overlap>p_case_before THEN RAISE EXCEPTION 'original_winnings_integrity_overlap_exceeds_case';END IF;
 leftover:=LEAST(overlap,GREATEST(p_amount-(p_case_before-overlap),0));
 -- A gambling recipient can inherit the original review case, but does not
 -- inherit the losing player's own two-times winnings gate.
 IF p_to IS NOT NULL AND p_to_user=p_user THEN destination:=p_to;destination_id:=p_to_id;END IF;
 FOR r IN SELECT o.* FROM public.ca_promo_profit_integrity_overlap o
 JOIN public.ca_promo_profit_gates g ON g.grant_id=o.grant_id AND g.unlocked_at IS NULL
 JOIN public.ca_promo_play_through_grants original ON original.id=o.grant_id
 WHERE o.case_id=p_case AND o.club_id=p_club AND o.user_id=p_user AND o.kind=p_from AND o.entity_id=p_from_id AND o.amount>0 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides z WHERE z.grant_id=o.grant_id)
 ORDER BY original.granted_at,original.id FOR UPDATE OF o LOOP
  EXIT WHEN leftover<=0;n:=LEAST(r.amount,leftover);
  UPDATE public.ca_promo_profit_integrity_overlap SET amount=amount-n WHERE grant_id=r.grant_id AND case_id=p_case
  AND club_id=p_club AND user_id=p_user AND kind=p_from AND entity_id=p_from_id;
  IF destination IS NOT NULL THEN
   INSERT INTO public.ca_promo_profit_integrity_overlap VALUES(r.grant_id,p_case,p_to_club,p_user,destination,destination_id,n)
   ON CONFLICT(grant_id,case_id,club_id,user_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_profit_integrity_overlap.amount+EXCLUDED.amount;
  END IF;
  PERFORM public.fn_ca_promo_profit_move_grant(r.grant_id,p_club,p_user,p_from,p_from_id,destination,destination_id,n,p_to_club,CASE WHEN destination IS NULL THEN p_user ELSE p_to_user END);
  leftover:=leftover-n;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_follow_integrity(uuid,uuid,uuid,text,uuid,text,uuid,uuid,uuid,numeric,numeric) FROM PUBLIC,anon,authenticated,service_role;
DO $original_integrity_move$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_integrity_move(uuid,uuid,text,uuid,text,uuid,numeric,uuid,uuid)'::regprocedure) INTO def;
 needle:=E'UPDATE public.ca_promo_integrity_custody SET amount=amount-n\n   WHERE case_id=r.case_id';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_integrity_case_move_changed';END IF;
 EXECUTE replace(def,needle,E'PERFORM public.fn_ca_promo_profit_follow_integrity(r.case_id,p_club,p_user,p_from,p_from_id,p_to,p_to_id,COALESCE(p_to_club,p_club),COALESCE(p_to_user,p_user),r.amount,n);\n  '||needle);
END $original_integrity_move$;

CREATE TRIGGER ca_promo_profit_override_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_profit_overrides
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER ca_promo_profit_override_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_overrides
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE FUNCTION public.fn_ca_promo_profit_override_member(p_club uuid,p_user uuid,p_actor uuid,p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE n integer;
BEGIN
 IF p_actor IS NULL OR p_actor IS DISTINCT FROM auth.uid() OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500
 OR NOT EXISTS(SELECT 1 FROM public.club_members m WHERE m.club_id=p_club AND m.user_id=p_actor AND m.role IN('owner','co_owner','admin')) THEN
 RAISE EXCEPTION 'original_support_authorization_required';END IF;
 INSERT INTO public.ca_promo_profit_overrides(grant_id,reviewed_by,reason)
 SELECT g.id,p_actor,p_reason FROM public.ca_promo_play_through_grants g JOIN public.ca_promo_profit_gates w ON w.grant_id=g.id
 WHERE g.club_id=p_club AND g.user_id=p_user AND w.unlocked_at IS NULL
 AND (g.close_reason='override' OR EXISTS(SELECT 1 FROM public.ca_promo_profit_custody c WHERE c.grant_id=g.id AND c.amount>0)) ON CONFLICT(grant_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_override_member(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
DO $original_support$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_play_through_override(uuid,uuid,text)'::regprocedure) INTO def;
 needle:='RETURN jsonb_build_object(''success'', true, ''unlocked_grants'', v_closed);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_support_override_owner_changed';END IF;
 EXECUTE replace(def,needle,'RETURN jsonb_build_object(''success'',true,''unlocked_grants'',v_closed,''unlocked_profit_grants'',public.fn_ca_promo_profit_override_member(p_club_id,p_user_id,v_me,left(btrim(p_note),500)));');
END $original_support$;

CREATE FUNCTION public.fn_ca_promo_restricted_at(p_club uuid,p_user uuid,p_kind text,p_entity uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE principal numeric;profit numeric;review numeric;overlap numeric;
BEGIN
 principal:=public.fn_ca_promo_locked_at(p_club,p_user,p_kind,p_entity);
 profit:=public.fn_ca_promo_profit_locked_at(p_club,p_user,p_kind,p_entity);
 review:=public.fn_ca_promo_integrity_locked_at(p_club,p_user,p_kind,p_entity);
 overlap:=public.fn_ca_promo_profit_overlap_at(p_club,p_user,p_kind,p_entity);
 IF overlap<0 OR overlap>LEAST(profit,review) THEN RAISE EXCEPTION 'winnings_review_intersection_not_conserved';END IF;
 RETURN principal+profit+review-overlap;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_restricted_at(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_profit_summary(p_club uuid,p_user uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE target numeric:=0;progress numeric:=0;held numeric:=0;agent_balance numeric:=0;wallet_held numeric;agent_held numeric;override_available boolean:=false;
BEGIN
 WITH held_grants AS MATERIALIZED(
  SELECT DISTINCT c.grant_id FROM public.ca_promo_profit_custody c JOIN public.ca_promo_profit_gates w ON w.grant_id=c.grant_id
  WHERE c.club_id=p_club AND c.user_id=p_user AND c.amount>0 AND w.unlocked_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=c.grant_id)
 ), origins AS MATERIALIZED(
  SELECT DISTINCT g.club_id,g.user_id FROM public.ca_promo_play_through_grants g JOIN held_grants h ON h.grant_id=g.id
  UNION SELECT p_club,p_user
 ), shared AS MATERIALIZED(
  SELECT s.* FROM origins o CROSS JOIN LATERAL public.fn_ca_promo_shared_fee_state(o.club_id,o.user_id)s
 ), per_grant AS(
  SELECT s.grant_id,max(s.profit_target) target,max(s.profit_earned) progress FROM shared s JOIN held_grants h ON h.grant_id=s.grant_id GROUP BY s.grant_id
 ) SELECT COALESCE(sum(g.target),0),COALESCE(sum(LEAST(g.progress,g.target)),0),
 (EXISTS(SELECT 1 FROM shared st JOIN public.ca_promo_play_through_grants original ON original.id=st.grant_id
  WHERE original.club_id=p_club AND original.user_id=p_user AND original.closed_at IS NULL AND original.remaining>0
  AND st.phase_kind='gift' AND st.principal_state IN('locked','expired_pending'))
 OR EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants original JOIN public.ca_promo_profit_gates w ON w.grant_id=original.id
  WHERE original.club_id=p_club AND original.user_id=p_user AND w.unlocked_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=original.id)
  AND EXISTS(SELECT 1 FROM public.ca_promo_profit_custody c WHERE c.grant_id=original.id AND c.amount>0)))
 INTO target,progress,override_available FROM per_grant g;
 SELECT COALESCE(sum(c.amount),0) INTO held FROM public.ca_promo_profit_custody c JOIN public.ca_promo_profit_gates w ON w.grant_id=c.grant_id
 WHERE c.club_id=p_club AND c.user_id=p_user AND w.unlocked_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=c.grant_id);
 SELECT COALESCE(a.agent_wallet_balance,0) INTO agent_balance FROM public.agents a WHERE a.club_id=p_club AND a.user_id=p_user;
 wallet_held:=public.fn_ca_promo_profit_locked_at(p_club,p_user,'player_wallet',p_user);
 agent_held:=public.fn_ca_promo_profit_locked_at(p_club,p_user,'agent_wallet',p_user);
 RETURN jsonb_build_object('wallet_profit_locked',wallet_held,'agent_profit_locked',agent_held,'profit_locked',held,
 'profit_fee_target',target,'profit_fee_progress',progress,'profit_fee_remaining',GREATEST(target-progress,0),
 'profit_percent',CASE WHEN held=0 THEN 100 WHEN target<=0 THEN 0 ELSE LEAST(99.99,100*progress/target) END,
 'integrity_review_available',EXISTS(SELECT 1 FROM public.ca_promo_integrity_cases k WHERE
 ((k.club_id=p_club AND k.recipient_id=p_user) OR EXISTS(SELECT 1 FROM public.ca_promo_integrity_custody c WHERE c.case_id=k.id AND c.club_id=p_club AND c.user_id=p_user AND c.amount>0))
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases r WHERE r.case_id=k.id)),
 'override_available',COALESCE(override_available,false),'agent_wallet',agent_balance,'agent_cashable',CASE WHEN agent_balance IS NULL THEN NULL ELSE GREATEST(agent_balance-public.fn_ca_promo_restricted_at(p_club,p_user,'agent_wallet',p_user),0) END);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_summary(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_profit_guard_exit(p_ledger uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;restricted numeric;balance numeric;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 IF l.from_type NOT IN('player_wallet','agent_wallet') OR public.fn_ca_promo_profit_locked_at(l.club_id,l.from_entity_id,l.from_type,l.from_entity_id)<=0 THEN RETURN;END IF;
 restricted:=public.fn_ca_promo_restricted_at(l.club_id,l.from_entity_id,l.from_type,l.from_entity_id);
 IF l.from_type='agent_wallet' THEN SELECT agent_wallet_balance INTO balance FROM public.agents WHERE club_id=l.club_id AND user_id=l.from_entity_id;
 ELSE SELECT chip_balance INTO balance FROM public.club_members WHERE club_id=l.club_id AND user_id=l.from_entity_id;END IF;
 IF COALESCE(balance,0)<restricted THEN RAISE EXCEPTION 'Promo Winnings Stay Locked Until Their Original Two-Times Fee Requirement Is Met.' USING ERRCODE='P0001',HINT='promo_winnings_play_through_locked';END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_guard_exit(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $original_cashability$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_play_through_summary(uuid,uuid)'::regprocedure) INTO def;
 needle:='RETURN jsonb_build_object(';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_promo_summary_return_changed';END IF;
 def:=replace(def,needle,'RETURN public.fn_ca_promo_profit_summary(p_club_id,p_user_id)||jsonb_build_object(');
 needle:='GREATEST(v_balance - public.fn_ca_promo_locked_at(p_club_id,p_user_id,''player_wallet'',p_user_id)-public.fn_ca_promo_integrity_locked_at(p_club_id,p_user_id,''player_wallet'',p_user_id),0)';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_cashable_union_changed';END IF;
 EXECUTE replace(def,needle,'GREATEST(v_balance-public.fn_ca_promo_restricted_at(p_club_id,p_user_id,''player_wallet'',p_user_id),0)');
 SELECT pg_get_functiondef('public.fn_ca_promo_play_through_on_exit()'::regprocedure) INTO def;
 needle:='PERFORM public.fn_ca_promo_integrity_guard_exit(NEW.id);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_restricted_exit_changed';END IF;
 EXECUTE replace(def,needle,needle||E'\n PERFORM public.fn_ca_promo_profit_guard_exit(NEW.id);');
END $original_cashability$;

-- Reuse the durable original accepted clock as a compact closed-world
-- completion witness. Positive investment slices carry the source detail;
-- complete version1 plus no positive slice is an authoritative zero.
ALTER TABLE public.ca_promo_cash_hand_clocks ADD COLUMN profit_capture_version smallint CHECK(profit_capture_version=1);
DO $original_clock_immutability$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_ca_promo_cash_clock_is_immutable()'::regprocedure)<>'ad78205c119fbf000902fc8603900f03' THEN RAISE EXCEPTION 'original_accepted_clock_immutability_changed';END IF;
END $original_clock_immutability$;
CREATE OR REPLACE FUNCTION public.fn_ca_promo_cash_clock_is_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='public','pg_temp' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.profit_capture_version IS NULL AND NEW.profit_capture_version=1
  AND ROW(NEW.hand_id,NEW.table_id,NEW.hand_number,NEW.accepted_at) IS NOT DISTINCT FROM ROW(OLD.hand_id,OLD.table_id,OLD.hand_number,OLD.accepted_at) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'original_promo_cash_hand_clock_is_immutable' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_cash_clock_is_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE public.ca_promo_profit_cash_investment (
 hand_id uuid NOT NULL REFERENCES public.ca_promo_cash_hand_clocks(hand_id),grant_id uuid NOT NULL REFERENCES public.ca_promo_profit_gates(grant_id),
 club_id uuid NOT NULL,user_id uuid NOT NULL,table_id uuid NOT NULL,phase_id uuid NOT NULL REFERENCES public.ca_promo_profit_fee_phases(id),
 principal_contribution numeric NOT NULL CHECK(principal_contribution>=0),profit_contribution numeric NOT NULL CHECK(profit_contribution>=0),
 eligible_contribution numeric NOT NULL CHECK(eligible_contribution>0),total_contribution numeric NOT NULL,
 CHECK(eligible_contribution=principal_contribution+profit_contribution AND eligible_contribution<=total_contribution),
 PRIMARY KEY(hand_id,grant_id)
);
ALTER TABLE public.ca_promo_profit_cash_investment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_profit_cash_investment FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_profit_cash_investment TO service_role;
CREATE TRIGGER ca_promo_profit_investment_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_profit_cash_investment
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER ca_promo_profit_investment_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_cash_investment
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE FUNCTION public.fn_ca_promo_profit_gate_is_final() RETURNS trigger
LANGUAGE plpgsql SET search_path='public','pg_temp' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.grant_id=OLD.grant_id AND OLD.unlocked_at IS NULL AND NEW.unlocked_at IS NOT NULL AND isfinite(NEW.unlocked_at) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'original_winnings_unlock_is_final' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_gate_is_final() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_profit_gate_final BEFORE UPDATE OR DELETE ON public.ca_promo_profit_gates
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_gate_is_final();
CREATE TRIGGER ca_promo_profit_gate_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_gates
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();

CREATE FUNCTION public.fn_ca_promo_profit_earned_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 PERFORM public.fn_ca_promo_notice_profit_unlocked(NEW.grant_id,NEW.unlocked_at);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_earned_notice() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_profit_earned_notice AFTER UPDATE OF unlocked_at ON public.ca_promo_profit_gates
 FOR EACH ROW WHEN(OLD.unlocked_at IS NULL AND NEW.unlocked_at IS NOT NULL)
 EXECUTE FUNCTION public.fn_ca_promo_profit_earned_notice();

CREATE TABLE public.ca_promo_profit_cash_positions (
 hand_id uuid NOT NULL REFERENCES public.ca_promo_cash_hand_clocks(hand_id),club_id uuid NOT NULL,user_id uuid NOT NULL,table_id uuid NOT NULL,
 stack_before numeric NOT NULL,stack_after numeric NOT NULL,contribution numeric NOT NULL,
 principal_before numeric NOT NULL,profit_before numeric NOT NULL,review_before numeric NOT NULL,overlap_before numeric NOT NULL,
 review_positions jsonb NOT NULL,profit_positions jsonb NOT NULL,overlap_positions jsonb NOT NULL,
 PRIMARY KEY(hand_id,club_id,user_id),
 CHECK(stack_before>=0 AND stack_after>=0 AND contribution>=0 AND principal_before>=0 AND profit_before>=0 AND review_before>=overlap_before AND overlap_before>=0 AND overlap_before<=profit_before),
 CHECK(principal_before+profit_before+review_before-overlap_before<=stack_before)
);
ALTER TABLE public.ca_promo_profit_cash_positions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_profit_cash_positions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_profit_cash_positions TO service_role;
CREATE TRIGGER ca_promo_profit_cash_positions_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_profit_cash_positions
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER ca_promo_profit_cash_positions_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_cash_positions
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE FUNCTION public.fn_ca_promo_profit_capture_cash(p_hand uuid,p_table uuid,p_stacks jsonb,p_facts jsonb,p_places jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE s jsonb;r record;club uuid;place uuid;investment numeric;principal numeric;profit numeric;review numeric;overlap numeric;
 clean numeric;profit_only_risk numeric;review_risk numeric;principal_risk numeric;scopes integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL AND enforced_from<=clock_timestamp()) THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM public.tables WHERE id=p_table AND tournament_id IS NOT NULL) THEN RETURN;END IF;
 PERFORM public.fn_ca_promo_capture_cash_hand_clock(p_hand,p_table);
 IF EXISTS(SELECT 1 FROM public.ca_promo_cash_hand_clocks WHERE hand_id=p_hand AND profit_capture_version=1) THEN RETURN;END IF;
 -- Existing original member advisory namespaces precede grant and case locks.
 FOR r IN SELECT DISTINCT g.club_id,g.user_id FROM public.ca_promo_play_through_grants g
 WHERE g.id IN(SELECT c.grant_id FROM public.ca_promo_principal_custody c WHERE c.kind='table_stack' AND c.amount>0 AND (c.entity_id=p_table OR c.entity_id IN(SELECT value::uuid FROM jsonb_each_text(p_places)))
 UNION SELECT c.grant_id FROM public.ca_promo_profit_custody c WHERE c.kind='table_stack' AND c.amount>0 AND (c.entity_id=p_table OR c.entity_id IN(SELECT value::uuid FROM jsonb_each_text(p_places)))) ORDER BY g.club_id,g.user_id LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca_promo_play_through:'||r.club_id::text||':'||r.user_id::text,0)) THEN RAISE EXCEPTION 'original_winnings_member_scope_busy' USING ERRCODE='55P03';END IF;
 END LOOP;
 PERFORM 1 FROM public.ca_promo_play_through_grants g WHERE (g.club_id,g.user_id) IN(
 SELECT x.club_id,x.user_id FROM public.ca_promo_play_through_grants x WHERE x.id IN(
 SELECT c.grant_id FROM public.ca_promo_principal_custody c WHERE c.kind='table_stack' AND c.amount>0 AND (c.entity_id=p_table OR c.entity_id IN(SELECT value::uuid FROM jsonb_each_text(p_places)))
 UNION SELECT c.grant_id FROM public.ca_promo_profit_custody c WHERE c.kind='table_stack' AND c.amount>0 AND (c.entity_id=p_table OR c.entity_id IN(SELECT value::uuid FROM jsonb_each_text(p_places))))) ORDER BY g.granted_at,g.id FOR UPDATE NOWAIT;
 PERFORM 1 FROM public.ca_promo_integrity_cases k WHERE k.id IN(SELECT h.case_id FROM public.ca_promo_integrity_custody h WHERE h.kind='table_stack' AND h.amount>0 AND (h.entity_id=p_table OR h.entity_id IN(SELECT value::uuid FROM jsonb_each_text(p_places)))) ORDER BY k.id FOR UPDATE NOWAIT;
 -- The original accepted owner validates the entire monetary participant set.
 -- Only the player's own tracked investments are needed for their W fraction;
 -- an uncertified legacy opponent never becomes a new hand-wide refusal.
 FOR s IN SELECT value FROM jsonb_array_elements(p_stacks) ORDER BY value->>'user_id' LOOP
  place:=COALESCE((p_places->>(s->>'user_id'))::uuid,p_table);
  PERFORM 1 FROM public.ca_promo_play_through_grants g WHERE g.id IN(
   SELECT c.grant_id FROM public.ca_promo_principal_custody c WHERE c.kind='table_stack' AND c.entity_id=place AND c.amount>0
   UNION SELECT c.grant_id FROM public.ca_promo_profit_custody c WHERE c.user_id=(s->>'user_id')::uuid AND c.kind='table_stack' AND c.entity_id=place AND c.amount>0)
  AND g.user_id=(s->>'user_id')::uuid ORDER BY g.granted_at,g.id FOR UPDATE;
  SELECT count(DISTINCT q.club_id),min(q.club_id::text)::uuid INTO scopes,club FROM(
   SELECT g.club_id FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
   WHERE g.user_id=(s->>'user_id')::uuid AND g.closed_at IS NULL AND c.kind='table_stack' AND c.entity_id=place AND c.amount>0
   UNION SELECT c.club_id FROM public.ca_promo_profit_custody c JOIN public.ca_promo_profit_gates w ON w.grant_id=c.grant_id
   WHERE c.user_id=(s->>'user_id')::uuid AND c.kind='table_stack' AND c.entity_id=place AND c.amount>0 AND w.unlocked_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=c.grant_id))q;
  IF scopes=0 THEN CONTINUE;END IF;
  IF scopes<>1 THEN RAISE EXCEPTION 'original_restricted_funding_account_conflict';END IF;
  principal:=public.fn_ca_promo_locked_at(club,(s->>'user_id')::uuid,'table_stack',place);
  profit:=public.fn_ca_promo_profit_locked_at(club,(s->>'user_id')::uuid,'table_stack',place);
  IF principal+profit=0 THEN CONTINUE;END IF;
  review:=public.fn_ca_promo_integrity_locked_at(club,(s->>'user_id')::uuid,'table_stack',place);
  overlap:=public.fn_ca_promo_profit_overlap_at(club,(s->>'user_id')::uuid,'table_stack',place);
  IF principal+profit+review-overlap>(s->>'stack_before')::numeric THEN RAISE EXCEPTION 'original_winnings_sources_exceed_accepted_stack';END IF;
  investment:=GREATEST(COALESCE((p_facts->'contributions'->>(s->>'user_id'))::numeric,0)-COALESCE((p_facts->'returned_uncalled'->>(s->>'user_id'))::numeric,0),0);
  clean:=(s->>'stack_before')::numeric-principal-profit-review+overlap;
  profit_only_risk:=LEAST(profit-overlap,GREATEST(investment-clean,0));
  review_risk:=LEAST(review,GREATEST(investment-clean-(profit-overlap),0));
  principal_risk:=LEAST(principal,GREATEST(investment-((s->>'stack_before')::numeric-principal),0));
  WITH p AS MATERIALIZED(
   SELECT c.grant_id,LEAST(c.amount,GREATEST(principal_risk-COALESCE(sum(c.amount) OVER(ORDER BY g.granted_at,g.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0),0)) risk
   FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
   JOIN public.fn_ca_promo_play_through_state(club,(s->>'user_id')::uuid) st ON st.grant_id=g.id AND st.state IN('locked','expired_pending')
   WHERE g.club_id=club AND g.user_id=(s->>'user_id')::uuid AND c.kind='table_stack' AND c.entity_id=place AND c.amount>0
  ), overlap_rows AS MATERIALIZED(
   SELECT o.* FROM public.ca_promo_profit_integrity_overlap o JOIN public.ca_promo_profit_gates w ON w.grant_id=o.grant_id AND w.unlocked_at IS NULL
   WHERE o.club_id=club AND o.user_id=(s->>'user_id')::uuid AND o.kind='table_stack' AND o.entity_id=place AND o.amount>0
   AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=o.case_id)
   AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides z WHERE z.grant_id=o.grant_id)
  ), w AS MATERIALIZED(
   SELECT c.grant_id,g.granted_at,c.amount-COALESCE((SELECT sum(o.amount) FROM overlap_rows o WHERE o.grant_id=c.grant_id),0) only_amount
   FROM public.ca_promo_profit_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
   JOIN public.ca_promo_profit_gates gate ON gate.grant_id=c.grant_id AND gate.unlocked_at IS NULL
   WHERE c.club_id=club AND c.user_id=(s->>'user_id')::uuid AND c.kind='table_stack' AND c.entity_id=place AND c.amount>0
   AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides z WHERE z.grant_id=c.grant_id)
  ), only_risk AS(
   SELECT w.grant_id,LEAST(w.only_amount,GREATEST(profit_only_risk-COALESCE(sum(w.only_amount) OVER(ORDER BY w.granted_at,w.grant_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0),0)) risk FROM w
  ), h AS MATERIALIZED(
   SELECT c.case_id,c.amount,COALESCE((SELECT sum(o.amount) FROM overlap_rows o WHERE o.case_id=c.case_id),0) overlap,
   LEAST(c.amount,GREATEST(review_risk-COALESCE(sum(c.amount) OVER(ORDER BY c.case_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0),0)) risk
   FROM public.ca_promo_integrity_custody c WHERE c.club_id=club AND c.user_id=(s->>'user_id')::uuid AND c.kind='table_stack' AND c.entity_id=place AND c.amount>0
   AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=c.case_id)
  ), overlap_risk AS(
   SELECT o.grant_id,LEAST(o.amount,GREATEST(LEAST(h.overlap,GREATEST(h.risk-(h.amount-h.overlap),0))-
    COALESCE(sum(o.amount) OVER(PARTITION BY o.case_id ORDER BY g.granted_at,g.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0),0)) risk
   FROM overlap_rows o JOIN h ON h.case_id=o.case_id JOIN public.ca_promo_play_through_grants g ON g.id=o.grant_id
  ), amounts AS(
   SELECT x.grant_id,sum(x.p) principal,sum(x.w) profit FROM(
    SELECT p.grant_id,p.risk p,0::numeric w FROM p UNION ALL SELECT w.grant_id,0,w.risk FROM only_risk w
    UNION ALL SELECT o.grant_id,0,o.risk FROM overlap_risk o)x GROUP BY x.grant_id
  ) INSERT INTO public.ca_promo_profit_cash_investment
  SELECT p_hand,a.grant_id,club,(s->>'user_id')::uuid,place,phase.id,a.principal,a.profit,a.principal+a.profit,investment
  FROM amounts a JOIN public.ca_promo_profit_gates gate ON gate.grant_id=a.grant_id AND gate.unlocked_at IS NULL
  CROSS JOIN LATERAL(SELECT f.id FROM public.ca_promo_profit_fee_phases f WHERE f.grant_id=a.grant_id ORDER BY f.activated_at DESC,f.id DESC LIMIT 1)phase
  WHERE a.principal+a.profit>0 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides z WHERE z.grant_id=a.grant_id);
  IF (SELECT COALESCE(sum(x.eligible_contribution),0) FROM public.ca_promo_profit_cash_investment x WHERE x.hand_id=p_hand AND x.club_id=club AND x.user_id=(s->>'user_id')::uuid)>investment THEN RAISE EXCEPTION 'original_winnings_investment_not_conserved';END IF;
  IF profit>0 OR EXISTS(SELECT 1 FROM public.ca_promo_profit_cash_investment x WHERE x.hand_id=p_hand AND x.club_id=club AND x.user_id=(s->>'user_id')::uuid) THEN
  INSERT INTO public.ca_promo_profit_cash_positions
  SELECT p_hand,club,(s->>'user_id')::uuid,place,(s->>'stack_before')::numeric,(s->>'stack')::numeric,investment,principal,profit,review,overlap,
   (SELECT COALESCE(jsonb_agg(jsonb_build_object('case_id',c.case_id,'amount',c.amount) ORDER BY c.case_id),'[]')
    FROM public.ca_promo_integrity_custody c WHERE c.club_id=club AND c.user_id=(s->>'user_id')::uuid AND c.kind='table_stack' AND c.entity_id=place AND c.amount>0
    AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=c.case_id)),
   (SELECT COALESCE(jsonb_agg(jsonb_build_object('grant_id',c.grant_id,'amount',c.amount,'phase_id',(SELECT f.id FROM public.ca_promo_profit_fee_phases f WHERE f.grant_id=c.grant_id ORDER BY f.activated_at DESC,f.id DESC LIMIT 1)) ORDER BY g.granted_at,g.id),'[]')
    FROM public.ca_promo_profit_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
    JOIN public.ca_promo_profit_gates w ON w.grant_id=c.grant_id AND w.unlocked_at IS NULL
    WHERE c.club_id=club AND c.user_id=(s->>'user_id')::uuid AND c.kind='table_stack' AND c.entity_id=place AND c.amount>0
    AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides z WHERE z.grant_id=c.grant_id)),
   (SELECT COALESCE(jsonb_agg(jsonb_build_object('grant_id',o.grant_id,'case_id',o.case_id,'amount',o.amount) ORDER BY o.case_id,o.grant_id),'[]') FROM public.ca_promo_profit_integrity_overlap o
    JOIN public.ca_promo_profit_gates w ON w.grant_id=o.grant_id AND w.unlocked_at IS NULL WHERE o.club_id=club AND o.user_id=(s->>'user_id')::uuid AND o.kind='table_stack' AND o.entity_id=place AND o.amount>0
    AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=o.case_id) AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides z WHERE z.grant_id=o.grant_id));
  END IF;
 END LOOP;
 UPDATE public.ca_promo_cash_hand_clocks SET profit_capture_version=1 WHERE hand_id=p_hand AND profit_capture_version IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'original_accepted_winnings_clock_missing';END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_capture_cash(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $original_own_cash_source$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_accept_cash_hand(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure) INTO def;
 needle:='PERFORM public.fn_ca_promo_capture_cash_hand_clock(p_hand,p_table);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_accepted_cash_clock_anchor_changed';END IF;
 EXECUTE replace(def,needle,'PERFORM public.fn_ca_promo_profit_capture_cash(p_hand,p_table,p_stacks,p_facts,p_places);'||E'\n '||needle);
END $original_own_cash_source$;

CREATE FUNCTION public.fn_ca_promo_profit_capture_is_open() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.ca_promo_cash_hand_clocks WHERE hand_id=NEW.hand_id AND profit_capture_version=1) THEN RAISE EXCEPTION 'original_winnings_capture_is_already_complete' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_capture_is_open() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_profit_investment_insert_before_complete BEFORE INSERT ON public.ca_promo_profit_cash_investment
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_capture_is_open();
CREATE TRIGGER ca_promo_profit_positions_insert_before_complete BEFORE INSERT ON public.ca_promo_profit_cash_positions
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_capture_is_open();

CREATE UNIQUE INDEX ca_promo_profit_one_open_phase ON public.ca_promo_profit_fee_phases(grant_id) WHERE closed_at IS NULL;
CREATE TABLE public.ca_promo_profit_realization_receipts (
 source_kind text NOT NULL CHECK(source_kind IN('cash_win','tournament_win','bbj','stake_refund')),source_id uuid NOT NULL,
 grant_id uuid NOT NULL REFERENCES public.ca_promo_profit_gates(grant_id),club_id uuid NOT NULL,user_id uuid NOT NULL,
 kind text NOT NULL,entity_id uuid NOT NULL,amount numeric NOT NULL,restricted numeric NOT NULL,
 phase_id uuid REFERENCES public.ca_promo_profit_fee_phases(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(amount>=0 AND restricted>=0 AND restricted<=amount AND amount=round(amount,2) AND restricted=round(restricted,2)),
 CHECK(amount::text NOT IN('NaN','Infinity','-Infinity')),PRIMARY KEY(source_kind,source_id,grant_id)
);
ALTER TABLE public.ca_promo_profit_realization_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_profit_realization_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_profit_realization_receipts TO service_role;
CREATE TRIGGER ca_promo_profit_realization_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_profit_realization_receipts
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER ca_promo_profit_realization_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_realization_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
-- Private metadata constructor, invoked only by verified original earning and
-- exact-refund owners. Ordinary deposits/rakeback never call this constructor.
CREATE FUNCTION public.fn_ca_promo_profit_credit_owned(p_source_kind text,p_source uuid,p_grant uuid,p_club uuid,p_user uuid,
 p_kind text,p_entity uuid,p_amount numeric) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE g public.ca_promo_play_through_grants%ROWTYPE;prior public.ca_promo_profit_realization_receipts%ROWTYPE;
 phase uuid;restricted numeric:=0;
BEGIN
 IF p_source_kind NOT IN('cash_win','tournament_win','bbj','stake_refund') OR p_source IS NULL OR p_club IS NULL OR p_user IS NULL OR p_entity IS NULL
 OR p_kind NOT IN('player_wallet','agent_wallet','table_stack','pending_addon','event','ticket') OR p_amount IS NULL OR p_amount<0 OR p_amount<>round(p_amount,2)
 OR p_amount::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'invalid_original_winnings_realization';END IF;
 SELECT * INTO STRICT g FROM public.ca_promo_play_through_grants WHERE id=p_grant FOR UPDATE;
 IF g.user_id IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'original_winnings_recipient_mismatch';END IF;
 SELECT * INTO prior FROM public.ca_promo_profit_realization_receipts WHERE source_kind=p_source_kind AND source_id=p_source AND grant_id=p_grant;
 IF FOUND THEN
  IF ROW(prior.club_id,prior.user_id,prior.kind,prior.entity_id,prior.amount) IS DISTINCT FROM ROW(p_club,p_user,p_kind,p_entity,p_amount) THEN RAISE EXCEPTION 'original_winnings_realization_identity_reused';END IF;
  RETURN prior.restricted;
 END IF;
 PERFORM public.fn_ca_promo_profit_settle(g.club_id,g.user_id);
 IF p_amount>0 AND EXISTS(SELECT 1 FROM public.ca_promo_profit_gates w WHERE w.grant_id=p_grant AND w.unlocked_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=p_grant) THEN
  -- Expiry ends an empty original potential-W phase; a later exact original
  -- asset activates only now, behind all intervening gift blocks.
  IF g.expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_custody c WHERE c.grant_id=p_grant AND c.amount>0) THEN
   UPDATE public.ca_promo_profit_fee_phases SET closed_at=g.expires_at WHERE grant_id=p_grant AND source_kind='gift' AND closed_at IS NULL;
  END IF;
  SELECT f.id INTO phase FROM public.ca_promo_profit_fee_phases f WHERE f.grant_id=p_grant AND f.closed_at IS NULL;
  IF phase IS NULL THEN
   INSERT INTO public.ca_promo_profit_fee_phases(grant_id,source_kind,source_id) VALUES(p_grant,p_source_kind,p_source) RETURNING id INTO phase;
  END IF;
  restricted:=p_amount;
  INSERT INTO public.ca_promo_profit_custody VALUES(p_grant,p_club,p_user,p_kind,p_entity,p_amount)
  ON CONFLICT(grant_id,club_id,user_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_profit_custody.amount+EXCLUDED.amount;
 END IF;
 INSERT INTO public.ca_promo_profit_realization_receipts(source_kind,source_id,grant_id,club_id,user_id,kind,entity_id,amount,restricted,phase_id)
 VALUES(p_source_kind,p_source,p_grant,p_club,p_user,p_kind,p_entity,p_amount,restricted,phase);
 RETURN restricted;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_credit_owned(text,uuid,uuid,uuid,uuid,text,uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_override_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN PERFORM public.fn_ca_promo_notice_support_override(NEW.grant_id);RETURN NULL;END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_override_notice() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_profit_override_notice AFTER INSERT ON public.ca_promo_profit_overrides
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_override_notice();

-- Review changes cashability, never the original charge's source cost.
-- Keep reviewed-case raw expense metadata exact instead of shifting its fee
-- to a different unreleased case. Refunds still restore only unreleased H.
DO $original_historical_case_cost$ DECLARE def text;needle text;BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_ca_promo_integrity_consume_entry_fee(uuid)'::regprocedure)<>'3d8904a116e459c1c0e8288b4c7c21db' THEN RAISE EXCEPTION 'original_integrity_fee_cost_owner_changed';END IF;
 SELECT pg_get_functiondef('public.fn_ca_promo_integrity_consume_entry_fee(uuid)'::regprocedure) INTO def;
 needle:=' AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id)';
 IF length(def)-length(replace(def,needle,''))<>2*length(needle) THEN RAISE EXCEPTION 'original_case_fee_fifo_changed';END IF;
 EXECUTE replace(def,needle,'');
END $original_historical_case_cost$;

-- 200638 installs the original tournament earning producer after this cold
-- core. Partial inactive installation preserves ordinary runtime; activation
-- requires that final source contract, and missing enabled provenance refuses
-- only its affected original tournament transaction.
DO $original_tournament_hand_source$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_accept_cash_hand(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure) INTO def;
 needle:='PERFORM public.fn_ca_promo_profit_capture_cash(p_hand,p_table,p_stacks,p_facts,p_places);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_winnings_capture_anchor_changed';END IF;
 EXECUTE replace(def,needle,$hook$IF EXISTS(SELECT 1 FROM public.tables WHERE id=p_table AND tournament_id IS NOT NULL) THEN
  IF to_regprocedure('public.fn_ca_promo_profit_capture_tournament_hand(uuid,uuid,jsonb)') IS NOT NULL THEN
   PERFORM public.fn_ca_promo_profit_capture_tournament_hand(p_hand,p_table,p_stacks);
  ELSIF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL AND enforced_from<=clock_timestamp()) THEN
   RAISE EXCEPTION 'original_tournament_earning_source_contract_missing';
  END IF;
 END IF;
 $hook$||needle);
END $original_tournament_hand_source$;

-- Accepted monetary loss retires existing winnings permanently. Exact original
-- later earnings/refunds use their own immutable source; deposits never do.
CREATE TABLE public.ca_promo_profit_cash_loss_slices (
 hand_id uuid NOT NULL,grant_id uuid NOT NULL REFERENCES public.ca_promo_profit_gates(grant_id),phase_id uuid NOT NULL REFERENCES public.ca_promo_profit_fee_phases(id),
 club_id uuid NOT NULL,user_id uuid NOT NULL,table_id uuid NOT NULL,profit_before numeric NOT NULL,overlap_before numeric NOT NULL,
 profit_lost numeric NOT NULL,overlap_lost numeric NOT NULL,
 CHECK(profit_before>=overlap_before AND overlap_before>=0 AND profit_lost>=overlap_lost AND overlap_lost>=0 AND profit_lost<=profit_before),PRIMARY KEY(hand_id,grant_id)
);
CREATE TABLE public.ca_promo_profit_cash_results(hand_id uuid PRIMARY KEY REFERENCES public.ca_promo_cash_hand_clocks(hand_id),recognized_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz);
CREATE TABLE public.ca_promo_profit_cash_intersections(hand_id uuid NOT NULL REFERENCES public.ca_promo_profit_cash_results(hand_id),case_id uuid NOT NULL REFERENCES public.ca_promo_integrity_cases(id),grant_id uuid NOT NULL REFERENCES public.ca_promo_profit_gates(grant_id),amount numeric NOT NULL CHECK(amount>=0 AND amount=round(amount,2)),PRIMARY KEY(hand_id,case_id,grant_id));
ALTER TABLE public.ca_promo_profit_cash_loss_slices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_promo_profit_cash_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_promo_profit_cash_intersections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_profit_cash_loss_slices,public.ca_promo_profit_cash_results,public.ca_promo_profit_cash_intersections FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_profit_cash_loss_slices,public.ca_promo_profit_cash_results,public.ca_promo_profit_cash_intersections TO service_role;
CREATE TRIGGER ca_promo_profit_cash_loss_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_profit_cash_loss_slices FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER ca_promo_profit_cash_loss_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_cash_loss_slices FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE FUNCTION public.fn_ca_promo_profit_cash_result_finality() RETURNS trigger
LANGUAGE plpgsql SET search_path='public','pg_temp' AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(OLD.hand_id,OLD.recognized_at) IS NOT DISTINCT FROM ROW(NEW.hand_id,NEW.recognized_at)
 AND OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL AND isfinite(NEW.completed_at) AND NEW.completed_at>=OLD.recognized_at THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'original_cash_winnings_result_is_final' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_cash_result_finality() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_profit_cash_result_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_profit_cash_results FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_cash_result_finality();
CREATE FUNCTION public.fn_ca_promo_profit_cash_intersection_finality() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF TG_OP='DELETE' OR EXISTS(SELECT 1 FROM public.ca_promo_profit_cash_results WHERE hand_id=NEW.hand_id AND completed_at IS NOT NULL) THEN RAISE EXCEPTION 'original_cash_winnings_intersection_is_final' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND (ROW(NEW.hand_id,NEW.case_id,NEW.grant_id) IS DISTINCT FROM ROW(OLD.hand_id,OLD.case_id,OLD.grant_id) OR NEW.amount-OLD.amount<>.01) THEN RAISE EXCEPTION 'original_cash_winnings_intersection_changed' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_cash_intersection_finality() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_profit_cash_intersection_final BEFORE INSERT OR UPDATE OR DELETE ON public.ca_promo_profit_cash_intersections FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_cash_intersection_finality();
CREATE TRIGGER ca_promo_profit_cash_intersection_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_cash_intersections FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER ca_promo_profit_cash_result_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_cash_results FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE FUNCTION public.fn_ca_promo_profit_retire_cash(p_hand uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE p record;w jsonb;before_overlap numeric;after_overlap numeric;only_before numeric;only_total numeric;only_survives numeric;preceding numeric;n numeric;overlap_loss numeric;h_after numeric;p_after numeric;
BEGIN
 FOR p IN SELECT * FROM public.ca_promo_profit_cash_positions WHERE hand_id=p_hand AND profit_before>0 ORDER BY club_id,user_id LOOP
  IF EXISTS(SELECT 1 FROM public.ca_promo_profit_cash_loss_slices WHERE hand_id=p_hand AND club_id=p.club_id AND user_id=p.user_id) THEN CONTINUE;END IF;
  p_after:=public.fn_ca_promo_locked_at(p.club_id,p.user_id,'table_stack',p.table_id);
  h_after:=public.fn_ca_promo_integrity_locked_at(p.club_id,p.user_id,'table_stack',p.table_id);
  only_total:=p.profit_before-p.overlap_before;
  only_survives:=LEAST(only_total,GREATEST(p.stack_after-p_after-h_after,0));preceding:=0;
  FOR w IN SELECT value FROM jsonb_array_elements(p.profit_positions) LOOP
   SELECT COALESCE(sum((x->>'amount')::numeric),0) INTO before_overlap FROM jsonb_array_elements(p.overlap_positions)x WHERE x->>'grant_id'=w->>'grant_id';
   SELECT COALESCE(sum(o.amount),0) INTO after_overlap FROM public.ca_promo_profit_integrity_overlap o WHERE o.grant_id=(w->>'grant_id')::uuid AND o.club_id=p.club_id AND o.user_id=p.user_id AND o.kind='table_stack' AND o.entity_id=p.table_id AND o.case_id IN(SELECT (x->>'case_id')::uuid FROM jsonb_array_elements(p.overlap_positions)x WHERE x->>'grant_id'=w->>'grant_id');
   overlap_loss:=before_overlap-after_overlap;
   IF overlap_loss<0 OR overlap_loss>before_overlap THEN RAISE EXCEPTION 'original_cash_overlap_loss_not_conserved';END IF;
   only_before:=(w->>'amount')::numeric-before_overlap;
   -- Loss allocation consumes earlier source lots first, preserving later ones.
   n:=LEAST(only_before,GREATEST(only_total-only_survives-preceding,0));preceding:=preceding+only_before;
   IF n>0 THEN PERFORM public.fn_ca_promo_profit_move_grant((w->>'grant_id')::uuid,p.club_id,p.user_id,'table_stack',p.table_id,NULL,NULL,n);END IF;
   INSERT INTO public.ca_promo_profit_cash_loss_slices VALUES(p_hand,(w->>'grant_id')::uuid,(w->>'phase_id')::uuid,p.club_id,p.user_id,p.table_id,(w->>'amount')::numeric,before_overlap,n+overlap_loss,overlap_loss);
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_retire_cash(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_finish_cash(p_hand uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE p record;r record;k record;gain numeric;risk numeric;denominator numeric;total numeric;restricted numeric;incoming numeric;target numeric;leftover numeric;n numeric;active_risk numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_cash_positions WHERE hand_id=p_hand) THEN RETURN;END IF;
 INSERT INTO public.ca_promo_profit_cash_results(hand_id) VALUES(p_hand) ON CONFLICT(hand_id) DO NOTHING;
 IF NOT FOUND THEN RETURN;END IF;
 PERFORM public.fn_ca_promo_profit_retire_cash(p_hand);
 FOR p IN SELECT * FROM public.ca_promo_profit_cash_positions WHERE hand_id=p_hand AND stack_after>stack_before ORDER BY club_id,user_id LOOP
  gain:=p.stack_after-p.stack_before;
  SELECT sum(i.eligible_contribution),min(i.total_contribution) INTO risk,denominator FROM public.ca_promo_profit_cash_investment i WHERE i.hand_id=p_hand AND i.user_id=p.user_id;
  IF risk IS NULL THEN CONTINUE;END IF;
  IF denominator<=0 OR risk>denominator THEN RAISE EXCEPTION 'original_cash_profit_investment_invalid';END IF;
  total:=round(gain*risk/denominator,2);
  FOR r IN WITH raw AS(SELECT i.grant_id,g.granted_at,gain*i.eligible_contribution/denominator exact FROM public.ca_promo_profit_cash_investment i JOIN public.ca_promo_play_through_grants g ON g.id=i.grant_id WHERE i.hand_id=p_hand AND i.user_id=p.user_id),ranked AS(SELECT *,floor(exact*100)/100 base,row_number() OVER(ORDER BY exact*100-floor(exact*100) DESC,granted_at,grant_id) rank,sum(floor(exact*100)/100) OVER() base_total FROM raw)
   SELECT grant_id,base+CASE WHEN rank<=round((total-base_total)*100)::integer THEN .01 ELSE 0 END amount FROM ranked ORDER BY granted_at,grant_id LOOP
   IF r.amount>0 THEN restricted:=public.fn_ca_promo_profit_credit_owned('cash_win',p_hand,r.grant_id,p.club_id,p.user_id,'table_stack',p.table_id,r.amount);END IF;
  END LOOP;
  -- Each incoming source-review case receives the same frozen own-investment
  -- fraction. Row/column capacities keep cent rounding within actual W and H.
  SELECT COALESCE(sum(GREATEST(h.amount-COALESCE((SELECT (v->>'amount')::numeric FROM jsonb_array_elements(p.review_positions)v WHERE (v->>'case_id')::uuid=h.case_id),0),0)),0) INTO incoming
   FROM public.ca_promo_integrity_custody h WHERE h.club_id=p.club_id AND h.user_id=p.user_id AND h.kind='table_stack' AND h.entity_id=p.table_id AND h.amount>0 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=h.case_id);
  SELECT COALESCE(sum(i.eligible_contribution),0) INTO active_risk FROM public.ca_promo_profit_cash_investment i
   JOIN public.ca_promo_profit_realization_receipts paid ON paid.source_kind='cash_win' AND paid.source_id=p_hand AND paid.grant_id=i.grant_id AND paid.restricted>0 WHERE i.hand_id=p_hand AND i.user_id=p.user_id;
  target:=round(incoming*active_risk/denominator,2);
  -- Floor all exact cells first; largest fractional cells receive spare cents
  -- only while both the paid gain's W column and incoming H row have capacity.
  FOR r IN SELECT h.case_id,i.grant_id,GREATEST(h.amount-COALESCE((SELECT (v->>'amount')::numeric FROM jsonb_array_elements(p.review_positions)v WHERE (v->>'case_id')::uuid=h.case_id),0),0)*i.eligible_contribution/denominator exact
   FROM public.ca_promo_integrity_custody h CROSS JOIN public.ca_promo_profit_cash_investment i JOIN public.ca_promo_profit_realization_receipts paid ON paid.source_kind='cash_win' AND paid.source_id=p_hand AND paid.grant_id=i.grant_id AND paid.restricted>0
   WHERE i.hand_id=p_hand AND i.user_id=p.user_id AND h.club_id=p.club_id AND h.user_id=p.user_id AND h.kind='table_stack' AND h.entity_id=p.table_id AND h.amount>0 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=h.case_id) LOOP
   INSERT INTO public.ca_promo_profit_cash_intersections VALUES(p_hand,r.case_id,r.grant_id,floor(r.exact*100)/100);
  END LOOP;
  SELECT target-COALESCE(sum(x.amount),0) INTO leftover FROM public.ca_promo_profit_cash_intersections x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id WHERE x.hand_id=p_hand AND g.user_id=p.user_id;
  -- An already earned/overridden source creates no W column or intersection.
  IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_realization_receipts x WHERE x.source_kind='cash_win' AND x.source_id=p_hand AND x.user_id=p.user_id AND x.restricted>0) THEN CONTINUE;END IF;
  target:=LEAST(target,(SELECT COALESCE(sum(x.restricted),0) FROM public.ca_promo_profit_realization_receipts x WHERE x.source_kind='cash_win' AND x.source_id=p_hand AND x.user_id=p.user_id));
  SELECT target-COALESCE(sum(x.amount),0) INTO leftover FROM public.ca_promo_profit_cash_intersections x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id WHERE x.hand_id=p_hand AND g.user_id=p.user_id;
  FOR r IN SELECT x.case_id,x.grant_id,(GREATEST(h.amount-COALESCE((SELECT (v->>'amount')::numeric FROM jsonb_array_elements(p.review_positions)v WHERE (v->>'case_id')::uuid=x.case_id),0),0)*i.eligible_contribution/denominator)*100-floor((GREATEST(h.amount-COALESCE((SELECT (v->>'amount')::numeric FROM jsonb_array_elements(p.review_positions)v WHERE (v->>'case_id')::uuid=x.case_id),0),0)*i.eligible_contribution/denominator)*100) remainder
   FROM public.ca_promo_profit_cash_intersections x JOIN public.ca_promo_integrity_custody h ON h.case_id=x.case_id AND h.club_id=p.club_id AND h.user_id=p.user_id AND h.kind='table_stack' AND h.entity_id=p.table_id JOIN public.ca_promo_profit_cash_investment i ON i.hand_id=p_hand AND i.grant_id=x.grant_id JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id WHERE x.hand_id=p_hand AND i.user_id=p.user_id ORDER BY remainder DESC,g.granted_at,g.id,x.case_id LOOP
   EXIT WHEN leftover<=0;
   IF (SELECT COALESCE(sum(amount),0) FROM public.ca_promo_profit_cash_intersections WHERE hand_id=p_hand AND grant_id=r.grant_id)+.01<=(SELECT restricted FROM public.ca_promo_profit_realization_receipts WHERE source_kind='cash_win' AND source_id=p_hand AND grant_id=r.grant_id)
    AND (SELECT COALESCE(sum(amount),0) FROM public.ca_promo_profit_cash_intersections WHERE hand_id=p_hand AND case_id=r.case_id)+.01<=(SELECT GREATEST(h.amount-COALESCE((SELECT (v->>'amount')::numeric FROM jsonb_array_elements(p.review_positions)v WHERE (v->>'case_id')::uuid=r.case_id),0),0) FROM public.ca_promo_integrity_custody h WHERE h.case_id=r.case_id AND h.club_id=p.club_id AND h.user_id=p.user_id AND h.kind='table_stack' AND h.entity_id=p.table_id) THEN
    UPDATE public.ca_promo_profit_cash_intersections SET amount=amount+.01 WHERE hand_id=p_hand AND case_id=r.case_id AND grant_id=r.grant_id;leftover:=leftover-.01;
   END IF;
  END LOOP;
  IF leftover<>0 THEN RAISE EXCEPTION 'original_cash_winnings_intersection_not_conserved';END IF;
  INSERT INTO public.ca_promo_profit_integrity_overlap
   SELECT x.grant_id,x.case_id,p.club_id,p.user_id,'table_stack',p.table_id,x.amount FROM public.ca_promo_profit_cash_intersections x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id WHERE x.hand_id=p_hand AND g.user_id=p.user_id AND x.amount>0
   ON CONFLICT(grant_id,case_id,club_id,user_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_profit_integrity_overlap.amount+EXCLUDED.amount;
  IF public.fn_ca_promo_restricted_at(p.club_id,p.user_id,'table_stack',p.table_id)>p.stack_after THEN RAISE EXCEPTION 'original_cash_restrictions_exceed_paid_stack';END IF;
 END LOOP;
 UPDATE public.ca_promo_profit_cash_results SET completed_at=clock_timestamp() WHERE hand_id=p_hand;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_finish_cash(uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $original_winnings_hand_result$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_integrity_accept_hand(uuid,uuid,jsonb,jsonb,jsonb,numeric)'::regprocedure) INTO def;
 needle:='AND f.principal_lost>f.principal_before/2 AND f.principal_lost>0) THEN RETURN; END IF;';
 IF position(needle in def)=0 THEN RAISE EXCEPTION 'original_integrity_zero_source_anchor_changed';END IF;
 def:=replace(def,needle,'AND f.principal_lost>f.principal_before/2 AND f.principal_lost>0) AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_cash_positions WHERE hand_id=p_hand AND profit_before>0) THEN RETURN; END IF;');
 needle:=' FOR fund IN SELECT * FROM public.ca_promo_cash_hand_funding WHERE hand_id=p_hand'||E'\n  AND principal_lost>principal_before/2 AND principal_lost>0 ORDER BY club_id,user_id LOOP';
 IF position(needle in def)=0 THEN RAISE EXCEPTION 'original_integrity_loss_source_anchor_changed';END IF;
 def:=replace(def,needle,$hook$ PERFORM public.fn_ca_promo_profit_retire_cash(p_hand);
 FOR fund IN WITH w AS(SELECT club_id,user_id,sum(profit_before-overlap_before) before,sum(profit_lost-overlap_lost) lost FROM public.ca_promo_profit_cash_loss_slices WHERE hand_id=p_hand GROUP BY club_id,user_id),p AS(SELECT * FROM public.ca_promo_cash_hand_funding WHERE hand_id=p_hand)
 SELECT COALESCE(p.club_id,w.club_id) club_id,COALESCE(p.user_id,w.user_id) user_id,COALESCE(p.principal_before,0)+COALESCE(w.before,0) principal_before,COALESCE(p.principal_lost,0)+COALESCE(w.lost,0) principal_lost FROM p FULL JOIN w USING(club_id,user_id)
 WHERE COALESCE(p.principal_lost,0)+COALESCE(w.lost,0)>(COALESCE(p.principal_before,0)+COALESCE(w.before,0))/2 AND COALESCE(p.principal_lost,0)+COALESCE(w.lost,0)>0 ORDER BY 1,2 LOOP$hook$);
 needle:='''bank_fee'',p_bank_fee,''recipient_net_gain''';
 IF position(needle in def)=0 THEN RAISE EXCEPTION 'original_integrity_loss_evidence_anchor_changed';END IF;
 def:=replace(def,needle,$e$'source_winnings',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.grant_id),'[]') FROM public.ca_promo_profit_cash_loss_slices x WHERE x.hand_id=p_hand AND x.club_id=fund.club_id AND x.user_id=fund.user_id),'bank_fee',p_bank_fee,'recipient_net_gain'$e$);
 EXECUTE def;
 SELECT pg_get_functiondef('public.fn_ca_commit_hand_settlement(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid,jsonb)'::regprocedure) INTO def;
 needle:='PERFORM public.fn_ca_promo_integrity_accept_hand(v_hand_id,p_table_id,p_stacks,p_hand_row->''_accepted_post_commit_facts'',v_lightning_seats,p_rake+p_bbj);';
 IF position(needle in def)=0 THEN RAISE EXCEPTION 'original_winnings_result_owner_anchor_changed';END IF;
 EXECUTE replace(def,needle,needle||E'\n    PERFORM public.fn_ca_promo_profit_finish_cash(v_hand_id);');
END $original_winnings_hand_result$;

-- These charge-owned lots are physical source capital, independent of the
-- original gift's fee allocation and final unlock permission.
CREATE TABLE public.ca_promo_profit_event_lots (
 grant_id uuid NOT NULL REFERENCES public.ca_promo_profit_gates(grant_id),charge_ledger_id uuid NOT NULL,tournament_id uuid NOT NULL,club_id uuid NOT NULL,user_id uuid NOT NULL,
 original_amount numeric NOT NULL CHECK(original_amount>=0),remaining numeric NOT NULL CHECK(remaining>=0 AND remaining<=original_amount),PRIMARY KEY(grant_id,charge_ledger_id)
);
CREATE INDEX ca_promo_profit_event_position ON public.ca_promo_profit_event_lots(tournament_id,club_id,user_id,charge_ledger_id) WHERE remaining>0;
CREATE TABLE public.ca_promo_profit_event_overlap_lots (
 charge_ledger_id uuid NOT NULL,grant_id uuid NOT NULL,case_id uuid NOT NULL REFERENCES public.ca_promo_integrity_cases(id),original_amount numeric NOT NULL CHECK(original_amount>=0),remaining numeric NOT NULL CHECK(remaining>=0 AND remaining<=original_amount),
 PRIMARY KEY(charge_ledger_id,grant_id,case_id),FOREIGN KEY(grant_id,charge_ledger_id) REFERENCES public.ca_promo_profit_event_lots(grant_id,charge_ledger_id)
);
CREATE TABLE public.ca_promo_profit_event_charge_receipts (
 charge_ledger_id uuid PRIMARY KEY,club_id uuid NOT NULL,user_id uuid NOT NULL,original_profit numeric NOT NULL,original_overlap numeric NOT NULL,CHECK(original_profit>=original_overlap AND original_overlap>=0)
);
CREATE TABLE public.ca_promo_profit_entry_fee_spends (
 charge_ledger_id uuid PRIMARY KEY REFERENCES public.ca_promo_profit_event_charge_receipts(charge_ledger_id),entitlement_id uuid NOT NULL UNIQUE,gross_fee numeric NOT NULL,profit_fee numeric NOT NULL CHECK(profit_fee>=0),overlap_fee numeric NOT NULL CHECK(overlap_fee>=0 AND overlap_fee<=profit_fee)
);
CREATE TABLE public.ca_promo_profit_entry_fee_slices (
 charge_ledger_id uuid NOT NULL REFERENCES public.ca_promo_profit_entry_fee_spends(charge_ledger_id) DEFERRABLE INITIALLY DEFERRED,grant_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>0),PRIMARY KEY(charge_ledger_id,grant_id)
);
CREATE TABLE public.ca_promo_profit_entry_fee_overlap_slices (
 charge_ledger_id uuid NOT NULL,grant_id uuid NOT NULL,case_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>0),PRIMARY KEY(charge_ledger_id,grant_id,case_id),FOREIGN KEY(charge_ledger_id,grant_id) REFERENCES public.ca_promo_profit_entry_fee_slices(charge_ledger_id,grant_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE public.ca_promo_profit_entry_loss_slices (
 candidate_id uuid NOT NULL,charge_ledger_id uuid NOT NULL,grant_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>0),PRIMARY KEY(candidate_id,charge_ledger_id,grant_id)
);
CREATE TABLE public.ca_promo_profit_entry_loss_overlap_slices (
 candidate_id uuid NOT NULL,charge_ledger_id uuid NOT NULL,grant_id uuid NOT NULL,case_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>0),PRIMARY KEY(candidate_id,charge_ledger_id,grant_id,case_id)
);
CREATE TABLE public.ca_promo_profit_entry_fee_refunds(entitlement_id uuid PRIMARY KEY,charge_ledger_id uuid NOT NULL UNIQUE,amount numeric NOT NULL CHECK(amount>=0));
DO $profit_event_acl$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['ca_promo_profit_event_lots','ca_promo_profit_event_overlap_lots','ca_promo_profit_event_charge_receipts','ca_promo_profit_entry_fee_spends','ca_promo_profit_entry_fee_slices','ca_promo_profit_entry_fee_overlap_slices','ca_promo_profit_entry_loss_slices','ca_promo_profit_entry_loss_overlap_slices','ca_promo_profit_entry_fee_refunds'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',n);
 EXECUTE format('GRANT SELECT ON public.%I TO service_role',n);
 IF n NOT IN('ca_promo_profit_event_lots','ca_promo_profit_event_overlap_lots') THEN
 EXECUTE format('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable()',n);
 EXECUTE format('CREATE TRIGGER immutable_table BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable()',n);END IF;
 END LOOP;
END $profit_event_acl$;
CREATE FUNCTION public.fn_ca_promo_profit_consume_entry_fee(p_charge uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE paid public.ca_promo_event_fee_consumption_receipts%ROWTYPE;source public.ca_promo_profit_event_charge_receipts%ROWTYPE;r record;o record;
 h numeric;w numeric;overlap numeric;needed numeric;leftover numeric;n numeric;case_overlap numeric;case_cost numeric;case_principal numeric;total numeric:=0;total_overlap numeric:=0;spent jsonb:='{}';
BEGIN
 SELECT * INTO paid FROM public.ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id=p_charge;
 IF NOT FOUND THEN RETURN false;END IF;
 SELECT * INTO source FROM public.ca_promo_profit_event_charge_receipts WHERE charge_ledger_id=p_charge;
 IF NOT FOUND THEN RETURN false;END IF;
 IF ROW(source.club_id,source.user_id) IS DISTINCT FROM ROW(paid.club_id,paid.player_id) THEN RAISE EXCEPTION 'original_winnings_entry_earner_conflict';END IF;
 PERFORM 1 FROM public.tournament_refund_entitlements WHERE id=paid.entitlement_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.ca_promo_profit_entry_fee_spends WHERE charge_ledger_id=p_charge) THEN RETURN true;END IF;
 SELECT COALESCE(sum(original_amount),0) INTO w FROM public.ca_promo_profit_event_lots WHERE charge_ledger_id=p_charge;
 SELECT COALESCE(sum(original_amount),0) INTO overlap FROM public.ca_promo_profit_event_overlap_lots WHERE charge_ledger_id=p_charge;
 SELECT COALESCE(sum(original_amount),0) INTO h FROM public.ca_promo_integrity_event_lots WHERE charge_ledger_id=p_charge;
 IF w<>source.original_profit OR overlap<>source.original_overlap OR paid.original_promo+h+w-overlap>paid.charge_amount THEN RAISE EXCEPTION 'original_winnings_entry_funding_not_conserved';END IF;
 -- Existing H expense owns exact original case FIFO, including reviewed
 -- historical sources. Within each case, H-only capital precedes its W tag.
 FOR r IN SELECT f.case_id,f.amount,l.original_amount FROM public.ca_promo_integrity_fee_slices f JOIN public.ca_promo_integrity_event_lots l USING(case_id,charge_ledger_id) WHERE f.charge_ledger_id=p_charge ORDER BY f.case_id LOOP
  SELECT COALESCE(sum(original_amount),0) INTO case_overlap FROM public.ca_promo_profit_event_overlap_lots WHERE charge_ledger_id=p_charge AND case_id=r.case_id;
  leftover:=LEAST(case_overlap,GREATEST(r.amount-(r.original_amount-case_overlap),0));
  FOR o IN SELECT x.*,g.granted_at FROM public.ca_promo_profit_event_overlap_lots x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id WHERE x.charge_ledger_id=p_charge AND x.case_id=r.case_id ORDER BY g.granted_at,g.id FOR UPDATE OF x LOOP
   EXIT WHEN leftover<=0;n:=LEAST(o.remaining,leftover);
   IF n>0 THEN
    UPDATE public.ca_promo_profit_event_overlap_lots SET remaining=remaining-n WHERE charge_ledger_id=p_charge AND grant_id=o.grant_id AND case_id=o.case_id;
    UPDATE public.ca_promo_profit_integrity_overlap x SET amount=x.amount-n FROM public.ca_promo_profit_event_lots l WHERE l.grant_id=o.grant_id AND l.charge_ledger_id=p_charge AND x.grant_id=o.grant_id AND x.case_id=o.case_id AND x.club_id=l.club_id AND x.user_id=l.user_id AND x.kind='event' AND x.entity_id=l.tournament_id AND x.amount>=n;
    IF NOT FOUND THEN RAISE EXCEPTION 'original_winnings_fee_overlap_missing';END IF;
    UPDATE public.ca_promo_profit_event_lots SET remaining=remaining-n WHERE grant_id=o.grant_id AND charge_ledger_id=p_charge AND remaining>=n;
    IF NOT FOUND THEN RAISE EXCEPTION 'original_winnings_fee_capital_missing';END IF;
    PERFORM public.fn_ca_promo_profit_move_grant(o.grant_id,source.club_id,source.user_id,'event',(SELECT tournament_id FROM public.ca_promo_profit_event_lots WHERE grant_id=o.grant_id AND charge_ledger_id=p_charge),NULL,NULL,n);
    spent:=jsonb_set(spent,ARRAY[o.grant_id::text],to_jsonb(COALESCE((spent->>o.grant_id::text)::numeric,0)+n));
    INSERT INTO public.ca_promo_profit_entry_fee_overlap_slices VALUES(p_charge,o.grant_id,o.case_id,n);
    total:=total+n;total_overlap:=total_overlap+n;leftover:=leftover-n;
   END IF;
  END LOOP;
  IF leftover<>0 THEN RAISE EXCEPTION 'original_winnings_case_fee_not_conserved';END IF;
 END LOOP;
 needed:=LEAST(w-overlap,GREATEST(round(paid.gross_fee*(paid.original_promo+h+w-overlap)/paid.charge_amount,2)-round(paid.gross_fee*(paid.original_promo+h)/paid.charge_amount,2),0));leftover:=needed;
 FOR r IN SELECT l.*,l.remaining-COALESCE((SELECT sum(x.remaining) FROM public.ca_promo_profit_event_overlap_lots x WHERE x.charge_ledger_id=l.charge_ledger_id AND x.grant_id=l.grant_id),0) only_remaining FROM public.ca_promo_profit_event_lots l JOIN public.ca_promo_play_through_grants g ON g.id=l.grant_id WHERE l.charge_ledger_id=p_charge ORDER BY g.granted_at,g.id FOR UPDATE OF l LOOP
  EXIT WHEN leftover<=0;n:=LEAST(r.only_remaining,leftover);
  IF n>0 THEN
   UPDATE public.ca_promo_profit_event_lots SET remaining=remaining-n WHERE grant_id=r.grant_id AND charge_ledger_id=p_charge;
   PERFORM public.fn_ca_promo_profit_move_grant(r.grant_id,r.club_id,r.user_id,'event',r.tournament_id,NULL,NULL,n);
   spent:=jsonb_set(spent,ARRAY[r.grant_id::text],to_jsonb(COALESCE((spent->>r.grant_id::text)::numeric,0)+n));
   total:=total+n;leftover:=leftover-n;
  END IF;
 END LOOP;
 IF leftover<>0 THEN RAISE EXCEPTION 'original_winnings_only_fee_not_conserved';END IF;
 INSERT INTO public.ca_promo_profit_entry_fee_spends VALUES(p_charge,paid.entitlement_id,paid.gross_fee,total,total_overlap);
 INSERT INTO public.ca_promo_profit_entry_fee_slices SELECT p_charge,key::uuid,value::numeric FROM jsonb_each_text(spent);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_consume_entry_fee(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_profit_finish_entry_fee(p_charge uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record;
BEGIN
 IF NOT public.fn_ca_promo_profit_consume_entry_fee(p_charge) THEN RETURN;END IF;
 FOR r IN SELECT DISTINCT g.club_id,g.user_id FROM public.ca_promo_play_through_grants g WHERE g.id IN(SELECT grant_id FROM public.ca_promo_profit_event_lots WHERE charge_ledger_id=p_charge UNION SELECT grant_id FROM public.ca_promo_event_principal_lots WHERE charge_ledger_id=p_charge)
 UNION SELECT p.club_id,p.player_id FROM public.ca_promo_event_fee_consumption_receipts p WHERE p.charge_ledger_id=p_charge LOOP
  PERFORM public.fn_ca_promo_profit_settle(r.club_id,r.user_id);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_finish_entry_fee(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_restore_entry_costs(p_entitlement uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE e public.tournament_refund_entitlements%ROWTYPE;paid public.ca_promo_event_fee_consumption_receipts%ROWTYPE;r record;o record;n numeric;total numeric:=0;
BEGIN
 SELECT * INTO STRICT e FROM public.tournament_refund_entitlements WHERE id=p_entitlement FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_entry_fee_spends WHERE charge_ledger_id=e.source_ledger_id)
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_entry_loss_slices WHERE charge_ledger_id=e.source_ledger_id) THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_profit_entry_fee_refunds WHERE entitlement_id=e.id) THEN RETURN;END IF;
 SELECT * INTO STRICT paid FROM public.ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id=e.source_ledger_id;
 IF e.id<>paid.entitlement_id OR e.gross<>paid.charge_amount OR e.user_id<>paid.player_id THEN RAISE EXCEPTION 'original_winnings_exact_refund_recipient_mismatch';END IF;
 FOR r IN SELECT x.grant_id,sum(x.amount) amount,l.club_id,l.user_id,l.tournament_id FROM(
 SELECT grant_id,amount FROM public.ca_promo_profit_entry_fee_slices WHERE charge_ledger_id=e.source_ledger_id
 UNION ALL SELECT grant_id,amount FROM public.ca_promo_profit_entry_loss_slices WHERE charge_ledger_id=e.source_ledger_id)x JOIN public.ca_promo_profit_event_lots l ON l.grant_id=x.grant_id AND l.charge_ledger_id=e.source_ledger_id
 GROUP BY x.grant_id,l.club_id,l.user_id,l.tournament_id ORDER BY x.grant_id LOOP
  IF ROW(r.club_id,r.user_id,r.tournament_id) IS DISTINCT FROM ROW(paid.club_id,paid.player_id,e.tournament_id) THEN RAISE EXCEPTION 'original_winnings_refund_source_conflict';END IF;
  n:=public.fn_ca_promo_profit_credit_owned('stake_refund',e.id,r.grant_id,r.club_id,r.user_id,'event',r.tournament_id,r.amount);
  IF n>0 THEN
   UPDATE public.ca_promo_profit_event_lots SET remaining=remaining+n WHERE grant_id=r.grant_id AND charge_ledger_id=e.source_ledger_id;
   -- Reattach only exact original W/H cost intersections still under review.
   -- An H review release and an earned W release remain independent final acts.
   FOR o IN SELECT x.case_id,sum(x.amount) amount FROM(
    SELECT case_id,amount FROM public.ca_promo_profit_entry_fee_overlap_slices WHERE charge_ledger_id=e.source_ledger_id AND grant_id=r.grant_id
    UNION ALL SELECT case_id,amount FROM public.ca_promo_profit_entry_loss_overlap_slices WHERE charge_ledger_id=e.source_ledger_id AND grant_id=r.grant_id)x
    WHERE NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id) GROUP BY x.case_id ORDER BY x.case_id LOOP
    UPDATE public.ca_promo_profit_event_overlap_lots SET remaining=remaining+o.amount WHERE charge_ledger_id=e.source_ledger_id AND grant_id=r.grant_id AND case_id=o.case_id;
    INSERT INTO public.ca_promo_profit_integrity_overlap VALUES(r.grant_id,o.case_id,r.club_id,r.user_id,'event',r.tournament_id,o.amount)
     ON CONFLICT(grant_id,case_id,club_id,user_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_profit_integrity_overlap.amount+EXCLUDED.amount;
   END LOOP;
  END IF;
  total:=total+r.amount;
 END LOOP;
 IF total>e.gross THEN RAISE EXCEPTION 'original_winnings_refund_exceeds_actual_credit';END IF;
 INSERT INTO public.ca_promo_profit_entry_fee_refunds VALUES(e.id,e.source_ledger_id,total);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_restore_entry_costs(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_retire_busted_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record;o record;
BEGIN
 FOR r IN SELECT l.* FROM public.ca_promo_profit_event_lots l JOIN public.ca_promo_play_through_grants g ON g.id=l.grant_id
 WHERE l.charge_ledger_id=ANY(NEW.charge_ledger_ids) AND l.tournament_id=NEW.tournament_id AND l.user_id=NEW.user_id AND l.remaining>0 ORDER BY g.granted_at,g.id,l.charge_ledger_id FOR UPDATE OF l LOOP
  FOR o IN SELECT * FROM public.ca_promo_profit_event_overlap_lots WHERE charge_ledger_id=r.charge_ledger_id AND grant_id=r.grant_id AND remaining>0 ORDER BY case_id FOR UPDATE LOOP
   UPDATE public.ca_promo_profit_integrity_overlap SET amount=amount-o.remaining WHERE grant_id=r.grant_id AND case_id=o.case_id AND club_id=r.club_id AND user_id=r.user_id AND kind='event' AND entity_id=r.tournament_id AND amount>=o.remaining;
   IF NOT FOUND THEN RAISE EXCEPTION 'original_busted_winnings_overlap_missing';END IF;
   INSERT INTO public.ca_promo_profit_entry_loss_overlap_slices VALUES(NEW.candidate_id,r.charge_ledger_id,r.grant_id,o.case_id,o.remaining);
   UPDATE public.ca_promo_profit_event_overlap_lots SET remaining=0 WHERE charge_ledger_id=r.charge_ledger_id AND grant_id=r.grant_id AND case_id=o.case_id;
  END LOOP;
  INSERT INTO public.ca_promo_profit_entry_loss_slices VALUES(NEW.candidate_id,r.charge_ledger_id,r.grant_id,r.remaining);
  UPDATE public.ca_promo_profit_event_lots SET remaining=0 WHERE grant_id=r.grant_id AND charge_ledger_id=r.charge_ledger_id;
  PERFORM public.fn_ca_promo_profit_move_grant(r.grant_id,r.club_id,r.user_id,'event',r.tournament_id,NULL,NULL,r.remaining);
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_retire_busted_entry() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzzz_profit_original_entry_loss AFTER INSERT ON public.ca_promo_event_entry_loss_receipts FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_retire_busted_entry();

DO $original_entry_expense_rendezvous$ DECLARE def text;sig text;needle text;BEGIN
 FOREACH sig IN ARRAY ARRAY['public.fn_ca_promo_record_event_charge(uuid)','public.fn_ca_promo_entry_fee_entitlement()','public.fn_ca_promo_integrity_record_event(uuid)'] LOOP
  SELECT pg_get_functiondef(sig::regprocedure) INTO def;
  IF sig='public.fn_ca_promo_integrity_record_event(uuid)' THEN
   needle:='PERFORM public.fn_ca_promo_integrity_consume_entry_fee(l.id);';
  ELSIF sig='public.fn_ca_promo_entry_fee_entitlement()' THEN
   needle:='IF to_regprocedure(''public.fn_ca_promo_integrity_consume_entry_fee(uuid)'') IS NOT NULL THEN PERFORM public.fn_ca_promo_integrity_consume_entry_fee(NEW.source_ledger_id); END IF;';
  ELSE
   needle:='IF to_regprocedure(''public.fn_ca_promo_integrity_consume_entry_fee(uuid)'') IS NOT NULL THEN PERFORM public.fn_ca_promo_integrity_consume_entry_fee(l.id); END IF;';
  END IF;
  IF position(needle in def)=0 THEN RAISE EXCEPTION 'original_winnings_entry_rendezvous_changed: %',sig;END IF;
  EXECUTE replace(def,needle,needle||E'\n '||CASE WHEN sig='public.fn_ca_promo_entry_fee_entitlement()' THEN 'PERFORM public.fn_ca_promo_profit_finish_entry_fee(NEW.source_ledger_id);' ELSE 'PERFORM public.fn_ca_promo_profit_finish_entry_fee(l.id);' END);
 END LOOP;
 SELECT pg_get_functiondef('public.fn_ca_promo_integrity_restore_event_fees(uuid)'::regprocedure) INTO def;
 needle:='SELECT * INTO STRICT e FROM public.tournament_refund_entitlements WHERE id=p_entitlement FOR UPDATE;';
 IF position(needle in def)=0 THEN RAISE EXCEPTION 'original_winnings_refund_owner_anchor_changed';END IF;
 def:=replace(def,needle,needle||E'\n PERFORM public.fn_ca_promo_profit_restore_entry_costs(p_entitlement);');
 needle:='r.club_id IS DISTINCT FROM e.refund_wallet_club_id';
 IF position(needle in def)=0 THEN RAISE EXCEPTION 'original_integrity_refund_scope_anchor_changed';END IF;
 -- Source earning club and physical refund wallet can differ. Validate the
 -- original charge's frozen source owner; the credit owner routes its wallet.
 def:=replace(def,needle,'r.club_id IS DISTINCT FROM (SELECT p.club_id FROM public.ca_promo_event_fee_consumption_receipts p WHERE p.charge_ledger_id=e.source_ledger_id)');
 EXECUTE def;
END $original_entry_expense_rendezvous$;

-- The original entitlement owner returns the FULL fee value into this real
-- reusable ticket. Its immutable original ledger is the in-kind refund witness.
CREATE TABLE public.ca_promo_profit_ticket_fee_returns (
 entitlement_id uuid PRIMARY KEY,ledger_id uuid NOT NULL UNIQUE,charge_ledger_id uuid NOT NULL,fee numeric NOT NULL CHECK(fee>=0 AND fee=round(fee,2))
);
ALTER TABLE public.ca_promo_profit_ticket_fee_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_profit_ticket_fee_returns FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_profit_ticket_fee_returns TO service_role;
CREATE TRIGGER original_ticket_fee_return_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_profit_ticket_fee_returns FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER original_ticket_fee_return_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_ticket_fee_returns FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
-- Preserve the original earning clock and original cash-refund attribution.
-- MAX deduplicates a later canonical fee reversal of the same original charge.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_original_entry_fee_events(p_club uuid,p_user uuid,p_from timestamptz,p_to timestamptz)
RETURNS TABLE(earned_at timestamptz,fee_credit numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
 SELECT fee.earned_at,greatest(0,fee.gross_fee-GREATEST(COALESCE((SELECT sum(tr.refund_fee) FROM public.tournament_refund_tranches tr
  WHERE tr.entitlement_id=e.id AND tr.tournament_id=e.tournament_id AND tr.user_id=e.user_id AND tr.source_wallet_club_id=e.refund_wallet_club_id),0),
  COALESCE((SELECT r.fee FROM public.ca_promo_profit_ticket_fee_returns r WHERE r.entitlement_id=e.id AND r.charge_ledger_id=fee.charge_ledger_id),0)))
 FROM public.ca_promo_event_fee_consumption_receipts fee JOIN public.tournament_refund_entitlements e
  ON e.id=fee.entitlement_id AND e.source_ledger_id=fee.charge_ledger_id
 WHERE fee.club_id=p_club AND fee.player_id=p_user AND e.user_id=fee.player_id AND fee.earned_at>=p_from AND fee.earned_at<p_to;
$$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_original_entry_fee_events(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_profit_restore_returned_ticket_costs(p_ledger uuid,p_entitlement uuid,p_ticket uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;e public.tournament_refund_entitlements%ROWTYPE;paid public.ca_promo_event_fee_consumption_receipts%ROWTYPE;r record;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 SELECT * INTO STRICT e FROM public.tournament_refund_entitlements WHERE id=p_entitlement FOR UPDATE;
 IF l.metadata->>'kind'<>'tournament_entry_ticket_return' OR l.metadata->>'entitlement_id'<>e.id::text OR l.metadata->>'ticket_id'<>p_ticket::text OR l.from_type<>'prize_liability' OR l.from_entity_id<>e.tournament_id OR l.to_type<>'escrow' OR l.to_entity_id<>p_ticket OR l.amount<>e.gross THEN RAISE EXCEPTION 'original_ticket_fee_return_identity_invalid';END IF;
 SELECT * INTO paid FROM public.ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id=e.source_ledger_id AND entitlement_id=e.id;
 IF NOT FOUND THEN RETURN;END IF;
 IF paid.gross_fee<>e.refund_fee OR paid.charge_amount<>e.gross OR paid.player_id<>e.user_id THEN RAISE EXCEPTION 'original_ticket_fee_return_charge_mismatch';END IF;
 INSERT INTO public.ca_promo_profit_ticket_fee_returns VALUES(e.id,l.id,e.source_ledger_id,e.refund_fee) ON CONFLICT(entitlement_id) DO NOTHING;
 IF NOT FOUND THEN
  IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_ticket_fee_returns WHERE entitlement_id=e.id AND ledger_id=l.id AND charge_ledger_id=e.source_ledger_id AND fee=e.refund_fee) THEN RAISE EXCEPTION 'original_ticket_fee_return_reused';END IF;RETURN;
 END IF;
 -- W is the player's own stake. Exact fee/loss restoration never creates a
 -- new gift, and an already earned release or case review stays final.
 PERFORM public.fn_ca_promo_integrity_restore_event_fees(e.id);
 -- Spent P fee remains the original fund's property even after grant
 -- closure. Its noncash original-fund custody owner must exist before this
 -- particular return can commit; it must never become player-owned W.
 IF EXISTS(SELECT 1 FROM public.ca_promo_event_fee_consumption_slices f WHERE f.charge_ledger_id=e.source_ledger_id) OR EXISTS(SELECT 1 FROM public.ca_promo_event_principal_lots f WHERE f.charge_ledger_id=e.source_ledger_id) OR EXISTS(SELECT 1 FROM public.ca_promo_event_entry_loss_slices f WHERE f.charge_ledger_id=e.source_ledger_id) THEN
  IF to_regprocedure('public.fn_ca_promo_returned_ticket_principal_fee(uuid,uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'original_fund_ticket_fee_custody_required';END IF;
  PERFORM public.fn_ca_promo_returned_ticket_principal_fee(l.id,e.id,p_ticket);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_restore_returned_ticket_costs(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;


-- BEGIN ORIGINAL BBJ WINNINGS SOURCE
-- Composed into the original W migration after credit_owned is defined.
-- The accepted hand already freezes the eligibility vector. A parked promise
-- owns no wallet chips and creates no new fee phase until its actual credit.
CREATE INDEX ca_promo_bbj_accepted_hand ON public.ca_promo_cash_hand_clocks(table_id,hand_number);
CREATE FUNCTION public.fn_ca_promo_profit_try_member(p_club uuid,p_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF p_club IS NULL OR p_user IS NULL THEN RAISE EXCEPTION 'original_bbj_member_scope_missing';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('ca_promo_play_through:'||p_club::text||':'||p_user::text,0)) THEN
  RAISE EXCEPTION 'original_bbj_member_scope_busy' USING ERRCODE='55P03';END IF;
 PERFORM 1 FROM public.ca_promo_play_through_grants g WHERE g.club_id=p_club AND g.user_id=p_user
 ORDER BY g.granted_at,g.id FOR UPDATE OF g NOWAIT;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_try_member(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_prepare_bbj(p_payout uuid,p_table uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE enabled timestamptz;b public.bbj_payouts%ROWTYPE;h public.ca_promo_cash_hand_clocks%ROWTYPE;n integer;r record;
BEGIN
 SELECT enforced_from INTO enabled FROM public.ca_promo_play_through_settings WHERE id;
 IF enabled IS NULL OR enabled>clock_timestamp() THEN RETURN NULL;END IF;
 SELECT * INTO b FROM public.bbj_payouts WHERE id=p_payout AND table_id=p_table;
 IF NOT FOUND THEN RAISE EXCEPTION 'original_bbj_payout_identity_missing';END IF;
 IF b.kind IS NULL OR b.kind NOT IN('main','mini') THEN RAISE EXCEPTION 'original_bbj_payout_kind_unknown';END IF;
 IF b.created_at<enabled THEN RETURN NULL;END IF;
 SELECT count(*) INTO n FROM public.ca_promo_cash_hand_clocks WHERE table_id=p_table AND hand_number=b.hand_number;
 IF n<>1 THEN RAISE EXCEPTION 'original_bbj_accepted_hand_unknown';END IF;
 SELECT * INTO STRICT h FROM public.ca_promo_cash_hand_clocks WHERE table_id=p_table AND hand_number=b.hand_number;
 IF b.hand_id IS NOT NULL AND b.hand_id<>h.hand_id THEN RAISE EXCEPTION 'original_bbj_accepted_hand_mismatch';END IF;
 IF h.accepted_at<enabled THEN RETURN NULL;END IF;
 IF h.profit_capture_version IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'original_bbj_winnings_source_incomplete';END IF;
 -- credit_owned settles every grant in each original earning scope. Acquire
 -- that full bounded member scope before any recipient seat/wallet effect.
 -- NOWAIT preserves the original payout's explicit refusal/recovery path if
 -- an original funding owner already holds its wallet in the opposite order.
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_cash_investment i WHERE i.hand_id=h.hand_id) THEN RETURN NULL;END IF;
 FOR r IN SELECT DISTINCT source.club_id,source.user_id FROM public.ca_promo_profit_cash_investment i
 JOIN public.ca_promo_play_through_grants source ON source.id=i.grant_id WHERE i.hand_id=h.hand_id
 ORDER BY source.club_id,source.user_id LOOP
  PERFORM public.fn_ca_promo_profit_try_member(r.club_id,r.user_id);
 END LOOP;
 RETURN h.hand_id;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_prepare_bbj(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_realize_bbj(p_payout uuid,p_table uuid,p_user uuid,p_amount numeric,p_club uuid,p_on_felt boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE hand uuid;r record;total numeric;risk numeric;denominator numeric;
BEGIN
 hand:=public.fn_ca_promo_profit_prepare_bbj(p_payout,p_table);
 IF hand IS NULL THEN RETURN;END IF;
 IF p_club IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2)
 OR p_amount::text IN('NaN','Infinity','-Infinity') OR NOT EXISTS(
  SELECT 1 FROM public.bbj_payout_recipients p WHERE p.payout_id=p_payout AND p.user_id=p_user AND p.amount=p_amount)
 THEN RAISE EXCEPTION 'original_bbj_paid_recipient_mismatch';END IF;
 SELECT sum(i.eligible_contribution),min(i.total_contribution) INTO risk,denominator
 FROM public.ca_promo_profit_cash_investment i WHERE i.hand_id=hand AND i.user_id=p_user;
 -- A complete capture with no own positive risk is an exact zero, including
 -- a zero-contribution table-share recipient. Never substitute today's stack.
 IF risk IS NULL THEN RETURN;END IF;
 IF denominator<=0 OR risk>denominator OR EXISTS(SELECT 1 FROM public.ca_promo_profit_cash_investment i
  WHERE i.hand_id=hand AND i.user_id=p_user AND i.total_contribution<>denominator)
 THEN RAISE EXCEPTION 'original_bbj_investment_not_conserved';END IF;
 total:=round(p_amount*risk/denominator,2);
 -- Floor each share, then assign remaining cents by fractional remainder,
 -- with original gift order as the deterministic tie breaker.
 FOR r IN WITH raw AS(
  SELECT i.grant_id,g.granted_at,p_amount*i.eligible_contribution/denominator exact
  FROM public.ca_promo_profit_cash_investment i JOIN public.ca_promo_play_through_grants g ON g.id=i.grant_id
  WHERE i.hand_id=hand AND i.user_id=p_user
 ), ranked AS(
  SELECT *,floor(exact*100)/100 base,row_number() OVER(ORDER BY exact*100-floor(exact*100) DESC,granted_at,grant_id) rank,
   sum(floor(exact*100)/100) OVER() base_total FROM raw
 ) SELECT grant_id,base+CASE WHEN rank<=round((total-base_total)*100)::integer THEN .01 ELSE 0 END amount
 FROM ranked ORDER BY granted_at,grant_id LOOP
  IF r.amount>0 THEN PERFORM public.fn_ca_promo_profit_credit_owned('bbj',p_payout,r.grant_id,p_club,p_user,
   CASE WHEN p_on_felt THEN 'table_stack' ELSE 'player_wallet' END,CASE WHEN p_on_felt THEN p_table ELSE p_user END,r.amount);END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_realize_bbj(uuid,uuid,uuid,numeric,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

DO $original_bbj_recipient$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.bbj_credit_one_recipient(uuid,uuid,uuid,numeric,boolean)'::regprocedure) INTO def;
 IF md5(def)<>'4afe3d7cc43fa9cab5a47de1f6a3c6bf' THEN RAISE EXCEPTION 'original_bbj_recipient_changed';END IF;
 IF position('  v_on_felt boolean := false;' in def)=0 THEN RAISE EXCEPTION 'original_bbj_local_anchor_missing';END IF;
 def:=replace(def,'  v_on_felt boolean := false;','  v_on_felt boolean := false; v_profit_hand uuid;');
 needle:='  -- All recipient transitions serialize on the same pool lock as allocation.';
 IF position(needle in def)=0 THEN RAISE EXCEPTION 'original_bbj_precredit_anchor_missing';END IF;
 def:=replace(def,needle,'  v_profit_hand:=public.fn_ca_promo_profit_prepare_bbj(p_payout_id,p_table_id);'||E'\n'||needle);
 -- Lock the exact UPDATE row set without waiting. The old branch is byte
 -- identical when no restricted original hand source exists.
 needle:=$seat_update$    UPDATE table_seats
       SET stack = COALESCE(stack, 0) + p_amount
     WHERE table_id = p_table_id AND user_id = p_user_id AND left_at IS NULL RETURNING club_id INTO v_club;$seat_update$;
 IF position(needle in def)=0 THEN RAISE EXCEPTION 'original_bbj_seat_credit_anchor_missing';END IF;
 def:=replace(def,needle,'    IF v_profit_hand IS NULL THEN'||E'\n'||needle||E'\n'||$seat_locked$    ELSE
      WITH locked AS MATERIALIZED (
       SELECT s.ctid FROM public.table_seats s
       WHERE s.table_id=p_table_id AND s.user_id=p_user_id AND s.left_at IS NULL
        AND public.fn_ca_promo_profit_try_member(COALESCE(s.club_id,
         (SELECT x.funding_club_id FROM public.cash_participant_funding_receipts x
          WHERE x.operation_kind='buyin' AND x.table_id=p_table_id AND x.account_entity_id=p_user_id
           AND x.seat_joined_at<=now() ORDER BY x.seat_joined_at DESC,x.recorded_at DESC,x.id DESC LIMIT 1)),p_user_id)
       FOR UPDATE OF s NOWAIT
      ) UPDATE public.table_seats s SET stack=COALESCE(s.stack,0)+p_amount
       FROM locked l WHERE s.ctid=l.ctid RETURNING s.club_id INTO v_club;
    END IF;$seat_locked$);
 needle:=$wallet_update$  UPDATE public.club_members
     SET chip_balance = COALESCE(chip_balance, 0) + p_amount, updated_at = now()
   WHERE user_id = p_user_id AND club_id = v_club
   RETURNING chip_balance INTO v_after;$wallet_update$;
 IF position(needle in def)=0 THEN RAISE EXCEPTION 'original_bbj_wallet_credit_anchor_missing';END IF;
 def:=replace(def,needle,'  IF v_profit_hand IS NULL THEN'||E'\n'||needle||E'\n'||$wallet_locked$  ELSE
    WITH locked AS MATERIALIZED (
     SELECT cm.ctid FROM public.club_members cm WHERE cm.user_id=p_user_id AND cm.club_id=v_club
      AND public.fn_ca_promo_profit_try_member(v_club,p_user_id) FOR UPDATE OF cm NOWAIT
    ) UPDATE public.club_members cm SET chip_balance=COALESCE(cm.chip_balance,0)+p_amount,updated_at=now()
     FROM locked l WHERE cm.ctid=l.ctid RETURNING cm.chip_balance INTO v_after;
  END IF;$wallet_locked$);
 needle:='  INSERT INTO public.bbj_recipient_reporting_owners(payout_id,user_id,club_id,game_variant,source)';
 IF position(needle in def)=0 THEN RAISE EXCEPTION 'original_bbj_paid_anchor_missing';END IF;
 EXECUTE replace(def,needle,'  PERFORM public.fn_ca_promo_profit_realize_bbj(p_payout_id,p_table_id,p_user_id,p_amount,v_club,v_on_felt);'||E'\n'||needle);
END $original_bbj_recipient$;

-- END ORIGINAL BBJ WINNINGS SOURCE

-- The original cash receipt already owns money and the exact seat generation.
-- This helper only pins its proven first empty-seat funding club; chip amounts,
-- seat occupancy and the original financial journal are unchanged.
INSERT INTO public.ca_money_rpc_registry(proname,status,notes)
VALUES('fn_ca_promo_profit_snapshot_funding','approved','Original cash funding receipt validates the exact occupancy and first empty-seat buyin before pinning its funding club; no stack or wallet amount changes and the original owner retains every financial journal leg.') ON CONFLICT(proname) DO NOTHING;
-- BEGIN ORIGINAL WINNINGS MOVEMENT SOURCE
-- Composition block for 190221 only. No independent installation or money writer.
-- Original immutable P receipts own these callbacks; H moves WH before W-only.
CREATE TABLE public.ca_promo_profit_funding_sources (
 ledger_id uuid PRIMARY KEY REFERENCES public.ca_promo_funding_custody_receipts(ledger_id),
 source_club_id uuid NOT NULL,user_id uuid NOT NULL,source_kind text NOT NULL,source_entity_id uuid NOT NULL,
 destination_kind text NOT NULL,destination_id uuid NOT NULL,destination_club_id uuid NOT NULL,
 source_balance_before numeric NOT NULL,amount numeric NOT NULL,covered_amount numeric NOT NULL,
 principal_before numeric NOT NULL,profit_before numeric NOT NULL,integrity_before numeric NOT NULL,overlap_before numeric NOT NULL,
 source_lots jsonb NOT NULL CHECK(jsonb_typeof(source_lots)='array')
);
CREATE TABLE public.ca_promo_profit_funding_lots (
 ledger_id uuid NOT NULL REFERENCES public.ca_promo_profit_funding_sources(ledger_id),grant_id uuid NOT NULL REFERENCES public.ca_promo_profit_gates(grant_id),
 profit_before numeric NOT NULL,overlap_before numeric NOT NULL,profit_moved numeric NOT NULL,overlap_moved numeric NOT NULL,
 PRIMARY KEY(ledger_id,grant_id),CHECK(profit_before>=overlap_before AND overlap_before>=overlap_moved AND overlap_moved>=0 AND profit_before>=profit_moved AND profit_moved>=overlap_moved)
);
CREATE TABLE public.ca_promo_profit_pending_sources (
 pending_addon_id uuid PRIMARY KEY REFERENCES public.ca_promo_pending_custody_receipts(pending_addon_id),funding_receipt_id uuid NOT NULL,
 source_club_id uuid NOT NULL,user_id uuid NOT NULL,amount numeric NOT NULL,applied numeric NOT NULL,refunded numeric NOT NULL,
 applied_occupancy_id uuid,destination_id uuid,principal_before numeric NOT NULL,profit_before numeric NOT NULL,integrity_before numeric NOT NULL,overlap_before numeric NOT NULL,
 source_lots jsonb NOT NULL CHECK(jsonb_typeof(source_lots)='array'),CHECK(applied+refunded=amount)
);
CREATE TABLE public.ca_promo_profit_pending_lots (
 pending_addon_id uuid NOT NULL REFERENCES public.ca_promo_profit_pending_sources(pending_addon_id),grant_id uuid NOT NULL REFERENCES public.ca_promo_profit_gates(grant_id),
 profit_before numeric NOT NULL,overlap_before numeric NOT NULL,profit_applied numeric NOT NULL,profit_refunded numeric NOT NULL,overlap_applied numeric NOT NULL,overlap_refunded numeric NOT NULL,
 PRIMARY KEY(pending_addon_id,grant_id),CHECK(profit_applied+profit_refunded=profit_before AND overlap_applied+overlap_refunded=overlap_before AND profit_applied>=overlap_applied AND profit_refunded>=overlap_refunded AND overlap_applied>=0 AND overlap_refunded>=0)
);
CREATE FUNCTION public.fn_ca_promo_profit_movement_is_final() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN RAISE EXCEPTION 'original_winnings_movement_receipt_is_immutable';END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_movement_is_final() FROM PUBLIC,anon,authenticated,service_role;
DO $receipt_acl$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['ca_promo_profit_funding_sources','ca_promo_profit_funding_lots','ca_promo_profit_pending_sources','ca_promo_profit_pending_lots'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',n);
  EXECUTE format('GRANT SELECT ON public.%I TO service_role',n);
  EXECUTE format('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_movement_is_final()',n);
  EXECUTE format('CREATE TRIGGER immutable_table BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_profit_movement_is_final()',n);
 END LOOP;
END $receipt_acl$;

-- The original P owner takes this exact advisory before grant rows. Acquire
-- every relevant scope nonblocking first; grant NOWAIT never reverses that order.
CREATE FUNCTION public.fn_ca_promo_profit_prelock_source(p_club uuid,p_user uuid,p_kind text,p_entity uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE scopes jsonb;r record;
BEGIN
 SELECT jsonb_agg(jsonb_build_object('club_id',s.club_id,'user_id',s.user_id) ORDER BY s.club_id,s.user_id) INTO scopes
 FROM(SELECT p_club club_id,p_user user_id UNION
  SELECT g.club_id,g.user_id FROM public.ca_promo_profit_custody c
  JOIN public.ca_promo_profit_gates w ON w.grant_id=c.grant_id AND w.unlocked_at IS NULL
  JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
  WHERE c.user_id=p_user AND c.kind=p_kind AND c.entity_id=p_entity AND c.amount>0
   AND (c.club_id=p_club OR p_kind='table_stack')
   AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides z WHERE z.grant_id=c.grant_id))s;
 FOR r IN SELECT * FROM jsonb_to_recordset(scopes)x(club_id uuid,user_id uuid) ORDER BY club_id,user_id LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca_promo_play_through:'||r.club_id::text||':'||r.user_id::text,0)) THEN
   RAISE EXCEPTION 'original_promo_scope_busy' USING ERRCODE='55P03';END IF;
 END LOOP;
 PERFORM 1 FROM public.ca_promo_play_through_grants g WHERE EXISTS(
  SELECT 1 FROM jsonb_to_recordset(scopes)x(club_id uuid,user_id uuid) WHERE g.club_id=x.club_id AND g.user_id=x.user_id)
 ORDER BY g.granted_at,g.id FOR UPDATE OF g NOWAIT;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_prelock_source(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Called after grant prelock and BEFORE the H original receipt callback moves
-- anything. Case locks serialize review releases with this one source snapshot.
CREATE FUNCTION public.fn_ca_promo_profit_snapshot_position(p_club uuid,p_user uuid,p_kind text,p_entity uuid,p_table uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM 1 FROM public.ca_promo_integrity_cases k WHERE k.id IN(
  SELECT c.case_id FROM public.ca_promo_integrity_custody c WHERE c.club_id=p_club AND c.user_id=p_user AND c.kind=p_kind AND c.entity_id=p_entity AND c.amount>0)
 ORDER BY k.id FOR UPDATE OF k NOWAIT;
 WITH w AS MATERIALIZED(
  SELECT c.* FROM public.ca_promo_profit_custody c JOIN public.ca_promo_profit_gates g ON g.grant_id=c.grant_id AND g.unlocked_at IS NULL
  WHERE c.club_id=p_club AND c.user_id=p_user AND c.kind=p_kind AND c.entity_id=p_entity AND c.amount>0
  AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides z WHERE z.grant_id=c.grant_id)
 ), lots AS(
  SELECT w.grant_id,w.amount profit_before,COALESCE(o.amount,0) overlap_before,COALESCE(o.cases,'[]') cases FROM w LEFT JOIN LATERAL(
   SELECT sum(o.amount) amount,jsonb_agg(jsonb_build_object('case_id',o.case_id,'amount',o.amount,
    'applied_before',COALESCE((SELECT amount FROM public.ca_promo_profit_integrity_overlap d WHERE d.grant_id=w.grant_id AND d.case_id=o.case_id AND d.club_id=p_club AND d.user_id=p_user AND d.kind='table_stack' AND d.entity_id=p_table),0),
    'refund_before',COALESCE((SELECT amount FROM public.ca_promo_profit_integrity_overlap d WHERE d.grant_id=w.grant_id AND d.case_id=o.case_id AND d.club_id=p_club AND d.user_id=p_user AND d.kind='player_wallet' AND d.entity_id=p_user),0)) ORDER BY o.case_id) cases
   FROM public.ca_promo_profit_integrity_overlap o WHERE o.grant_id=w.grant_id AND o.club_id=p_club AND o.user_id=p_user AND o.kind=p_kind AND o.entity_id=p_entity AND o.amount>0
    AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases x WHERE x.case_id=o.case_id)
  )o ON true)
 SELECT jsonb_build_object('profit_before',COALESCE(sum(l.profit_before),0),'overlap_before',COALESCE(sum(l.overlap_before),0),
 'integrity_before',public.fn_ca_promo_integrity_locked_at(p_club,p_user,p_kind,p_entity),'source_lots',COALESCE(jsonb_agg(to_jsonb(l)),'[]')) INTO result FROM lots l;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_snapshot_position(uuid,uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_snapshot_funding(p_ledger uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;f public.ca_promo_funding_custody_receipts%ROWTYPE;s jsonb;
 c public.cash_participant_funding_receipts%ROWTYPE;seat public.table_seats%ROWTYPE;restricted numeric;clean numeric;
BEGIN
 SELECT * INTO STRICT f FROM public.ca_promo_funding_custody_receipts WHERE ledger_id=p_ledger;
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 s:=public.fn_ca_promo_profit_snapshot_position(l.club_id,l.from_entity_id,l.from_type,l.from_entity_id);
 restricted:=f.principal_before+(s->>'profit_before')::numeric+(s->>'integrity_before')::numeric-(s->>'overlap_before')::numeric;
 IF restricted>f.source_balance_before OR (s->>'overlap_before')::numeric>LEAST((s->>'profit_before')::numeric,(s->>'integrity_before')::numeric) THEN RAISE EXCEPTION 'original_restricted_union_exceeds_balance';END IF;
 clean:=f.source_balance_before-restricted;
 IF f.destination_kind IN('table_stack','pending_addon') AND f.amount>clean THEN
  SELECT * INTO STRICT c FROM public.cash_participant_funding_receipts WHERE source_ledger_id=l.id;
  SELECT * INTO STRICT seat FROM public.table_seats WHERE id=c.seat_id AND occupancy_id=c.occupancy_id AND user_id=c.user_id FOR UPDATE;
  IF seat.club_id IS NULL THEN
   IF f.destination_kind<>'table_stack' OR c.operation_kind<>'buyin' OR seat.stack IS DISTINCT FROM c.amount OR EXISTS(
    SELECT 1 FROM public.cash_participant_funding_receipts old WHERE old.occupancy_id=c.occupancy_id AND old.id<>c.id) THEN
    RAISE EXCEPTION 'restricted_cash_funding_requires_original_seat_club';END IF;
   UPDATE public.table_seats SET club_id=c.funding_club_id WHERE id=seat.id;
  ELSIF seat.club_id IS DISTINCT FROM c.funding_club_id THEN RAISE EXCEPTION 'restricted_cash_funding_club_conflict';END IF;
 END IF;
 INSERT INTO public.ca_promo_profit_funding_sources VALUES(l.id,l.club_id,l.from_entity_id,l.from_type,l.from_entity_id,f.destination_kind,f.destination_id,l.club_id,
 f.source_balance_before,f.amount,f.covered_amount,f.principal_before,(s->>'profit_before')::numeric,(s->>'integrity_before')::numeric,(s->>'overlap_before')::numeric,s->'source_lots');
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_snapshot_funding(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_on_funding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE h public.ca_promo_profit_funding_sources%ROWTYPE;r record;current_w numeric;current_o numeric;oh numeric;n numeric;leftover numeric;own_same boolean;
BEGIN
 SELECT * INTO STRICT h FROM public.ca_promo_profit_funding_sources WHERE ledger_id=NEW.ledger_id;
 own_same:=h.source_kind=h.destination_kind AND h.source_entity_id=h.destination_id AND h.source_club_id=h.destination_club_id;
 leftover:=CASE WHEN own_same THEN 0 ELSE LEAST(h.profit_before-h.overlap_before,GREATEST(h.amount-(h.source_balance_before-h.principal_before-h.profit_before-h.integrity_before+h.overlap_before),0)) END;
 FOR r IN SELECT x.* FROM jsonb_to_recordset(h.source_lots)x(grant_id uuid,profit_before numeric,overlap_before numeric,cases jsonb)
 JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id ORDER BY g.granted_at,g.id LOOP
  SELECT COALESCE(sum(o.amount),0) INTO current_o FROM public.ca_promo_profit_integrity_overlap o
   WHERE o.grant_id=r.grant_id AND o.club_id=h.source_club_id AND o.user_id=h.user_id AND o.kind=h.source_kind AND o.entity_id=h.source_entity_id
   AND o.case_id IN(SELECT (x->>'case_id')::uuid FROM jsonb_array_elements(r.cases)x);
  oh:=r.overlap_before-current_o;
  SELECT COALESCE(sum(c.amount),0) INTO current_w FROM public.ca_promo_profit_custody c WHERE c.grant_id=r.grant_id AND c.club_id=h.source_club_id AND c.user_id=h.user_id AND c.kind=h.source_kind AND c.entity_id=h.source_entity_id;
  IF oh<0 OR oh>r.overlap_before OR r.profit_before-current_w<>oh THEN RAISE EXCEPTION 'original_winnings_H_movement_incomplete';END IF;
  n:=LEAST(r.profit_before-r.overlap_before,leftover);
  PERFORM public.fn_ca_promo_profit_move_grant(r.grant_id,h.source_club_id,h.user_id,h.source_kind,h.source_entity_id,h.destination_kind,h.destination_id,n,h.destination_club_id,h.user_id);
  INSERT INTO public.ca_promo_profit_funding_lots VALUES(h.ledger_id,r.grant_id,r.profit_before,r.overlap_before,n+oh,oh);
  leftover:=leftover-n;
 END LOOP;
 IF leftover<>0 THEN RAISE EXCEPTION 'original_winnings_funding_lots_incomplete';END IF;
 IF h.destination_kind='event' THEN PERFORM public.fn_ca_promo_profit_record_event(h.ledger_id);END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_on_funding() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzz_profit_original_funding AFTER INSERT ON public.ca_promo_funding_custody_receipts FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_on_funding();

CREATE FUNCTION public.fn_ca_promo_profit_snapshot_pending(p_pending uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE a public.cash_funding_application_receipts%ROWTYPE;f public.cash_participant_funding_receipts%ROWTYPE;p public.ca_promo_pending_custody_receipts%ROWTYPE;s jsonb;place uuid;
BEGIN
 SELECT * INTO STRICT p FROM public.ca_promo_pending_custody_receipts WHERE pending_addon_id=p_pending;
 SELECT * INTO STRICT a FROM public.cash_funding_application_receipts WHERE pending_addon_id=p_pending;
 SELECT * INTO STRICT f FROM public.cash_participant_funding_receipts WHERE id=a.funding_receipt_id;
 IF a.applied>0 THEN SELECT table_id INTO STRICT place FROM public.table_seats WHERE occupancy_id=a.applied_occupancy_id AND user_id=f.user_id;END IF;
 s:=public.fn_ca_promo_profit_snapshot_position(f.funding_club_id,f.user_id,'pending_addon',p_pending,place);
 IF p.principal_before+(s->>'profit_before')::numeric+(s->>'integrity_before')::numeric-(s->>'overlap_before')::numeric>f.amount THEN RAISE EXCEPTION 'original_pending_restricted_union_exceeds_balance';END IF;
 INSERT INTO public.ca_promo_profit_pending_sources VALUES(p_pending,f.id,f.funding_club_id,f.user_id,f.amount,a.applied,a.refunded,a.applied_occupancy_id,place,p.principal_before,(s->>'profit_before')::numeric,(s->>'integrity_before')::numeric,(s->>'overlap_before')::numeric,s->'source_lots');
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_snapshot_pending(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_profit_on_pending() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE h public.ca_promo_profit_pending_sources%ROWTYPE;r record;oh_a numeric;oh_r numeric;current_w numeric;n numeric;leftover numeric;
BEGIN
 SELECT * INTO STRICT h FROM public.ca_promo_profit_pending_sources WHERE pending_addon_id=NEW.pending_addon_id;
 leftover:=LEAST(h.profit_before-h.overlap_before,GREATEST(h.applied-(h.amount-h.principal_before-h.profit_before-h.integrity_before+h.overlap_before),0));
 FOR r IN SELECT x.* FROM jsonb_to_recordset(h.source_lots)x(grant_id uuid,profit_before numeric,overlap_before numeric,cases jsonb)
 JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id ORDER BY g.granted_at,g.id LOOP
  SELECT COALESCE(sum(COALESCE((SELECT o.amount FROM public.ca_promo_profit_integrity_overlap o WHERE o.grant_id=r.grant_id AND o.case_id=(x->>'case_id')::uuid AND o.club_id=h.source_club_id AND o.user_id=h.user_id AND o.kind='table_stack' AND o.entity_id=h.destination_id),0)-(x->>'applied_before')::numeric),0),
   COALESCE(sum(COALESCE((SELECT o.amount FROM public.ca_promo_profit_integrity_overlap o WHERE o.grant_id=r.grant_id AND o.case_id=(x->>'case_id')::uuid AND o.club_id=h.source_club_id AND o.user_id=h.user_id AND o.kind='player_wallet' AND o.entity_id=h.user_id),0)-(x->>'refund_before')::numeric),0)
   INTO oh_a,oh_r FROM jsonb_array_elements(r.cases)x;
  SELECT COALESCE(sum(amount),0) INTO current_w FROM public.ca_promo_profit_custody WHERE grant_id=r.grant_id AND club_id=h.source_club_id AND user_id=h.user_id AND kind='pending_addon' AND entity_id=h.pending_addon_id;
  IF oh_a<0 OR oh_r<0 OR oh_a+oh_r<>r.overlap_before OR r.profit_before-current_w<>r.overlap_before THEN RAISE EXCEPTION 'original_pending_WH_split_incomplete';END IF;
  n:=LEAST(r.profit_before-r.overlap_before,leftover);
  IF n>0 THEN PERFORM public.fn_ca_promo_profit_move_grant(r.grant_id,h.source_club_id,h.user_id,'pending_addon',h.pending_addon_id,'table_stack',h.destination_id,n);END IF;
  PERFORM public.fn_ca_promo_profit_move_grant(r.grant_id,h.source_club_id,h.user_id,'pending_addon',h.pending_addon_id,'player_wallet',h.user_id,r.profit_before-r.overlap_before-n);
  INSERT INTO public.ca_promo_profit_pending_lots VALUES(h.pending_addon_id,r.grant_id,r.profit_before,r.overlap_before,n+oh_a,r.profit_before-r.overlap_before-n+oh_r,oh_a,oh_r);
  leftover:=leftover-n;
 END LOOP;
 IF leftover<>0 THEN RAISE EXCEPTION 'original_pending_W_split_incomplete';END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_on_pending() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzz_profit_original_pending AFTER INSERT ON public.ca_promo_pending_custody_receipts FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_on_pending();

-- Same validated full-seat table_cashout only. H moves its exact intersection
-- first; the remaining total W has no separate overlap left at the source.
CREATE FUNCTION public.fn_ca_promo_profit_cashout(p_ledger uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;r record;total numeric;unused numeric;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 IF l.category<>'table_cashout' OR l.from_type<>'table_stack' OR l.to_type<>'player_wallet' OR l.amount<=0 OR COALESCE(l.status,'posted')<>'posted' THEN RAISE EXCEPTION 'original_full_cashout_required';END IF;
 PERFORM public.fn_ca_promo_profit_prelock_source(l.club_id,l.to_entity_id,'table_stack',l.from_entity_id);
 PERFORM 1 FROM public.ca_promo_integrity_cases k WHERE k.id IN(SELECT c.case_id FROM public.ca_promo_integrity_custody c WHERE c.user_id=l.to_entity_id AND c.kind='table_stack' AND c.entity_id=l.from_entity_id AND c.amount>0) ORDER BY k.id FOR UPDATE OF k NOWAIT;
 SELECT COALESCE(sum(n),0) INTO total FROM(
  SELECT public.fn_ca_promo_restricted_at(c.club_id,l.to_entity_id,'table_stack',l.from_entity_id) n
  FROM(SELECT l.club_id club_id UNION SELECT club_id FROM public.ca_promo_profit_custody WHERE user_id=l.to_entity_id AND kind='table_stack' AND entity_id=l.from_entity_id AND amount>0
   UNION SELECT club_id FROM public.ca_promo_integrity_custody WHERE user_id=l.to_entity_id AND kind='table_stack' AND entity_id=l.from_entity_id AND amount>0)c)x;
 IF total>l.amount THEN RAISE EXCEPTION 'original_full_cashout_restricted_union_exceeds_credit';END IF;
 FOR r IN SELECT DISTINCT club_id FROM public.ca_promo_integrity_custody WHERE user_id=l.to_entity_id AND kind='table_stack' AND entity_id=l.from_entity_id AND amount>0 ORDER BY club_id LOOP
  unused:=public.fn_ca_promo_integrity_move(r.club_id,l.to_entity_id,'table_stack',l.from_entity_id,'player_wallet',l.to_entity_id,l.amount,l.club_id,l.to_entity_id);
 END LOOP;
 FOR r IN SELECT c.* FROM public.ca_promo_profit_custody c JOIN public.ca_promo_profit_gates g ON g.grant_id=c.grant_id AND g.unlocked_at IS NULL
 WHERE c.user_id=l.to_entity_id AND c.kind='table_stack' AND c.entity_id=l.from_entity_id AND c.amount>0
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides z WHERE z.grant_id=c.grant_id) ORDER BY c.grant_id,c.club_id LOOP
  PERFORM public.fn_ca_promo_profit_move_grant(r.grant_id,r.club_id,r.user_id,'table_stack',l.from_entity_id,'player_wallet',l.to_entity_id,r.amount,l.club_id,l.to_entity_id);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_cashout(uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $original_movement_owners$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_fund_from_balance(uuid,numeric,text,uuid,numeric)'::regprocedure) INTO def;
 needle:=' IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_funding_prelock_anchor_changed';END IF;
 EXECUTE replace(def,needle,E' PERFORM public.fn_ca_promo_profit_prelock_source(l.club_id,l.from_entity_id,l.from_type,l.from_entity_id);\n'||needle);
 SELECT pg_get_functiondef('public.fn_ca_promo_integrity_on_funding()'::regprocedure) INTO def;
 needle:=' SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=NEW.ledger_id;';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_H_funding_snapshot_anchor_changed';END IF;
 EXECUTE replace(def,needle,E' PERFORM public.fn_ca_promo_profit_snapshot_funding(NEW.ledger_id);\n'||needle);
 SELECT pg_get_functiondef('public.fn_ca_promo_apply_pending_cash_funding(uuid)'::regprocedure) INTO def;
 needle:=' PERFORM public.fn_ca_promo_play_through_settle(f.funding_club_id,f.user_id);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_pending_prelock_anchor_changed';END IF;
 EXECUTE replace(def,needle,E' PERFORM public.fn_ca_promo_profit_prelock_source(f.funding_club_id,f.user_id,''pending_addon'',p_pending);\n'||needle);
 SELECT pg_get_functiondef('public.fn_ca_promo_integrity_on_pending()'::regprocedure) INTO def;
 needle:=' SELECT * INTO STRICT a FROM public.cash_funding_application_receipts WHERE pending_addon_id=NEW.pending_addon_id;';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_H_pending_snapshot_anchor_changed';END IF;
 EXECUTE replace(def,needle,E' PERFORM public.fn_ca_promo_profit_snapshot_pending(NEW.pending_addon_id);\n'||needle);
 SELECT pg_get_functiondef('public.fn_ca_promo_custody_on_ledger()'::regprocedure) INTO def;
 needle:=E'  IF dest IS NOT NULL THEN\n   PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id,uid);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_event_prelock_anchor_changed';END IF;
 def:=replace(def,needle,E'  IF dest IS NOT NULL THEN\n   PERFORM public.fn_ca_promo_profit_prelock_source(NEW.club_id,uid,NEW.from_type,uid);\n   PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id,uid);');
 needle:=E'  dest:=CASE NEW.from_type WHEN ''table_stack'' THEN ''table_stack'' ELSE ''event'' END;\n  PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id,uid);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_table_cashout_prelock_anchor_changed';END IF;
 def:=replace(def,needle,E'  dest:=CASE NEW.from_type WHEN ''table_stack'' THEN ''table_stack'' ELSE ''event'' END;\n  IF NEW.category=''table_cashout'' THEN PERFORM public.fn_ca_promo_profit_prelock_source(NEW.club_id,uid,''table_stack'',NEW.from_entity_id);END IF;\n  PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id,uid);');
 needle:='ELSIF NEW.category=''table_cashout'' THEN';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_W_cashout_anchor_changed';END IF;
 EXECUTE replace(def,needle,needle||E'\n   PERFORM public.fn_ca_promo_profit_cashout(NEW.id);');
 -- Purchased tickets must use the exact actual restricted union.
  SELECT pg_get_functiondef('public.fn_ca_issue_cashable_ticket_owned(uuid,uuid,numeric,text,text,text)'::regprocedure) INTO def;
  needle:=$n$  v_locked:=public.fn_ca_promo_locked_at(p_club_id,v_me,p_source_wallet,v_me);
  IF to_regprocedure('public.fn_ca_promo_integrity_locked_at(uuid,uuid,text,uuid)') IS NOT NULL THEN
    v_locked:=v_locked+public.fn_ca_promo_integrity_locked_at(p_club_id,v_me,p_source_wallet,v_me);
  END IF;$n$;
  IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_cash_ticket_union_anchor_changed';END IF;
  EXECUTE replace(def,needle,'  v_locked:=public.fn_ca_promo_restricted_at(p_club_id,v_me,p_source_wallet,v_me);');
END $original_movement_owners$;

-- END ORIGINAL WINNINGS MOVEMENT SOURCE

CREATE FUNCTION public.fn_ca_promo_profit_record_event(p_ledger uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE f public.ca_promo_profit_funding_sources%ROWTYPE;l public.chip_ledger%ROWTYPE;r record;c jsonb;scope_club uuid;scope_user uuid;before_o numeric;after_o numeric;moved_o numeric;sum_o numeric;sum_w numeric;header public.ca_promo_profit_event_charge_receipts%ROWTYPE;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 SELECT * INTO f FROM public.ca_promo_profit_funding_sources WHERE ledger_id=p_ledger;
 IF NOT FOUND THEN RAISE EXCEPTION 'original_winnings_event_funding_source_missing';END IF;
 IF f.destination_kind<>'event' OR l.to_type<>'prize_liability' OR l.to_entity_id<>f.destination_id OR l.amount<>f.amount THEN RAISE EXCEPTION 'original_winnings_event_funding_identity_invalid';END IF;
 SELECT club_id,user_id INTO scope_club,scope_user FROM public.fn_ca_promo_entry_charge_identity(p_ledger);
 IF scope_user IS DISTINCT FROM f.user_id OR scope_club IS DISTINCT FROM f.destination_club_id THEN RAISE EXCEPTION 'original_winnings_event_earning_scope_conflict';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(f.source_lots)x WHERE NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_funding_lots w WHERE w.ledger_id=p_ledger AND w.grant_id=(x->>'grant_id')::uuid AND w.profit_before=(x->>'profit_before')::numeric AND w.overlap_before=(x->>'overlap_before')::numeric))
 OR (SELECT count(*) FROM public.ca_promo_profit_funding_lots WHERE ledger_id=p_ledger)<>jsonb_array_length(f.source_lots) THEN RAISE EXCEPTION 'original_winnings_event_funding_incomplete';END IF;
 SELECT COALESCE(sum(profit_moved),0),COALESCE(sum(overlap_moved),0) INTO sum_w,sum_o FROM public.ca_promo_profit_funding_lots WHERE ledger_id=p_ledger;
 SELECT * INTO header FROM public.ca_promo_profit_event_charge_receipts WHERE charge_ledger_id=p_ledger;
 IF FOUND THEN
  IF ROW(header.club_id,header.user_id,header.original_profit,header.original_overlap) IS DISTINCT FROM ROW(scope_club,scope_user,sum_w,sum_o) THEN RAISE EXCEPTION 'original_winnings_event_charge_reused';END IF;
  PERFORM public.fn_ca_promo_profit_finish_entry_fee(p_ledger);RETURN;
 END IF;
 FOR r IN SELECT w.*,x->'cases' cases FROM public.ca_promo_profit_funding_lots w JOIN LATERAL jsonb_array_elements(f.source_lots)x ON (x->>'grant_id')::uuid=w.grant_id WHERE w.ledger_id=p_ledger ORDER BY w.grant_id LOOP
  IF r.profit_moved>0 THEN INSERT INTO public.ca_promo_profit_event_lots VALUES(r.grant_id,p_ledger,f.destination_id,scope_club,scope_user,r.profit_moved,r.profit_moved);END IF;
  sum_o:=0;
  FOR c IN SELECT value FROM jsonb_array_elements(r.cases) LOOP
   before_o:=(c->>'amount')::numeric;
   SELECT COALESCE(sum(o.amount),0) INTO after_o FROM public.ca_promo_profit_integrity_overlap o WHERE o.grant_id=r.grant_id AND o.case_id=(c->>'case_id')::uuid AND o.club_id=f.source_club_id AND o.user_id=f.user_id AND o.kind=f.source_kind AND o.entity_id=f.source_entity_id;
   moved_o:=before_o-after_o;
   IF moved_o<0 OR moved_o>before_o THEN RAISE EXCEPTION 'original_winnings_event_case_movement_invalid';END IF;
   IF moved_o>0 THEN INSERT INTO public.ca_promo_profit_event_overlap_lots VALUES(p_ledger,r.grant_id,(c->>'case_id')::uuid,moved_o,moved_o);END IF;
   sum_o:=sum_o+moved_o;
  END LOOP;
  IF sum_o<>r.overlap_moved THEN RAISE EXCEPTION 'original_winnings_event_case_movement_incomplete';END IF;
 END LOOP;
 SELECT COALESCE(sum(profit_moved),0),COALESCE(sum(overlap_moved),0) INTO sum_w,sum_o FROM public.ca_promo_profit_funding_lots WHERE ledger_id=p_ledger;
 INSERT INTO public.ca_promo_profit_event_charge_receipts VALUES(p_ledger,scope_club,scope_user,sum_w,sum_o);
 PERFORM public.fn_ca_promo_profit_finish_entry_fee(p_ledger);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_record_event(uuid) FROM PUBLIC,anon,authenticated,service_role;


-- Allocate actual payout cents once across disjoint original source cells.
-- W/H intersection is one physical source, not two competing payout budgets.
CREATE FUNCTION public.fn_ca_promo_profit_event_cells(p_source uuid)
RETURNS TABLE(earning_receipt_id uuid,charge_ledger_id uuid,grant_id uuid,case_id uuid,principal_amount numeric,profit_amount numeric,integrity_amount numeric,overlap_amount numeric,amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE src record;sl record;costs jsonb;cells jsonb;denominator numeric;gross_denominator numeric;use_gross boolean;
BEGIN
 IF p_source IS NULL THEN RETURN;END IF;
 SELECT * INTO STRICT src FROM public.ca_promo_profit_earning_sources WHERE source_id=p_source;
 IF (SELECT COALESCE(sum(x.amount),0) FROM public.ca_promo_profit_earning_source_slices x WHERE x.source_id=p_source)<>src.amount THEN RAISE EXCEPTION 'original_earning_slices_do_not_conserve_credit';END IF;
 FOR sl IN SELECT x.* FROM public.ca_promo_profit_earning_source_slices x WHERE x.source_id=p_source ORDER BY x.earning_receipt_id LOOP
  WITH charges AS(SELECT DISTINCT unnest(sl.charge_ledger_ids) id),priced AS(
   SELECT c.id,CASE WHEN p.charge_ledger_id IS NOT NULL THEN p.charge_amount WHEN a.ledger_id IS NOT NULL THEN l.amount ELSE COALESCE(f.amount,0) END gross,
    CASE WHEN p.charge_ledger_id IS NOT NULL THEN p.charge_amount-p.gross_fee WHEN a.ledger_id IS NOT NULL THEN l.amount ELSE COALESCE(f.amount,0) END risk
   FROM charges c LEFT JOIN public.chip_ledger l ON l.id=c.id
   LEFT JOIN public.ca_promo_event_fee_consumption_receipts p ON p.charge_ledger_id=c.id AND p.player_id=src.user_id
   LEFT JOIN public.ca_promo_event_realization_receipts a ON a.ledger_id=c.id AND a.user_id=src.user_id AND l.to_type='prize_liability' AND l.from_type IN('prize_liability','escrow')
   LEFT JOIN LATERAL(SELECT sum(x.amount) amount FROM public.ca_promo_free_buy_funding_slices x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id AND g.user_id=src.user_id WHERE x.ledger_id=c.id)f ON true
  ) SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'),COALESCE(sum(x.risk),0),COALESCE(sum(x.gross),0) INTO costs,denominator,gross_denominator FROM priced x;
  use_gross:=denominator=0;IF use_gross THEN denominator:=gross_denominator;END IF;
  IF denominator<=0 THEN
   IF EXISTS(SELECT 1 FROM public.ca_promo_event_principal_lots p JOIN public.ca_promo_play_through_grants g ON g.id=p.grant_id WHERE p.charge_ledger_id=ANY(sl.charge_ledger_ids) AND g.user_id=src.user_id)
   OR EXISTS(SELECT 1 FROM public.ca_promo_profit_event_lots w WHERE w.charge_ledger_id=ANY(sl.charge_ledger_ids) AND w.user_id=src.user_id) THEN RAISE EXCEPTION 'original_earning_investment_source_incomplete';END IF;
   CONTINUE;
  END IF;
  WITH price AS MATERIALIZED(SELECT x.id,CASE WHEN use_gross THEN x.gross ELSE x.risk END risk FROM jsonb_to_recordset(costs)x(id uuid,gross numeric,risk numeric)),p AS MATERIALIZED(
   SELECT x.charge_ledger_id,x.grant_id,sum(x.original_amount)-CASE WHEN use_gross THEN 0 ELSE COALESCE((SELECT sum(f.amount) FROM public.ca_promo_event_fee_consumption_slices f WHERE f.charge_ledger_id=x.charge_ledger_id AND f.grant_id=x.grant_id),0) END risk
   FROM public.ca_promo_event_principal_lots x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id AND g.user_id=src.user_id WHERE x.charge_ledger_id=ANY(sl.charge_ledger_ids) GROUP BY x.charge_ledger_id,x.grant_id
  ),w AS MATERIALIZED(
   SELECT x.charge_ledger_id,x.grant_id,x.original_amount-CASE WHEN use_gross THEN 0 ELSE COALESCE((SELECT sum(f.amount) FROM public.ca_promo_profit_entry_fee_slices f WHERE f.charge_ledger_id=x.charge_ledger_id AND f.grant_id=x.grant_id),0) END risk
   FROM public.ca_promo_profit_event_lots x WHERE x.charge_ledger_id=ANY(sl.charge_ledger_ids) AND x.user_id=src.user_id
  ),h AS MATERIALIZED(
   SELECT x.charge_ledger_id,x.case_id,x.original_amount-CASE WHEN use_gross THEN 0 ELSE COALESCE((SELECT sum(f.amount) FROM public.ca_promo_integrity_fee_slices f WHERE f.charge_ledger_id=x.charge_ledger_id AND f.case_id=x.case_id),0) END risk
   FROM public.ca_promo_integrity_event_lots x WHERE x.charge_ledger_id=ANY(sl.charge_ledger_ids) AND x.user_id=src.user_id
  ),o AS MATERIALIZED(
   SELECT x.charge_ledger_id,x.grant_id,x.case_id,x.original_amount-CASE WHEN use_gross THEN 0 ELSE COALESCE((SELECT sum(f.amount) FROM public.ca_promo_profit_entry_fee_overlap_slices f WHERE f.charge_ledger_id=x.charge_ledger_id AND f.grant_id=x.grant_id AND f.case_id=x.case_id),0) END risk
   FROM public.ca_promo_profit_event_overlap_lots x JOIN public.ca_promo_profit_event_lots owner USING(grant_id,charge_ledger_id) WHERE x.charge_ledger_id=ANY(sl.charge_ledger_ids) AND owner.user_id=src.user_id
  ),components AS(
   SELECT x.charge_ledger_id,x.grant_id,NULL::uuid case_id,'p' kind,x.risk FROM p x
   UNION ALL SELECT x.charge_ledger_id,x.grant_id,NULL,'w',x.risk-COALESCE((SELECT sum(y.risk) FROM o y WHERE y.charge_ledger_id=x.charge_ledger_id AND y.grant_id=x.grant_id),0) FROM w x
   UNION ALL SELECT x.charge_ledger_id,x.grant_id,x.case_id,'o',x.risk FROM o x
   UNION ALL SELECT x.charge_ledger_id,NULL,x.case_id,'h',x.risk-COALESCE((SELECT sum(y.risk) FROM o y WHERE y.charge_ledger_id=x.charge_ledger_id AND y.case_id=x.case_id),0) FROM h x
   UNION ALL SELECT x.id,NULL,NULL,'c',x.risk-COALESCE((SELECT sum(y.risk) FROM p y WHERE y.charge_ledger_id=x.id),0)-COALESCE((SELECT sum(y.risk) FROM w y WHERE y.charge_ledger_id=x.id),0)-COALESCE((SELECT sum(y.risk) FROM h y WHERE y.charge_ledger_id=x.id),0)+COALESCE((SELECT sum(y.risk) FROM o y WHERE y.charge_ledger_id=x.id),0) FROM price x
  ) SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]') INTO cells FROM components x;
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(cells)x(risk numeric) WHERE x.risk<0)
  OR (SELECT COALESCE(sum(x.risk),0) FROM jsonb_to_recordset(cells)x(risk numeric))<>denominator THEN RAISE EXCEPTION 'original_earning_joint_sources_not_conserved';END IF;
  RETURN QUERY WITH raw AS(
   SELECT x.*,g.granted_at,sl.amount*x.risk/denominator exact FROM jsonb_to_recordset(cells)x(charge_ledger_id uuid,grant_id uuid,case_id uuid,kind text,risk numeric)
   LEFT JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id WHERE x.risk>0
  ),ranked AS(
   SELECT x.*,floor(x.exact*100)/100 base,row_number() OVER(ORDER BY x.exact*100-floor(x.exact*100) DESC,x.granted_at NULLS LAST,x.grant_id NULLS LAST,x.case_id NULLS LAST,x.charge_ledger_id,x.kind) rank,sum(floor(x.exact*100)/100) OVER() base_total FROM raw x
  ),allocated AS(SELECT x.*,x.base+CASE WHEN x.rank<=round((sl.amount-x.base_total)*100)::integer THEN .01 ELSE 0 END allocated FROM ranked x)
  SELECT sl.earning_receipt_id,x.charge_ledger_id,x.grant_id,x.case_id,
   CASE WHEN x.kind='p' THEN x.allocated ELSE 0 END,CASE WHEN x.kind IN('w','o') THEN x.allocated ELSE 0 END,
   CASE WHEN x.kind IN('h','o') AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id) THEN x.allocated ELSE 0 END,
   CASE WHEN x.kind='o' AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id) THEN x.allocated ELSE 0 END,x.allocated FROM allocated x;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_event_cells(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_profit_event_budget(p_source uuid)
RETURNS TABLE(earning_receipt_id uuid,grant_id uuid,eligible_amount numeric,principal_amount numeric,profit_amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 RETURN QUERY SELECT x.earning_receipt_id,x.grant_id,sum(x.principal_amount+x.profit_amount),sum(x.principal_amount),sum(x.profit_amount)
 FROM public.fn_ca_promo_profit_event_cells(p_source)x WHERE x.grant_id IS NOT NULL GROUP BY x.earning_receipt_id,x.grant_id;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_event_budget(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Keep the original qualification/support membership reachable while this
-- player's own winnings remain restricted anywhere. Ordinary withdrawals use
-- their existing owners and remain available for unrelated cashable chips.
CREATE FUNCTION public.fn_ca_promo_profit_preserve_source_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants g JOIN public.ca_promo_profit_gates gate ON gate.grant_id=g.id AND gate.unlocked_at IS NULL
 JOIN public.ca_promo_profit_custody w ON w.grant_id=g.id AND w.amount>0 WHERE g.club_id=OLD.club_id AND g.user_id=OLD.user_id
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=g.id)) THEN
 RAISE EXCEPTION 'original_promo_winnings_requirement_must_be_resolved_before_leaving_club' USING ERRCODE='23514';END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_preserve_source_membership() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_profit_source_membership BEFORE DELETE ON public.club_members FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_preserve_source_membership();
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note)
VALUES('club_members','ca_promo_profit_source_membership','Preserve original fee qualification and reasoned support route while source-linked player-owned winnings remain restricted in any physical club; no balance write or cashable-withdrawal restriction.');

CREATE TABLE public.ca_promo_profit_event_integrity_overlap_returns (
 ledger_id uuid NOT NULL,earning_receipt_id uuid NOT NULL,grant_id uuid NOT NULL,case_id uuid NOT NULL,charge_ledger_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>0 AND amount=round(amount,2)),PRIMARY KEY(ledger_id,earning_receipt_id,grant_id,case_id,charge_ledger_id)
);
CREATE TABLE public.ca_promo_profit_event_winnings_returns (
 ledger_id uuid NOT NULL,earning_receipt_id uuid NOT NULL,grant_id uuid NOT NULL,charge_ledger_id uuid NOT NULL,source_club_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>0 AND amount=round(amount,2)),PRIMARY KEY(ledger_id,earning_receipt_id,grant_id,charge_ledger_id)
);
CREATE TABLE public.ca_promo_profit_event_winnings_receipts (
 ledger_id uuid PRIMARY KEY,source_id uuid,user_id uuid NOT NULL,club_id uuid NOT NULL,destination_kind text NOT NULL,destination_id uuid NOT NULL,returned numeric NOT NULL,new_winnings numeric NOT NULL CHECK(returned>=0 AND new_winnings>=0)
);
DO $event_winnings_receipts$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['ca_promo_profit_event_integrity_overlap_returns','ca_promo_profit_event_winnings_returns','ca_promo_profit_event_winnings_receipts'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',n);EXECUTE format('GRANT SELECT ON public.%I TO service_role',n);
 EXECUTE format('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable()',n);
 EXECUTE format('CREATE TRIGGER immutable_table BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable()',n);
 END LOOP;
END $event_winnings_receipts$;
CREATE FUNCTION public.fn_ca_promo_profit_record_nonwallet_event(p_ledger uuid,p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;club uuid;entrant uuid;r record;o record;n numeric;oh numeric;total numeric:=0;overlap numeric:=0;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 IF l.from_type NOT IN('escrow','prize_liability') OR l.to_type<>'prize_liability' OR l.amount<=0 THEN RAISE EXCEPTION 'original_winnings_noncash_entry_required';END IF;
 SELECT x.club_id,x.user_id INTO club,entrant FROM public.fn_ca_promo_entry_charge_identity(l.id)x;
 IF entrant IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'original_winnings_noncash_entrant_mismatch';END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_profit_event_charge_receipts WHERE charge_ledger_id=l.id) THEN PERFORM public.fn_ca_promo_profit_finish_entry_fee(l.id);RETURN;END IF;
 FOR r IN SELECT c.grant_id,c.amount-COALESCE((SELECT sum(x.remaining) FROM public.ca_promo_profit_event_lots x WHERE x.grant_id=c.grant_id AND x.tournament_id=l.to_entity_id),0) extra
  FROM public.ca_promo_profit_custody c JOIN public.ca_promo_profit_gates gate ON gate.grant_id=c.grant_id AND gate.unlocked_at IS NULL
  WHERE c.club_id=club AND c.user_id=p_user AND c.kind='event' AND c.entity_id=l.to_entity_id AND c.amount>0 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides z WHERE z.grant_id=c.grant_id) ORDER BY c.grant_id LOOP
  IF r.extra<0 THEN RAISE EXCEPTION 'original_winnings_event_lots_exceed_custody';END IF;
  IF r.extra=0 THEN CONTINUE;END IF;
  INSERT INTO public.ca_promo_profit_event_lots VALUES(r.grant_id,l.id,l.to_entity_id,club,p_user,r.extra,r.extra);total:=total+r.extra;
  FOR o IN SELECT x.case_id,x.amount-COALESCE((SELECT sum(y.remaining) FROM public.ca_promo_profit_event_overlap_lots y JOIN public.ca_promo_profit_event_lots a USING(grant_id,charge_ledger_id) WHERE y.grant_id=x.grant_id AND y.case_id=x.case_id AND a.tournament_id=l.to_entity_id),0) extra
   FROM public.ca_promo_profit_integrity_overlap x WHERE x.grant_id=r.grant_id AND x.club_id=club AND x.user_id=p_user AND x.kind='event' AND x.entity_id=l.to_entity_id AND x.amount>0 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id) ORDER BY x.case_id LOOP
   IF o.extra<0 THEN RAISE EXCEPTION 'original_winnings_event_overlap_lots_exceed_custody';END IF;
   IF o.extra>0 THEN INSERT INTO public.ca_promo_profit_event_overlap_lots VALUES(l.id,r.grant_id,o.case_id,o.extra,o.extra);overlap:=overlap+o.extra;END IF;
  END LOOP;
 END LOOP;
 IF total>l.amount OR overlap>total THEN RAISE EXCEPTION 'original_winnings_noncash_entry_not_conserved';END IF;
 INSERT INTO public.ca_promo_profit_event_charge_receipts VALUES(l.id,club,p_user,total,overlap);
 PERFORM public.fn_ca_promo_profit_finish_entry_fee(l.id);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_record_nonwallet_event(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_realize_event(p_ledger uuid,p_source uuid,p_destination text,p_destination_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;s record;b record;r record;o record;e public.tournament_refund_entitlements%ROWTYPE;v_user uuid;club uuid;earning uuid;source_charge uuid;
 only_before numeric;only_budget numeric;capital numeric;overlap_return numeric;principal_return numeric;n numeric;total numeric:=0;created numeric:=0;new_amount numeric;new_by_grant jsonb:='{}';dest_kind text:=p_destination;dest_id uuid:=p_destination_id;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 IF EXISTS(SELECT 1 FROM public.ca_promo_profit_event_winnings_receipts WHERE ledger_id=l.id) THEN RETURN;END IF;
 IF l.from_type<>'prize_liability' OR l.amount<=0 OR dest_kind NOT IN('player_wallet','event','ticket') OR dest_id IS NULL THEN RAISE EXCEPTION 'original_winnings_event_credit_required';END IF;
 IF p_source IS NOT NULL THEN
  SELECT * INTO STRICT s FROM public.ca_promo_profit_earning_sources WHERE source_id=p_source;
  IF ROW(s.tournament_id,s.amount) IS DISTINCT FROM ROW(l.from_entity_id,l.amount) OR NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_earning_credit_links x WHERE x.ledger_id=l.id AND x.source_id=p_source) THEN RAISE EXCEPTION 'original_winnings_earning_ledger_mismatch';END IF;
  v_user:=s.user_id;club:=CASE WHEN dest_kind='player_wallet' THEN l.club_id ELSE s.earning_club_id END;
 ELSE
  source_charge:=NULL;
  IF dest_kind='ticket' AND l.metadata->>'kind'='tournament_entry_ticket_return' THEN
   SELECT * INTO e FROM public.tournament_refund_entitlements WHERE id=NULLIF(l.metadata->>'entitlement_id','')::uuid;
  ELSE
   SELECT * INTO e FROM public.tournament_refund_entitlements WHERE id=NULLIF(current_setting('app.ca_promo_refund_entitlement',true),'')::uuid;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_event_lots x JOIN public.ca_promo_profit_gates gate ON gate.grant_id=x.grant_id AND gate.unlocked_at IS NULL
   WHERE x.tournament_id=l.from_entity_id AND x.user_id=COALESCE(e.user_id,NULLIF(l.metadata->>'user_id','')::uuid,l.to_entity_id) AND (e.id IS NULL OR x.charge_ledger_id=e.source_ledger_id) AND x.remaining>0 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides z WHERE z.grant_id=x.grant_id)) THEN
   INSERT INTO public.ca_promo_profit_event_winnings_receipts VALUES(l.id,NULL,COALESCE(e.user_id,NULLIF(l.metadata->>'user_id','')::uuid,l.to_entity_id),l.club_id,dest_kind,dest_id,0,0);RETURN;
  END IF;
  IF e.id IS NULL THEN RAISE EXCEPTION 'original_winnings_refund_identity_required';END IF;
  IF e.tournament_id<>l.from_entity_id OR e.gross<>l.amount OR (dest_kind='player_wallet' AND (l.to_entity_id<>e.user_id OR l.club_id<>e.refund_wallet_club_id)) THEN RAISE EXCEPTION 'original_winnings_refund_ledger_mismatch';END IF;
  v_user:=e.user_id;club:=CASE WHEN dest_kind='player_wallet' THEN l.club_id ELSE (SELECT p.club_id FROM public.ca_promo_event_fee_consumption_receipts p WHERE p.charge_ledger_id=e.source_ledger_id) END;source_charge:=e.source_ledger_id;
 END IF;
 IF (dest_kind='player_wallet' AND (l.to_type<>'player_wallet' OR dest_id<>l.to_entity_id OR v_user<>l.to_entity_id)) OR (dest_kind='event' AND (l.to_type<>'prize_liability' OR dest_id<>l.to_entity_id)) OR (dest_kind='ticket' AND (l.to_type<>'escrow' OR dest_id IS DISTINCT FROM COALESCE(NULLIF(l.metadata->>'ticket_id','')::uuid,l.to_entity_id))) THEN RAISE EXCEPTION 'original_winnings_event_destination_mismatch';END IF;
 FOR b IN SELECT x.earning_receipt_id,x.charge_ledger_id,x.grant_id,sum(x.principal_amount) principal_amount,sum(x.profit_amount-x.overlap_amount) only_amount,sum(x.profit_amount) profit_amount
  FROM public.fn_ca_promo_profit_event_cells(p_source)x WHERE p_source IS NOT NULL AND x.grant_id IS NOT NULL GROUP BY x.earning_receipt_id,x.charge_ledger_id,x.grant_id
  UNION ALL SELECT e.id,w.charge_ledger_id,w.grant_id,0,w.remaining,w.remaining FROM public.ca_promo_profit_event_lots w WHERE p_source IS NULL AND w.charge_ledger_id=source_charge AND w.user_id=e.user_id ORDER BY 1,2,3 LOOP
  SELECT * INTO r FROM public.ca_promo_profit_event_lots WHERE grant_id=b.grant_id AND charge_ledger_id=b.charge_ledger_id FOR UPDATE;
  capital:=0;
  IF FOUND AND r.remaining>0 THEN
   SELECT COALESCE(sum(x.remaining),0) INTO only_before FROM public.ca_promo_profit_event_overlap_lots x WHERE x.grant_id=r.grant_id AND x.charge_ledger_id=r.charge_ledger_id AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id);
   only_before:=r.remaining-only_before;
   IF only_before<0 THEN RAISE EXCEPTION 'original_event_winnings_overlap_exceeds_capital';END IF;
   IF p_source IS NULL THEN overlap_return:=r.remaining-only_before;ELSE SELECT COALESCE(sum(x.amount),0) INTO overlap_return FROM public.ca_promo_profit_event_integrity_overlap_returns x WHERE x.ledger_id=l.id AND x.earning_receipt_id=b.earning_receipt_id AND x.grant_id=b.grant_id AND x.charge_ledger_id=b.charge_ledger_id;END IF;
   capital:=LEAST(b.only_amount,only_before)+overlap_return;
   IF capital>r.remaining THEN RAISE EXCEPTION 'original_event_winnings_capital_return_exceeds_source';END IF;
   IF capital>0 THEN
    UPDATE public.ca_promo_profit_event_lots SET remaining=remaining-capital WHERE grant_id=r.grant_id AND charge_ledger_id=r.charge_ledger_id;
    PERFORM public.fn_ca_promo_profit_move_grant(r.grant_id,r.club_id,r.user_id,'event',r.tournament_id,dest_kind,dest_id,capital,club,v_user);
    INSERT INTO public.ca_promo_profit_event_winnings_returns VALUES(l.id,b.earning_receipt_id,r.grant_id,r.charge_ledger_id,r.club_id,capital);total:=total+capital;
   END IF;
   FOR o IN SELECT x.case_id,CASE WHEN p_source IS NULL THEN x.remaining ELSE COALESCE((SELECT y.amount FROM public.ca_promo_profit_event_integrity_overlap_returns y WHERE y.ledger_id=l.id AND y.earning_receipt_id=b.earning_receipt_id AND y.grant_id=x.grant_id AND y.case_id=x.case_id AND y.charge_ledger_id=x.charge_ledger_id),0) END amount
    FROM public.ca_promo_profit_event_overlap_lots x WHERE x.grant_id=r.grant_id AND x.charge_ledger_id=r.charge_ledger_id AND x.remaining>0 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id) ORDER BY x.case_id LOOP
    IF o.amount<=0 THEN CONTINUE;END IF;
    UPDATE public.ca_promo_profit_event_overlap_lots SET remaining=remaining-o.amount WHERE grant_id=r.grant_id AND charge_ledger_id=r.charge_ledger_id AND case_id=o.case_id AND remaining>=o.amount;
    IF NOT FOUND THEN RAISE EXCEPTION 'original_event_winnings_overlap_return_missing';END IF;
    UPDATE public.ca_promo_profit_integrity_overlap SET amount=amount-o.amount WHERE grant_id=r.grant_id AND case_id=o.case_id AND club_id=r.club_id AND user_id=r.user_id AND kind='event' AND entity_id=r.tournament_id AND amount>=o.amount;
    IF NOT FOUND THEN RAISE EXCEPTION 'original_event_winnings_overlap_position_missing';END IF;
    INSERT INTO public.ca_promo_profit_integrity_overlap VALUES(r.grant_id,o.case_id,club,v_user,dest_kind,dest_id,o.amount) ON CONFLICT(grant_id,case_id,club_id,user_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_profit_integrity_overlap.amount+EXCLUDED.amount;
   END LOOP;
  END IF;
  IF p_source IS NOT NULL THEN
   SELECT COALESCE(sum(x.amount),0) INTO principal_return FROM public.ca_promo_profit_event_principal_returns x WHERE x.ledger_id=l.id AND x.earning_receipt_id=b.earning_receipt_id AND x.grant_id=b.grant_id AND x.charge_ledger_id=b.charge_ledger_id;
   new_amount:=GREATEST(b.principal_amount+b.profit_amount-principal_return-capital,0);
   new_by_grant:=jsonb_set(new_by_grant,ARRAY[b.grant_id::text],to_jsonb(COALESCE((new_by_grant->>b.grant_id::text)::numeric,0)+new_amount));
  END IF;
 END LOOP;
 FOR b IN SELECT key::uuid grant_id,value::numeric amount FROM jsonb_each_text(new_by_grant) ORDER BY key LOOP
  IF b.amount>0 THEN n:=public.fn_ca_promo_profit_credit_owned('tournament_win',l.id,b.grant_id,club,v_user,dest_kind,dest_id,b.amount);created:=created+n;END IF;
 END LOOP;
 INSERT INTO public.ca_promo_profit_event_winnings_receipts VALUES(l.id,p_source,v_user,club,dest_kind,dest_id,total,created);
 IF dest_kind='event' THEN PERFORM public.fn_ca_promo_profit_record_nonwallet_event(l.id,v_user);END IF;
 IF dest_kind='player_wallet' AND public.fn_ca_promo_restricted_at(club,v_user,dest_kind,dest_id)>(SELECT chip_balance FROM public.club_members m WHERE m.club_id=club AND m.user_id=v_user) THEN RAISE EXCEPTION 'original_event_winnings_restrictions_exceed_physical_wallet';END IF;
 IF dest_kind='ticket' AND public.fn_ca_promo_restricted_at(club,v_user,dest_kind,dest_id)>(SELECT CASE WHEN t.status='issued' THEN t.value ELSE 0 END FROM public.tournament_tickets t WHERE t.id=dest_id AND t.holder_id=v_user) THEN RAISE EXCEPTION 'original_event_winnings_restrictions_exceed_physical_ticket';END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_realize_event(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.ca_promo_profit_ticket_sources(ledger_id uuid PRIMARY KEY,ticket_id uuid NOT NULL,user_id uuid NOT NULL,amount numeric NOT NULL,source_lots jsonb NOT NULL);
CREATE TABLE public.ca_promo_profit_ticket_applications(ledger_id uuid PRIMARY KEY REFERENCES public.ca_promo_profit_ticket_sources(ledger_id),destination_kind text NOT NULL,destination_id uuid NOT NULL,club_id uuid NOT NULL,amount numeric NOT NULL);
ALTER TABLE public.ca_promo_profit_ticket_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_promo_profit_ticket_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_profit_ticket_sources,public.ca_promo_profit_ticket_applications FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_profit_ticket_sources,public.ca_promo_profit_ticket_applications TO service_role;
CREATE TRIGGER original_ticket_W_source_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_profit_ticket_sources FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER original_ticket_W_application_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_profit_ticket_applications FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER original_ticket_W_source_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_ticket_sources FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER original_ticket_W_application_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_ticket_applications FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE FUNCTION public.fn_ca_promo_profit_snapshot_ticket(p_ledger uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;t public.tournament_tickets%ROWTYPE;r record;lots jsonb;principal numeric;profit numeric;held numeric;overlap numeric;
BEGIN
 IF EXISTS(SELECT 1 FROM public.ca_promo_profit_ticket_sources WHERE ledger_id=p_ledger) THEN RETURN;END IF;
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 SELECT * INTO STRICT t FROM public.tournament_tickets WHERE id=COALESCE(NULLIF(l.metadata->>'ticket_id','')::uuid,l.from_entity_id) FOR UPDATE;
 IF l.from_type<>'escrow' OR l.amount<>t.value OR t.holder_id IS DISTINCT FROM COALESCE(NULLIF(l.metadata->>'user_id','')::uuid,l.to_entity_id) OR l.to_type NOT IN('prize_liability','player_wallet') THEN RAISE EXCEPTION 'original_winnings_ticket_source_mismatch';END IF;
 FOR r IN SELECT DISTINCT g.club_id,g.user_id FROM public.ca_promo_profit_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id WHERE c.kind='ticket' AND c.entity_id=t.id AND c.user_id=t.holder_id AND c.amount>0 ORDER BY g.club_id,g.user_id LOOP
  PERFORM public.fn_ca_promo_profit_try_member(r.club_id,r.user_id);PERFORM public.fn_ca_promo_profit_settle(r.club_id,r.user_id);
 END LOOP;
 PERFORM 1 FROM public.ca_promo_integrity_cases k WHERE k.id IN(SELECT c.case_id FROM public.ca_promo_integrity_custody c WHERE c.kind='ticket' AND c.entity_id=t.id AND c.user_id=t.holder_id AND c.amount>0) ORDER BY k.id FOR UPDATE NOWAIT;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('grant_id',x.grant_id,'club_id',x.club_id,'amount',x.amount,'overlap',x.overlap,'cases',x.cases) ORDER BY x.club_id,x.grant_id),'[]'),COALESCE(sum(x.amount),0),COALESCE(sum(x.overlap),0) INTO lots,profit,overlap FROM(
 SELECT c.*,COALESCE((SELECT sum(o.amount) FROM public.ca_promo_profit_integrity_overlap o WHERE o.grant_id=c.grant_id AND o.club_id=c.club_id AND o.user_id=c.user_id AND o.kind='ticket' AND o.entity_id=t.id AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=o.case_id)),0) overlap,
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('case_id',o.case_id,'amount',o.amount) ORDER BY o.case_id),'[]') FROM public.ca_promo_profit_integrity_overlap o WHERE o.grant_id=c.grant_id AND o.club_id=c.club_id AND o.user_id=c.user_id AND o.kind='ticket' AND o.entity_id=t.id AND o.amount>0 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=o.case_id)) cases
 FROM public.ca_promo_profit_custody c JOIN public.ca_promo_profit_gates gate ON gate.grant_id=c.grant_id AND gate.unlocked_at IS NULL WHERE c.kind='ticket' AND c.entity_id=t.id AND c.user_id=t.holder_id AND c.amount>0 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides z WHERE z.grant_id=c.grant_id))x;
 SELECT COALESCE(sum(c.amount),0) INTO principal FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id AND g.closed_at IS NULL WHERE c.kind='ticket' AND c.entity_id=t.id AND g.user_id=t.holder_id;
 SELECT COALESCE(sum(c.amount),0) INTO held FROM public.ca_promo_integrity_custody c WHERE c.kind='ticket' AND c.entity_id=t.id AND c.user_id=t.holder_id AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=c.case_id);
 IF principal+profit+held-overlap>t.value OR overlap>LEAST(profit,held) THEN RAISE EXCEPTION 'original_winnings_ticket_union_exceeds_face';END IF;
 INSERT INTO public.ca_promo_profit_ticket_sources VALUES(l.id,t.id,t.holder_id,l.amount,lots);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_snapshot_ticket(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_profit_apply_ticket(p_ledger uuid,p_destination text,p_destination_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;s public.ca_promo_profit_ticket_sources%ROWTYPE;r jsonb;club uuid;entrant uuid;current_w numeric;current_o numeric;carried numeric;total numeric:=0;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 SELECT * INTO STRICT s FROM public.ca_promo_profit_ticket_sources WHERE ledger_id=p_ledger;
 IF EXISTS(SELECT 1 FROM public.ca_promo_profit_ticket_applications WHERE ledger_id=p_ledger) THEN RETURN;END IF;
 IF p_destination='event' AND l.to_type='prize_liability' AND p_destination_id=l.to_entity_id THEN SELECT x.club_id,x.user_id INTO club,entrant FROM public.fn_ca_promo_entry_charge_identity(l.id)x;
 ELSIF p_destination='player_wallet' AND l.to_type='player_wallet' AND p_destination_id=l.to_entity_id THEN club:=l.club_id;entrant:=l.to_entity_id;
 ELSE RAISE EXCEPTION 'original_winnings_ticket_destination_mismatch';END IF;
 IF entrant IS DISTINCT FROM s.user_id THEN RAISE EXCEPTION 'original_winnings_ticket_recipient_mismatch';END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id AND g.closed_at IS NULL WHERE c.kind='ticket' AND c.entity_id=s.ticket_id AND c.amount>0) THEN RAISE EXCEPTION 'original_restricted_ticket_earning_scope_incompatible';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(s.source_lots) LOOP
  SELECT COALESCE(sum(c.amount),0) INTO current_w FROM public.ca_promo_profit_custody c WHERE c.grant_id=(r->>'grant_id')::uuid AND c.club_id=(r->>'club_id')::uuid AND c.user_id=s.user_id AND c.kind='ticket' AND c.entity_id=s.ticket_id;
  SELECT COALESCE(sum(o.amount),0) INTO current_o FROM public.ca_promo_profit_integrity_overlap o WHERE o.grant_id=(r->>'grant_id')::uuid AND o.club_id=(r->>'club_id')::uuid AND o.user_id=s.user_id AND o.kind='ticket' AND o.entity_id=s.ticket_id AND o.case_id IN(SELECT (x->>'case_id')::uuid FROM jsonb_array_elements(r->'cases')x);
  carried:=(r->>'overlap')::numeric-current_o;
  IF carried<0 OR (r->>'amount')::numeric-current_w<>carried OR current_o<>0 THEN RAISE EXCEPTION 'original_winnings_ticket_H_capital_not_carried';END IF;
  PERFORM public.fn_ca_promo_profit_move_grant((r->>'grant_id')::uuid,(r->>'club_id')::uuid,s.user_id,'ticket',s.ticket_id,p_destination,p_destination_id,current_w,club,s.user_id);total:=total+(r->>'amount')::numeric;
 END LOOP;
 INSERT INTO public.ca_promo_profit_ticket_applications VALUES(l.id,p_destination,p_destination_id,club,total);
 IF p_destination='event' THEN PERFORM public.fn_ca_promo_profit_record_nonwallet_event(l.id,s.user_id);END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_apply_ticket(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- BEGIN ORIGINAL TOURNAMENT EARNING PROJECTION
-- Independent event-consumer draft for W owner composition. No money writer.
-- Runtime requires200638 and the W owner's joint event_cells allocator; dormant OFF install is safe.
CREATE TABLE public.ca_promo_profit_event_principal_returns (
 ledger_id uuid NOT NULL,earning_receipt_id uuid NOT NULL,grant_id uuid NOT NULL,charge_ledger_id uuid NOT NULL,
 amount numeric NOT NULL CHECK(amount>0 AND amount=round(amount,2)),PRIMARY KEY(ledger_id,earning_receipt_id,grant_id,charge_ledger_id)
);
CREATE TABLE public.ca_promo_profit_event_integrity_returns (
 ledger_id uuid NOT NULL,earning_receipt_id uuid NOT NULL,case_id uuid NOT NULL,charge_ledger_id uuid NOT NULL,
 source_club_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>0 AND amount=round(amount,2)),
 PRIMARY KEY(ledger_id,earning_receipt_id,case_id,charge_ledger_id)
);
ALTER TABLE public.ca_promo_profit_event_principal_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_promo_profit_event_integrity_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_profit_event_principal_returns,public.ca_promo_profit_event_integrity_returns FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_profit_event_principal_returns,public.ca_promo_profit_event_integrity_returns TO service_role;
CREATE TRIGGER original_event_P_returns_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_profit_event_principal_returns FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER original_event_H_returns_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_profit_event_integrity_returns FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER original_event_P_returns_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_event_principal_returns FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER original_event_H_returns_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_event_integrity_returns FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();

CREATE FUNCTION public.fn_ca_promo_profit_return_event_principal(p_ledger uuid,p_source uuid,p_destination text,p_destination_id uuid) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;s record;b record;r record;prefix uuid[];leftover numeric;n numeric;total numeric:=0;scope_club uuid;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 SELECT * INTO STRICT s FROM public.ca_promo_profit_earning_sources WHERE source_id=p_source;
 IF ROW(l.from_type,l.from_entity_id,l.amount) IS DISTINCT FROM ROW('prize_liability'::text,s.tournament_id,s.amount)
 OR p_destination NOT IN('player_wallet','event','ticket') OR (p_destination<>'ticket' AND l.to_entity_id IS DISTINCT FROM p_destination_id) OR (p_destination='ticket' AND COALESCE(l.metadata->>'ticket_id',l.to_entity_id::text) IS DISTINCT FROM p_destination_id::text) OR (p_destination='player_wallet' AND p_destination_id IS DISTINCT FROM s.user_id) OR (p_destination<>'player_wallet' AND l.metadata->>'user_id' IS DISTINCT FROM s.user_id::text) THEN RAISE EXCEPTION 'original_event_P_source_identity_invalid';END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id) THEN RETURN(SELECT principal FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id);END IF;
 INSERT INTO public.ca_promo_event_realization_receipts VALUES(l.id,s.tournament_id,CASE WHEN p_destination='player_wallet' THEN l.club_id ELSE s.earning_club_id END,s.user_id,l.amount,0);
 FOR b IN SELECT x.earning_receipt_id,x.grant_id,x.charge_ledger_id,sum(x.principal_amount) principal_amount,g.granted_at FROM public.fn_ca_promo_profit_event_cells(s.source_id) x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id WHERE x.principal_amount>0 GROUP BY x.earning_receipt_id,x.grant_id,x.charge_ledger_id,g.granted_at ORDER BY x.earning_receipt_id,g.granted_at,x.grant_id,x.charge_ledger_id LOOP
  leftover:=b.principal_amount;
  SELECT charge_ledger_ids INTO STRICT prefix FROM public.ca_promo_profit_earning_source_slices WHERE source_id=s.source_id AND earning_receipt_id=b.earning_receipt_id;
  FOR r IN SELECT lot.*,g.club_id,g.user_id FROM public.ca_promo_event_principal_lots lot JOIN public.ca_promo_play_through_grants g ON g.id=lot.grant_id
   WHERE lot.tournament_id=s.tournament_id AND lot.grant_id=b.grant_id AND lot.charge_ledger_id=b.charge_ledger_id AND lot.remaining>0 AND g.closed_at IS NULL AND g.user_id=s.user_id
   ORDER BY lot.source_ref,lot.id FOR UPDATE OF lot,g NOWAIT LOOP
   EXIT WHEN leftover<=0;
   IF p_destination='player_wallet' AND r.club_id<>l.club_id THEN RAISE EXCEPTION 'original_event_P_physical_wallet_scope_mismatch';END IF;
   n:=LEAST(leftover,r.remaining);
   UPDATE public.ca_promo_principal_custody SET amount=amount-n WHERE grant_id=r.grant_id AND kind='event' AND entity_id=s.tournament_id AND amount>=n;
   IF NOT FOUND THEN RAISE EXCEPTION 'original_event_P_capital_missing';END IF;
   INSERT INTO public.ca_promo_principal_custody VALUES(r.grant_id,p_destination,p_destination_id,n)
   ON CONFLICT(grant_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_principal_custody.amount+EXCLUDED.amount;
   UPDATE public.ca_promo_event_principal_lots SET remaining=remaining-n WHERE id=r.id;
   INSERT INTO public.ca_promo_profit_event_principal_returns VALUES(l.id,b.earning_receipt_id,r.grant_id,r.charge_ledger_id,n);
   INSERT INTO public.ca_promo_event_realization_slices VALUES(l.id,r.grant_id,n) ON CONFLICT(ledger_id,grant_id) DO UPDATE SET amount=public.ca_promo_event_realization_slices.amount+EXCLUDED.amount;
   total:=total+n;leftover:=leftover-n;
  END LOOP;
 END LOOP;
 UPDATE public.ca_promo_event_realization_receipts SET principal=total WHERE ledger_id=l.id;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_return_event_principal(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_return_event_integrity(p_ledger uuid,p_source uuid,p_destination text,p_destination_id uuid) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;s record;b record;r record;o record;n numeric;only_return numeric;overlap_total numeric;overlap_return numeric;total numeric:=0;before_total numeric;physical_club uuid;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;SELECT * INTO STRICT s FROM public.ca_promo_profit_earning_sources WHERE source_id=p_source;
 IF EXISTS(SELECT 1 FROM public.ca_promo_integrity_event_receipts WHERE ledger_id=l.id) THEN RETURN(SELECT principal FROM public.ca_promo_integrity_event_receipts WHERE ledger_id=l.id);END IF;
 physical_club:=CASE WHEN p_destination='player_wallet' THEN l.club_id ELSE s.earning_club_id END;
 SELECT COALESCE(sum(x.remaining),0) INTO before_total FROM public.ca_promo_integrity_event_lots x WHERE x.tournament_id=s.tournament_id AND x.user_id=s.user_id AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id);
 FOR b IN SELECT x.earning_receipt_id,x.case_id,x.charge_ledger_id,sum(x.integrity_amount-x.overlap_amount) only_amount FROM public.fn_ca_promo_profit_event_cells(s.source_id)x WHERE x.integrity_amount>0 GROUP BY x.earning_receipt_id,x.case_id,x.charge_ledger_id ORDER BY 1,2,3 LOOP
  PERFORM 1 FROM public.ca_promo_integrity_cases WHERE id=b.case_id FOR UPDATE NOWAIT;
  SELECT * INTO r FROM public.ca_promo_integrity_event_lots x WHERE x.tournament_id=s.tournament_id AND x.user_id=s.user_id AND x.case_id=b.case_id AND x.charge_ledger_id=b.charge_ledger_id AND x.remaining>0 FOR UPDATE NOWAIT;
  IF NOT FOUND THEN CONTINUE;END IF;
  SELECT COALESCE(sum(x.remaining),0) INTO overlap_total FROM public.ca_promo_profit_event_overlap_lots x WHERE x.charge_ledger_id=r.charge_ledger_id AND x.case_id=r.case_id;
  IF overlap_total>r.remaining THEN RAISE EXCEPTION 'original_event_H_overlap_exceeds_capital';END IF;
  only_return:=LEAST(b.only_amount,r.remaining-overlap_total);overlap_return:=0;
  FOR o IN SELECT x.grant_id,sum(x.overlap_amount) amount FROM public.fn_ca_promo_profit_event_cells(s.source_id)x WHERE x.earning_receipt_id=b.earning_receipt_id AND x.case_id=b.case_id AND x.charge_ledger_id=b.charge_ledger_id AND x.overlap_amount>0 GROUP BY x.grant_id ORDER BY x.grant_id LOOP
   SELECT LEAST(o.amount,x.remaining) INTO n FROM public.ca_promo_profit_event_overlap_lots x WHERE x.charge_ledger_id=r.charge_ledger_id AND x.case_id=r.case_id AND x.grant_id=o.grant_id;
   IF n>0 THEN INSERT INTO public.ca_promo_profit_event_integrity_overlap_returns VALUES(l.id,b.earning_receipt_id,o.grant_id,r.case_id,r.charge_ledger_id,n);overlap_return:=overlap_return+n;END IF;
  END LOOP;
  n:=only_return+overlap_return;
  IF n<=0 THEN CONTINUE;END IF;
  UPDATE public.ca_promo_integrity_custody SET amount=amount-n WHERE case_id=r.case_id AND club_id=r.club_id AND user_id=r.user_id AND kind='event' AND entity_id=r.tournament_id AND amount>=n;
  IF NOT FOUND THEN RAISE EXCEPTION 'original_event_H_capital_missing';END IF;
  INSERT INTO public.ca_promo_integrity_custody VALUES(r.case_id,physical_club,s.user_id,p_destination,p_destination_id,n) ON CONFLICT(case_id,club_id,user_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_integrity_custody.amount+EXCLUDED.amount;
  UPDATE public.ca_promo_integrity_event_lots SET remaining=remaining-n WHERE case_id=r.case_id AND charge_ledger_id=r.charge_ledger_id;
  INSERT INTO public.ca_promo_profit_event_integrity_returns VALUES(l.id,b.earning_receipt_id,r.case_id,r.charge_ledger_id,r.club_id,n);total:=total+n;
 END LOOP;
 INSERT INTO public.ca_promo_integrity_event_receipts VALUES(l.id,total);
 IF p_destination<>'player_wallet' THEN INSERT INTO public.ca_promo_integrity_funding VALUES(l.id,before_total,total);IF p_destination='event' THEN PERFORM public.fn_ca_promo_integrity_record_event(l.id);END IF;END IF;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_return_event_integrity(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_return_entitlement_ticket(p_ledger uuid,p_user uuid) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;e public.tournament_refund_entitlements%ROWTYPE;r record;scope_club uuid;ticket_id uuid;
 total numeric:=0;held numeric:=0;n numeric;budget numeric;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 SELECT * INTO STRICT e FROM public.tournament_refund_entitlements WHERE id=NULLIF(l.metadata->>'entitlement_id','')::uuid;
 ticket_id:=NULLIF(l.metadata->>'ticket_id','')::uuid;
 IF EXISTS(SELECT 1 FROM public.ca_promo_event_realization_receipts x WHERE x.ledger_id=l.id AND x.tournament_id=e.tournament_id AND x.user_id=e.user_id AND x.amount=l.amount) THEN RETURN(SELECT principal FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id);END IF;
 IF l.metadata->>'kind'<>'tournament_entry_ticket_return' OR l.from_type<>'prize_liability' OR l.to_type<>'escrow' OR l.category<>'ticket_issue'
 OR l.from_entity_id IS DISTINCT FROM e.tournament_id OR l.to_entity_id IS DISTINCT FROM ticket_id OR l.amount IS DISTINCT FROM e.gross
 OR l.club_id IS DISTINCT FROM e.refund_wallet_club_id OR p_user IS DISTINCT FROM e.user_id OR l.metadata->>'user_id' IS DISTINCT FROM e.user_id::text
 OR NOT EXISTS(SELECT 1 FROM public.tournament_tickets t WHERE t.id=ticket_id AND t.holder_id=e.user_id AND t.club_id=e.refund_wallet_club_id
  AND t.source_refund_entitlement_id=e.id AND t.value=e.gross AND t.redemption_mode='tournament_entry_only') THEN
  RAISE EXCEPTION 'original_returned_entitlement_ticket_identity_invalid';END IF;
 PERFORM public.fn_ca_promo_profit_restore_returned_ticket_costs(l.id,e.id,ticket_id);
 SELECT f.club_id INTO scope_club FROM public.ca_promo_event_fee_consumption_receipts f WHERE f.charge_ledger_id=e.source_ledger_id AND f.entitlement_id=e.id AND f.player_id=e.user_id;
 IF scope_club IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.ca_promo_event_principal_lots x WHERE x.charge_ledger_id=e.source_ledger_id AND x.remaining>0)
   OR EXISTS(SELECT 1 FROM public.ca_promo_integrity_event_lots x WHERE x.charge_ledger_id=e.source_ledger_id AND x.remaining>0) THEN
   RAISE EXCEPTION 'original_returned_entitlement_ticket_source_scope_missing';END IF;
  scope_club:=l.club_id;
 END IF;
 PERFORM public.fn_ca_promo_play_through_settle(scope_club,e.user_id);
 INSERT INTO public.ca_promo_event_realization_receipts VALUES(l.id,e.tournament_id,scope_club,e.user_id,l.amount,0);
 SELECT CASE WHEN t.status='issued' THEN t.value ELSE 0 END INTO STRICT budget FROM public.tournament_tickets t WHERE t.id=ticket_id;
 FOR r IN SELECT x.*,g.club_id,g.user_id FROM public.ca_promo_event_principal_lots x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id
  WHERE x.charge_ledger_id=e.source_ledger_id AND x.tournament_id=e.tournament_id AND g.club_id=scope_club AND g.user_id=e.user_id AND g.closed_at IS NULL AND x.remaining>0
  ORDER BY x.id FOR UPDATE OF x,g NOWAIT LOOP
  EXIT WHEN budget<=0;n:=LEAST(budget,r.remaining);
  UPDATE public.ca_promo_principal_custody SET amount=amount-n WHERE grant_id=r.grant_id AND kind='event' AND entity_id=e.tournament_id AND amount>=n;
  IF NOT FOUND THEN RAISE EXCEPTION 'original_returned_ticket_P_missing';END IF;
  INSERT INTO public.ca_promo_principal_custody VALUES(r.grant_id,'ticket',ticket_id,n) ON CONFLICT(grant_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_principal_custody.amount+EXCLUDED.amount;
  UPDATE public.ca_promo_event_principal_lots SET remaining=remaining-n WHERE id=r.id;
  INSERT INTO public.ca_promo_event_realization_slices VALUES(l.id,r.grant_id,n) ON CONFLICT(ledger_id,grant_id) DO UPDATE SET amount=public.ca_promo_event_realization_slices.amount+EXCLUDED.amount;
  INSERT INTO public.ca_promo_profit_event_principal_returns VALUES(l.id,e.id,r.grant_id,e.source_ledger_id,n);
  total:=total+n;budget:=budget-n;
 END LOOP;
 UPDATE public.ca_promo_event_realization_receipts SET principal=total WHERE ledger_id=l.id;
 FOR r IN SELECT x.* FROM public.ca_promo_integrity_event_lots x WHERE x.charge_ledger_id=e.source_ledger_id AND x.tournament_id=e.tournament_id AND x.user_id=e.user_id AND x.remaining>0
  AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id) ORDER BY x.case_id FOR UPDATE NOWAIT LOOP
  EXIT WHEN budget<=0;PERFORM 1 FROM public.ca_promo_integrity_cases WHERE id=r.case_id FOR UPDATE NOWAIT;n:=LEAST(budget,r.remaining);
  UPDATE public.ca_promo_integrity_custody SET amount=amount-n WHERE case_id=r.case_id AND club_id=r.club_id AND user_id=e.user_id AND kind='event' AND entity_id=e.tournament_id AND amount>=n;
  IF NOT FOUND THEN RAISE EXCEPTION 'original_returned_ticket_H_missing';END IF;
  INSERT INTO public.ca_promo_integrity_custody VALUES(r.case_id,scope_club,e.user_id,'ticket',ticket_id,n)
   ON CONFLICT(case_id,club_id,user_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_integrity_custody.amount+EXCLUDED.amount;
  UPDATE public.ca_promo_integrity_event_lots SET remaining=remaining-n WHERE charge_ledger_id=e.source_ledger_id AND case_id=r.case_id;
  INSERT INTO public.ca_promo_profit_event_integrity_returns VALUES(l.id,e.id,r.case_id,e.source_ledger_id,r.club_id,n);
  held:=held+n;budget:=budget-n;
 END LOOP;
 INSERT INTO public.ca_promo_integrity_event_receipts VALUES(l.id,held);
 INSERT INTO public.ca_promo_integrity_funding VALUES(l.id,held,held);
 PERFORM public.fn_ca_promo_profit_realize_event(l.id,NULL,'ticket',ticket_id);
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_return_entitlement_ticket(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_project_earning(p_ledger uuid,p_source uuid,p_destination text,p_destination_id uuid) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE principal numeric;held numeric;
BEGIN
 principal:=public.fn_ca_promo_profit_return_event_principal(p_ledger,p_source,p_destination,p_destination_id);
 held:=public.fn_ca_promo_profit_return_event_integrity(p_ledger,p_source,p_destination,p_destination_id);
 -- W owner consumes exact P/H return receipts, moves existing W/WH capital,
 -- then aggregates new W once per original grant/actual ledger.
 PERFORM public.fn_ca_promo_profit_realize_event(p_ledger,p_source,p_destination,p_destination_id);
 RETURN principal;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_project_earning(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $original_event_projection$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_realize_event_principal(uuid)'::regprocedure) INTO def;
 def:=replace(def,'DECLARE l public.chip_ledger%ROWTYPE;','DECLARE source_id uuid;l public.chip_ledger%ROWTYPE;');
 needle:=' SELECT * INTO l FROM public.chip_ledger WHERE id=p_ledger_id;';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_event_P_source_projection_anchor_changed';END IF;
 def:=replace(def,needle,needle||E'\n IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) AND l.category IN(''tournament_prize'',''bounty'') THEN\n  source_id:=public.fn_ca_promo_profit_bind_earning_ledger(l.id);\n  IF source_id IS NOT NULL THEN RETURN public.fn_ca_promo_profit_project_earning(l.id,source_id,''player_wallet'',l.to_entity_id);END IF;\n END IF;');
 EXECUTE def;
 SELECT pg_get_functiondef('public.fn_ca_promo_roll_event_principal(uuid,uuid,text)'::regprocedure) INTO def;
 def:=replace(def,'DECLARE l public.chip_ledger%ROWTYPE;','DECLARE source_id uuid;l public.chip_ledger%ROWTYPE;');
 needle:=' SELECT * INTO l FROM public.chip_ledger WHERE id=p_ledger_id;';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_noncash_P_source_projection_anchor_changed';END IF;
 EXECUTE replace(def,needle,needle||E'\n IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) THEN\n  IF l.metadata->>''kind''=''tournament_entry_ticket_return'' THEN RETURN public.fn_ca_promo_profit_return_entitlement_ticket(l.id,p_user);END IF;\n  source_id:=public.fn_ca_promo_profit_bind_nonwallet_earning(l.id,p_user);\n  IF source_id IS NOT NULL THEN RETURN public.fn_ca_promo_profit_project_earning(l.id,source_id,p_destination,CASE WHEN p_destination=''ticket'' THEN COALESCE(NULLIF(l.metadata->>''ticket_id'','''')::uuid,l.to_entity_id) ELSE l.to_entity_id END);END IF;\n END IF;');
END $original_event_projection$;

-- Exact refund destination can differ from its frozen entry earning scope.
-- Original no-owned-H fast path and full-refund authority remain intact.
DO $original_H_refund_scope$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_integrity_realize_event(uuid)'::regprocedure) INTO def;
 def:=replace(def,'DECLARE l public.chip_ledger%ROWTYPE;','DECLARE source_club uuid;l public.chip_ledger%ROWTYPE;');
 needle:=' SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_H_refund_scope_anchor_changed';END IF;
 def:=replace(def,needle,needle||$scope$
 source_club:=l.club_id;
 IF l.category IN('refund','tournament_refund') AND NULLIF(current_setting('app.ca_promo_refund_entitlement',true),'') IS NOT NULL THEN
  SELECT f.club_id INTO source_club FROM public.tournament_refund_entitlements original
   JOIN public.ca_promo_event_fee_consumption_receipts f ON f.entitlement_id=original.id AND f.charge_ledger_id=original.source_ledger_id
   WHERE original.id=NULLIF(current_setting('app.ca_promo_refund_entitlement',true),'')::uuid
    AND original.tournament_id=l.from_entity_id AND original.user_id=l.to_entity_id AND original.refund_wallet_club_id=l.club_id
    AND f.player_id=original.user_id AND f.charge_amount=original.gross;
  IF source_club IS NULL THEN
   IF EXISTS(SELECT 1 FROM public.ca_promo_integrity_event_lots x JOIN public.tournament_refund_entitlements original ON original.source_ledger_id=x.charge_ledger_id
    WHERE original.id=NULLIF(current_setting('app.ca_promo_refund_entitlement',true),'')::uuid AND original.tournament_id=l.from_entity_id AND original.user_id=l.to_entity_id AND x.remaining>0
     AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id)) THEN RAISE EXCEPTION 'original_H_refund_earning_scope_missing';END IF;
   source_club:=l.club_id;
  END IF;
 END IF;
$scope$);
 def:=replace(def,'x.club_id=l.club_id','x.club_id=source_club');
 needle:='WHERE case_id=r.case_id AND club_id=l.club_id';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_H_refund_source_update_anchor_changed';END IF;
 def:=replace(def,needle,'WHERE case_id=r.case_id AND club_id=source_club');
 -- Destination INSERT still uses l.club_id: never move physical money scopes
 -- back to an earning club just because the original case was created there.
 needle:=' INSERT INTO public.ca_promo_integrity_event_receipts VALUES(l.id,total);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_H_refund_W_return_anchor_changed';END IF;
 EXECUTE def;
 SELECT pg_get_functiondef('public.fn_ca_promo_custody_on_ledger()'::regprocedure) INTO def;
 needle:='PERFORM public.fn_ca_promo_integrity_realize_event(NEW.id);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_W_refund_whole_H_owner_anchor_changed';END IF;
 EXECUTE replace(def,needle,needle||E'\n IF NEW.category IN(''refund'',''tournament_refund'') THEN PERFORM public.fn_ca_promo_profit_realize_event(NEW.id,NULL,''player_wallet'',NEW.to_entity_id);END IF;');
END $original_H_refund_scope$;

-- Existing earned ticket capital follows the exact original ticket, not a new
-- source earning or a new gift. W owner provides before/after W/O snapshots.
DO $original_ticket_entry_W$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_nonwallet_entry()'::regprocedure) INTO def;
 needle:='  PERFORM public.fn_ca_promo_play_through_settle(earning_club,uid);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_ticket_W_snapshot_anchor_changed';END IF;
 def:=replace(def,needle,needle||E'\n  PERFORM public.fn_ca_promo_profit_snapshot_ticket(NEW.id);');
 needle:='PERFORM public.fn_ca_promo_integrity_roll_source(NEW.id,uid,promo);';
 -- The first of the existing occurrences is exact escrow->event redemption.
 -- Replace only the first, leaving newly earned awards to source projection.
 IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'original_ticket_W_apply_anchor_changed';END IF;
 def:=overlay(def placing needle||E'\n  PERFORM public.fn_ca_promo_profit_apply_ticket(NEW.id,''event'',NEW.to_entity_id);' from strpos(def,needle) for length(needle));
 EXECUTE def;
END $original_ticket_entry_W$;

-- Full original ticket H follows its exact physical custody owner; original
-- integrity_move also carries the already proved W/H intersection once.
DO $original_ticket_H_scope$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_integrity_roll_source(uuid,uuid,numeric)'::regprocedure) INTO def;
 needle:=$old$  held:=public.fn_ca_promo_integrity_locked_at(scope_club,p_user,'ticket',l.from_entity_id);
  total:=public.fn_ca_promo_integrity_move(scope_club,p_user,'ticket',l.from_entity_id,'event',l.to_entity_id,LEAST(held,remaining_credit));$old$;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_ticket_H_scope_anchor_changed';END IF;
 EXECUTE replace(def,needle,$new$  held:=0;
  FOR r IN SELECT x.club_id,sum(x.amount) amount FROM public.ca_promo_integrity_custody x WHERE x.user_id=p_user AND x.kind='ticket' AND x.entity_id=l.from_entity_id AND x.amount>0
   AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id) GROUP BY x.club_id ORDER BY x.club_id LOOP
   IF r.amount>remaining_credit-total THEN RAISE EXCEPTION 'original_ticket_H_exceeds_exact_ticket_capital';END IF;
   held:=held+r.amount;
   total:=total+public.fn_ca_promo_integrity_move(r.club_id,p_user,'ticket',l.from_entity_id,'event',l.to_entity_id,r.amount,scope_club,p_user);
  END LOOP;$new$);
END $original_ticket_H_scope$;

-- END ORIGINAL TOURNAMENT EARNING PROJECTION

-- Exact unpaid source qualification for terminal capital retirement.
-- PL/pgSQL keeps190221 install safe before200638. No mutable cache/debt.
CREATE FUNCTION public.fn_ca_promo_profit_event_charge_is_owed(p_charge uuid,p_tournament uuid,p_user uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF to_regclass('public.ca_promo_profit_obligation_earnings') IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) THEN
   RAISE EXCEPTION 'original_tournament_earning_source_contract_missing';
  END IF;
  RETURN false;
 END IF;
 RETURN EXISTS(
  SELECT 1 FROM public.ca_promo_profit_obligation_earnings e JOIN public.tournament_obligations o ON o.id=e.obligation_id
  WHERE e.tournament_id=p_tournament AND e.user_id=p_user AND p_charge=ANY(e.charge_ledger_ids)
   AND o.tournament_id=e.tournament_id AND o.user_id=e.user_id AND o.terminal_closed_at IS NULL
   AND o.amount_owed>o.amount_paid AND e.amount_to>o.amount_paid AND e.amount_from<o.amount_owed
 ) OR EXISTS(
  SELECT 1 FROM public.ca_promo_profit_obligation_earnings e
   JOIN public.ca_promo_profit_earning_source_slices slice ON slice.earning_receipt_id=e.id
   JOIN public.ca_promo_profit_earning_sources source ON source.source_id=slice.source_id
  WHERE e.obligation_id IS NULL AND e.source_kind='satellite_award'
   AND e.tournament_id=p_tournament AND e.user_id=p_user AND p_charge=ANY(slice.charge_ledger_ids)
   AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_earning_credit_links credit WHERE credit.source_id=source.source_id)
 );
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_event_charge_is_owed(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.ca_promo_event_terminal_loss_slices (
 tournament_id uuid NOT NULL,lot_id uuid NOT NULL REFERENCES public.ca_promo_event_principal_lots(id),grant_id uuid NOT NULL REFERENCES public.ca_promo_play_through_grants(id),
 charge_ledger_id uuid NOT NULL,club_id uuid NOT NULL,user_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>0 AND amount=round(amount,2)),terminal_status text NOT NULL CHECK(terminal_status IN('COMPLETED','CANCELLED','CANCELED')),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(tournament_id,lot_id)
);
CREATE INDEX ca_promo_terminal_loss_charge ON public.ca_promo_event_terminal_loss_slices(charge_ledger_id,grant_id);
ALTER TABLE public.ca_promo_event_terminal_loss_slices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_event_terminal_loss_slices FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_event_terminal_loss_slices TO service_role;
CREATE TRIGGER original_terminal_P_loss_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_event_terminal_loss_slices FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER original_terminal_P_loss_no_truncate BEFORE TRUNCATE ON public.ca_promo_event_terminal_loss_slices FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();

-- Bust and terminal retirement are disjoint exact lot spends. UNION also
-- deduplicates the same immutable identity if both original witnesses exist.
CREATE VIEW public.ca_promo_original_entry_loss_basis AS
 SELECT lot_id,grant_id,charge_ledger_id,amount FROM public.ca_promo_event_entry_loss_slices
 UNION SELECT lot_id,grant_id,charge_ledger_id,amount FROM public.ca_promo_event_terminal_loss_slices;
REVOKE ALL ON public.ca_promo_original_entry_loss_basis FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_original_entry_loss_basis TO service_role;
DO $terminal_refund_consumers$
DECLARE signature text;definition text;needle text:='JOIN public.ca_promo_event_entry_loss_slices fs';
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.fn_ca_promo_return_principal(uuid,text,text,numeric,text)','public.fn_ca_promo_return_spent_event_fee(uuid)'] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
  IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_terminal_refund_consumer_anchor_changed: %',signature;END IF;
  EXECUTE replace(definition,needle,'JOIN public.ca_promo_original_entry_loss_basis fs');
 END LOOP;
END $terminal_refund_consumers$;

CREATE FUNCTION public.fn_ca_promo_profit_cleanup_settled_event(p_tournament uuid,p_user uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record;o record;n numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id=p_tournament AND upper(status) IN('COMPLETED','CANCELLED','CANCELED')) THEN RETURN;END IF;
 FOR r IN SELECT lot.id,lot.grant_id,lot.charge_ledger_id,lot.remaining,g.club_id,g.user_id FROM public.ca_promo_event_principal_lots lot JOIN public.ca_promo_play_through_grants g ON g.id=lot.grant_id AND g.closed_at IS NULL WHERE lot.tournament_id=p_tournament AND lot.remaining>0 AND (p_user IS NULL OR g.user_id=p_user) ORDER BY g.granted_at,g.id,lot.id FOR UPDATE OF lot,g NOWAIT LOOP
  IF public.fn_ca_promo_profit_event_charge_is_owed(r.charge_ledger_id,p_tournament,r.user_id) THEN CONTINUE;END IF;
  IF r.charge_ledger_id IS NULL THEN RAISE EXCEPTION 'original_terminal_promo_source_charge_missing';END IF;
  INSERT INTO public.ca_promo_event_terminal_loss_slices(tournament_id,lot_id,grant_id,charge_ledger_id,club_id,user_id,amount,terminal_status)
   SELECT p_tournament,r.id,r.grant_id,r.charge_ledger_id,r.club_id,r.user_id,r.remaining,upper(t.status) FROM public.tournaments t WHERE t.id=p_tournament;
  UPDATE public.ca_promo_principal_custody SET amount=amount-r.remaining WHERE grant_id=r.grant_id AND kind='event' AND entity_id=p_tournament AND amount>=r.remaining;
  IF NOT FOUND THEN RAISE EXCEPTION 'original_settled_event_P_capital_missing';END IF;
  UPDATE public.ca_promo_event_principal_lots SET remaining=0 WHERE id=r.id;
  UPDATE public.ca_promo_play_through_grants SET remaining=remaining-r.remaining,closed_at=CASE WHEN remaining=r.remaining THEN clock_timestamp() ELSE NULL END,close_reason=CASE WHEN remaining=r.remaining THEN 'spent' ELSE NULL END WHERE id=r.grant_id AND closed_at IS NULL;
 END LOOP;
 FOR r IN SELECT x.* FROM public.ca_promo_integrity_event_lots x WHERE x.tournament_id=p_tournament AND x.remaining>0 AND (p_user IS NULL OR x.user_id=p_user) ORDER BY x.club_id,x.user_id,x.charge_ledger_id,x.case_id LOOP
  IF public.fn_ca_promo_profit_event_charge_is_owed(r.charge_ledger_id,p_tournament,r.user_id) THEN CONTINUE;END IF;
  PERFORM public.fn_ca_promo_integrity_retire_event_lots(p_tournament,r.club_id,r.user_id,ARRAY[r.charge_ledger_id],'terminal',p_tournament);
 END LOOP;
 FOR r IN SELECT x.* FROM public.ca_promo_profit_event_lots x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id WHERE x.tournament_id=p_tournament AND x.remaining>0 AND (p_user IS NULL OR x.user_id=p_user) ORDER BY g.granted_at,g.id,x.charge_ledger_id FOR UPDATE OF x NOWAIT LOOP
  IF public.fn_ca_promo_profit_event_charge_is_owed(r.charge_ledger_id,p_tournament,r.user_id) THEN CONTINUE;END IF;
  FOR o IN SELECT * FROM public.ca_promo_profit_event_overlap_lots WHERE grant_id=r.grant_id AND charge_ledger_id=r.charge_ledger_id AND remaining>0 ORDER BY case_id FOR UPDATE NOWAIT LOOP
   UPDATE public.ca_promo_profit_integrity_overlap SET amount=amount-o.remaining WHERE grant_id=r.grant_id AND case_id=o.case_id AND club_id=r.club_id AND user_id=r.user_id AND kind='event' AND entity_id=p_tournament AND amount>=o.remaining;
   IF NOT FOUND THEN RAISE EXCEPTION 'original_settled_event_W_overlap_missing';END IF;
   INSERT INTO public.ca_promo_profit_entry_loss_overlap_slices VALUES(p_tournament,r.charge_ledger_id,r.grant_id,o.case_id,o.remaining);
   UPDATE public.ca_promo_profit_event_overlap_lots SET remaining=0 WHERE grant_id=r.grant_id AND charge_ledger_id=r.charge_ledger_id AND case_id=o.case_id;
  END LOOP;
  INSERT INTO public.ca_promo_profit_entry_loss_slices VALUES(p_tournament,r.charge_ledger_id,r.grant_id,r.remaining);
  UPDATE public.ca_promo_profit_event_lots SET remaining=0 WHERE grant_id=r.grant_id AND charge_ledger_id=r.charge_ledger_id;
  PERFORM public.fn_ca_promo_profit_move_grant(r.grant_id,r.club_id,r.user_id,'event',p_tournament,NULL,NULL,r.remaining);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_cleanup_settled_event(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_profit_after_obligation_settles() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 PERFORM public.fn_ca_promo_profit_cleanup_settled_event(NEW.tournament_id,NEW.user_id);RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_after_obligation_settles() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER zzzz_promo_original_obligation_capital AFTER UPDATE OF amount_paid,terminal_closed_at ON public.tournament_obligations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_after_obligation_settles();
DO $original_terminal_capital_rights$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_finish_event_principal()'::regprocedure) INTO def;
 needle:=' FOR r IN SELECT DISTINCT g.id,g.club_id,g.user_id,g.granted_at FROM public.ca_promo_event_principal_lots lot';
 IF position(needle in def)=0 THEN RAISE EXCEPTION 'original_terminal_P_owner_changed';END IF;
 -- Preserve the original status guard and Free Buy exhaustion witness. Replace
 -- only its source-capital retirement with the exact unpaid-source decision.
 def:=left(def,position(needle in def)-1)||E' PERFORM public.fn_ca_promo_profit_cleanup_settled_event(NEW.id);\n RETURN NULL;\nEND $function$';
 EXECUTE def;
END $original_terminal_capital_rights$;

-- Programme activation requires the original earning-generation producer in
-- 200638 and all existing cash, fee, ticket, notice and custody contracts.
COMMIT;
