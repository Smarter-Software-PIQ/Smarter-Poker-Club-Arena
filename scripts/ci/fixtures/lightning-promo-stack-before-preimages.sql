-- Production preimages captured 2026-11-24 16:20Z with pg_get_functiondef (project kuklfnapbkmacvwxktbh).
-- fn_ca_promo_profit_capture_cash md5 8f3eabe33981081836ea41f52b1781ef, fn_ca_promo_accept_cash_hand md5 3258b0c724583064132c74b5035f2793.
-- Read by scripts/ci/test-a-promo-player-lightning-hand-settles-postgres.py; each body ends with a line holding only ';'.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_integrity_locked_at(p_club uuid, p_user uuid, p_kind text, p_entity uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT COALESCE(sum(c.amount),0) FROM public.ca_promo_integrity_custody c
 WHERE c.club_id=p_club AND c.user_id=p_user AND c.kind=p_kind AND c.entity_id=p_entity AND c.amount>0
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases r WHERE r.case_id=c.case_id);
$function$
;
CREATE OR REPLACE FUNCTION public.fn_ca_promo_locked_at(p_club uuid, p_user uuid, p_kind text, p_entity uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.ca_promo_principal_custody c
      JOIN public.ca_promo_play_through_grants g ON g.id = c.grant_id
     WHERE g.club_id = p_club
       AND g.user_id = p_user
       AND g.closed_at IS NULL
       AND c.kind = p_kind
       AND c.entity_id = p_entity
       AND c.amount > 0
  ) THEN
    RETURN 0;
  END IF;

  RETURN (
    SELECT COALESCE(sum(c.amount), 0)
      FROM public.ca_promo_principal_custody c
      JOIN public.fn_ca_promo_play_through_state(p_club, p_user) s ON s.grant_id = c.grant_id
     WHERE c.kind = p_kind
       AND c.entity_id = p_entity
       AND s.state IN ('locked', 'expired_pending')
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_locked_at(p_club uuid, p_user uuid, p_kind text, p_entity uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT COALESCE(sum(c.amount),0) FROM public.ca_promo_profit_custody c
 JOIN public.ca_promo_profit_gates g ON g.grant_id=c.grant_id AND g.unlocked_at IS NULL
 WHERE c.club_id=p_club AND c.user_id=p_user AND c.kind=p_kind AND c.entity_id=p_entity
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=c.grant_id);
$function$
;
CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_overlap_at(p_club uuid, p_user uuid, p_kind text, p_entity uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT COALESCE(sum(o.amount),0) FROM public.ca_promo_profit_integrity_overlap o
 JOIN public.ca_promo_profit_gates g ON g.grant_id=o.grant_id AND g.unlocked_at IS NULL
 WHERE o.club_id=p_club AND o.user_id=p_user AND o.kind=p_kind AND o.entity_id=p_entity
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases r WHERE r.case_id=o.case_id)
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides z WHERE z.grant_id=o.grant_id);
$function$
;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_capture_cash(p_hand uuid, p_table uuid, p_stacks jsonb, p_facts jsonb, p_places jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$

;
CREATE OR REPLACE FUNCTION public.fn_ca_promo_accept_cash_hand(p_hand uuid, p_table uuid, p_stacks jsonb, p_facts jsonb, p_places jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s jsonb;r record;before_promo numeric;investment numeric;loss numeric;unused numeric;place uuid;ids uuid[];promo_investment numeric;
BEGIN
 IF EXISTS(SELECT 1 FROM public.tables WHERE id=p_table AND tournament_id IS NOT NULL) THEN
  IF to_regprocedure('public.fn_ca_promo_profit_capture_tournament_hand(uuid,uuid,jsonb)') IS NOT NULL THEN
   EXECUTE 'SELECT public.fn_ca_promo_profit_capture_tournament_hand($1::uuid,$2::uuid,$3::jsonb)' USING p_hand,p_table,p_stacks;
  ELSIF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL AND enforced_from<=clock_timestamp()) THEN
   RAISE EXCEPTION 'original_tournament_earning_source_contract_missing';
  END IF;
 END IF;
 PERFORM public.fn_ca_promo_profit_capture_cash(p_hand,p_table,p_stacks,p_facts,p_places);
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
   PERFORM public.fn_ca_promo_integrity_source_loss(p_hand,r.club_id,r.user_id,place,ids,loss);
   unused:=public.fn_ca_promo_move_selected_custody(r.club_id,r.user_id,'table_stack',place,NULL,NULL,loss,'spent',ids);
  END LOOP;
 END LOOP;
END $function$

;
