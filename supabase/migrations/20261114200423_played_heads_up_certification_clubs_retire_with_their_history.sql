-- Cert HU clubs retain completed matches and their accounting history.
-- Their daily welcome schedule continued to spawn empty freezeouts because the
-- unused-package unwind includes the completed HU matches in its no-play check.
-- A service-only retirement transaction isolates those terminal matches. It uses
-- the installed package unwind and the normal settled-club retirement authority.
-- @live-proof: to_regprocedure('public.fn_ca_retire_heads_up_fixture(uuid,text)') IS NOT NULL
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

-- Give only the private retirement call a parameter for proved terminal history.
-- Preserve the public two-argument unwind and every existing caller verbatim.
DO $patch$
DECLARE
  original text := pg_get_functiondef('public.fn_unwind_unused_first_club_welcome_package(uuid,uuid)'::regprocedure);
  modified text;
  anchor text := '  SELECT COALESCE(array_agg(id ORDER BY id),''{}'') INTO v_tables';
BEGIN
  IF md5(original) <> '68a129330e900f837c4222b6a49ae470' THEN
    RAISE EXCEPTION 'Welcome unwind changed; requalify retirement';
  END IF;
  modified := replace(original,
    'public.fn_unwind_unused_first_club_welcome_package(p_club_id uuid, p_operation_id uuid)',
    'smarter_private.unwind_heads_up_fixture(p_club_id uuid, p_operation_id uuid, completed_ids uuid[])');
  -- Only remove exact, already-settled fixture games from the package graph.
  -- Earlier completed board generations are likewise outside its ambiguity count.
  modified := replace(modified, 'AND NOT ('
     || chr(10) || '         upper(COALESCE(t.status::text,'''')',
     'AND NOT (t.id = ANY(completed_ids)) AND NOT ('
     || chr(10) || '         upper(COALESCE(t.status::text,'''')');
  modified := replace(modified, anchor,
    '  v_tournaments := ARRAY(SELECT unnest(v_tournaments) EXCEPT SELECT unnest(completed_ids));'
    || chr(10) || anchor);
  IF position('smarter_private.unwind_heads_up_fixture(' in modified)=0
     OR position('t.id = ANY(completed_ids)' in modified)=0
     OR position('EXCEPT SELECT unnest(completed_ids)' in modified)=0 THEN
    RAISE EXCEPTION 'Welcome unwind anchors changed';
  END IF;
  INSERT INTO public.ca_money_rpc_registry(proname,status,notes) VALUES
    ('unwind_heads_up_fixture','system','Private fixture retirement only. Uses the qualified welcome unwind with completed certification matches excluded from the idle-board set.')
  ON CONFLICT (proname) DO NOTHING;
  EXECUTE modified;
END $patch$;
REVOKE ALL ON FUNCTION smarter_private.unwind_heads_up_fixture(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;

INSERT INTO public.ca_money_rpc_registry(proname,status,notes) VALUES
 ('fn_ca_retire_heads_up_fixture','system','Service-only terminal fixture retirement; prechecked owner and members, intact match conservation, receipted seed return, declared residual treasury retirement, zero-obligation core.')
ON CONFLICT (proname) DO NOTHING;

CREATE FUNCTION public.fn_ca_retire_heads_up_fixture(p_club_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $body$
DECLARE
 c public.clubs%ROWTYPE;
 matches uuid[];
 v_amount numeric;
 impact jsonb;
 result jsonb;
 resource uuid;
 prior_claims text := current_setting('request.jwt.claims',true);
 prior_sub text := current_setting('request.jwt.claim.sub',true);
BEGIN
 IF coalesce(auth.role(),'') <> 'service_role' AND session_user NOT IN ('postgres','supabase_admin') THEN
   RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501';
 END IF;
 -- Caller's existing retirement lane remains bounded. Refuse before any write.
 PERFORM smarter_private.cancellation_lane(p_club_id);
 SELECT * INTO STRICT c FROM public.clubs WHERE id=p_club_id FOR UPDATE;
 IF c.name !~ '^Cert HU [0-9]{8}$' OR c.asset IS DISTINCT FROM 'chips' OR c.union_id IS NOT NULL OR coalesce(c.is_union,false)
 OR EXISTS(SELECT FROM public.union_clubs WHERE club_id=c.id OR union_id=c.id)
 OR NOT EXISTS(SELECT FROM auth.users WHERE id=c.owner_id AND email LIKE 'ca-customization-cert-postdeploy-%@example.invalid')
 OR NOT EXISTS(SELECT FROM public.club_welcome_package_receipts WHERE club_id=c.id) THEN
   RAISE EXCEPTION 'Not a reserved heads-up fixture' USING ERRCODE='42501';
 END IF;
 IF c.lifecycle_status='retired' THEN RETURN jsonb_build_object('success',true,'already_retired',true); END IF;
 PERFORM 1 FROM public.club_members WHERE club_id=c.id ORDER BY id FOR UPDATE;
 IF NOT EXISTS(SELECT FROM public.club_members WHERE club_id=c.id AND user_id=c.owner_id)
 OR EXISTS(SELECT FROM public.club_members m LEFT JOIN auth.users u ON u.id=m.user_id
           WHERE m.club_id=c.id AND (coalesce(u.email,'') NOT LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
           OR m.chip_balance<>0 OR m.held_chips<>0 OR m.locked_chips<>0 OR m.credit_used<>0 OR m.promo_balance<>0))
 OR EXISTS(SELECT FROM public.agents WHERE club_id=c.id) THEN
   RAISE EXCEPTION 'Fixture membership or balance is unsettled';
 END IF;
 PERFORM 1 FROM public.tournaments WHERE club_id=c.id ORDER BY id FOR UPDATE;
 SELECT ARRAY(SELECT id FROM public.tournaments WHERE club_id=c.id AND status='COMPLETED') INTO matches;
 IF EXISTS(SELECT FROM public.tournaments t WHERE t.id=ANY(matches) AND
     (t.name IS DISTINCT FROM 'NLH Heads-Up 1 Turbo' OR t.tournament_type IS DISTINCT FROM 'SNG'
      OR t.max_players IS DISTINCT FROM 2 OR t.ended_at IS NULL
      OR public.fn_tournament_conservation_delta(t.id) IS DISTINCT FROM 0))
 OR EXISTS(SELECT FROM public.tournament_escrow e WHERE e.tournament_id=ANY(matches)
     AND (e.prize_balance IS DISTINCT FROM 0 OR e.bounty_balance IS DISTINCT FROM 0 OR e.fee_balance IS DISTINCT FROM 0))
 OR EXISTS(SELECT FROM public.tournament_players p JOIN public.tournaments t ON t.id=p.tournament_id
     WHERE t.club_id=c.id AND (NOT(t.id=ANY(matches)) OR NOT EXISTS
     (SELECT FROM public.club_members m WHERE m.club_id=c.id AND m.user_id=p.user_id)))
 OR EXISTS(SELECT FROM public.table_seats s JOIN public.tables t ON t.id=s.table_id
     WHERE t.club_id=c.id AND s.left_at IS NULL) THEN
   RAISE EXCEPTION 'Fixture play or settlement is unfinished';
 END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',c.owner_id,'role','service_role')::text,true);
 PERFORM set_config('request.jwt.claim.sub',c.owner_id::text,true);
 FOR resource IN SELECT t.id FROM public.tables t JOIN public.cash_games g ON g.id=t.cluster_id
   WHERE g.club_id=c.id AND lower(t.status) NOT IN ('closed','completed','cancelled','finished')
   AND NOT EXISTS(SELECT FROM public.club_welcome_package_items i WHERE i.club_id=c.id AND i.entity_id=g.id)
   ORDER BY t.id LOOP
   result := public.fn_close_managed_game('table',resource);
   IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Fixture table closure refused'; END IF;
 END LOOP;
 result := smarter_private.unwind_heads_up_fixture(c.id,gen_random_uuid(),matches);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Fixture package unwind refused'; END IF;
 SELECT chip_treasury INTO STRICT v_amount FROM public.clubs WHERE id=c.id;
 impact := public.fn_club_retirement_impact(c.id);
 IF (impact->>'wallet_chips')::numeric IS DISTINCT FROM v_amount OR v_amount NOT BETWEEN 0 AND 100000
 OR (impact->>'open_obligations')::bigint IS DISTINCT FROM 0
 OR (impact->>'diamonds')::numeric IS DISTINCT FROM 0
 OR (impact->>'inventory_items')::bigint IS DISTINCT FROM 0
 OR (impact->>'running_tables')::int IS DISTINCT FROM 0
 OR (impact->>'active_tournaments')::int IS DISTINCT FROM 0
 OR NOT EXISTS(SELECT FROM public.ca_mint_ledger WHERE op_id='club-opening-grant:'||c.id
   AND holder_id=c.id AND asset='chips' AND action='mint' AND amount=100000) THEN
   RAISE EXCEPTION 'Fixture residual treasury or obligations do not reconcile: %',impact;
 END IF;
 IF v_amount>0 THEN
   PERFORM public.fn_ca_declare_ledger('burn','chip_retirement',NULL,NULL,'cert-hu-retire:'||c.id,NULL);
   UPDATE public.clubs SET chip_treasury=0,updated_at=now() WHERE id=c.id AND chip_treasury=v_amount;
   IF NOT FOUND THEN RAISE EXCEPTION 'Fixture treasury changed'; END IF;
   PERFORM set_config('app.ledger_category','',true);
   PERFORM set_config('app.ledger_counterparty','',true);
 END IF;
 result := public.fn_retire_settled_club_core_20260906(c.id,c.name,p_reason);
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Fixture retirement refused: %',result; END IF;
 PERFORM set_config('request.jwt.claims',coalesce(prior_claims,''),true);
 PERFORM set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);
 RETURN result;
END $body$;
REVOKE ALL ON FUNCTION public.fn_ca_retire_heads_up_fixture(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_retire_heads_up_fixture(uuid,text) TO service_role;
COMMIT;
