-- An independently fixed board. Union U has the production policy (minimum
-- agent commission 0.20). Clubs:
--   D  union club, owner OD has NO agents row      (Deep Stack Society's shape)
--   E  the same shape, kept without a row for the creation cases
--   K  union club, owner OK ACTIVE 0.30 / 0.20     (Kings Club's shape)
--   S  union club, owner OS SUSPENDED 0.20 / 0.00
--   N  a club with no owner
--   X  standalone club (no union), owner OX, no row
INSERT INTO public.profiles(id,username) SELECT orw_u(n),n FROM unnest(ARRAY['UO','OD','OE','OK','OS','OX','P1','P2','P3','P4','ST','A1','A2','PE1','PK1','PX1']) n;
INSERT INTO public.unions(id,owner_id,settings) VALUES(orw_u('U'),orw_u('UO'),'{"min_agent_commission":0.20,"max_agent_commission":0.70}');
INSERT INTO public.clubs(id,name,owner_id,chip_treasury) VALUES
 (orw_u('D'),'D',orw_u('OD'),10000),(orw_u('E'),'E',orw_u('OE'),10000),(orw_u('K'),'K',orw_u('OK'),10000),
 (orw_u('S'),'S',orw_u('OS'),10000),(orw_u('N'),'N',NULL,10000),(orw_u('X'),'X',orw_u('OX'),10000);
INSERT INTO public.union_clubs(club_id,union_id,club_commission_rate) SELECT orw_u(c),orw_u('U'),0.90 FROM unnest(ARRAY['D','E','K','S','N']) c;
INSERT INTO public.club_members(club_id,user_id,role,agent_id,player_rakeback_pct,player_rakeback_explicit) VALUES
 (orw_u('D'),orw_u('OD'),'owner',NULL,0,false),
 (orw_u('D'),orw_u('P1'),'player',orw_u('OD'),0,false),
 (orw_u('D'),orw_u('P2'),'player',orw_u('OD'),0.70,true),
 (orw_u('D'),orw_u('P3'),'player',NULL,0,false),
 (orw_u('D'),orw_u('A1'),'agent',NULL,0,false),
 (orw_u('D'),orw_u('A2'),'agent',NULL,0,false),
 (orw_u('D'),orw_u('P4'),'player',orw_u('A1'),0,false),
 (orw_u('D'),orw_u('ST'),'co_owner',NULL,0,false),
 (orw_u('E'),orw_u('OE'),'owner',NULL,0,false),
 (orw_u('E'),orw_u('PE1'),'player',orw_u('OE'),0,false),
 (orw_u('K'),orw_u('OK'),'owner',NULL,0,false),
 (orw_u('K'),orw_u('PK1'),'player',orw_u('OK'),0,false),
 (orw_u('S'),orw_u('OS'),'owner',NULL,0,false),
 (orw_u('X'),orw_u('OX'),'owner',NULL,0,false),
 (orw_u('X'),orw_u('PX1'),'player',orw_u('OX'),0,false);
INSERT INTO public.agents(user_id,club_id,role,status,commission_rate,player_rakeback_rate) VALUES
 (orw_u('A1'),orw_u('D'),'agent','active',0.30,0.10),
 (orw_u('OK'),orw_u('K'),'agent','active',0.30,0.20),
 (orw_u('OS'),orw_u('S'),'super_agent','active',0.20,0.00);
UPDATE public.agents SET status='suspended' WHERE user_id=orw_u('OS');

-- What every earning reader answers for a set of players, as one document.
CREATE FUNCTION public.orw_entitlements(p_club text,p_players text[],p_at timestamptz) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_object_agg(p,jsonb_build_object(
   'contract',public.fn_accounting_earning_contract(orw_u(p_club),orw_u(p),100.00,CASE WHEN p_club='X' THEN NULL ELSE orw_u('U') END,p_at)-'terms_at',
   'rate_0',public.fn_player_rakeback_rate(orw_u(p),orw_u(p_club),0),
   'rate_600',public.fn_player_rakeback_rate(orw_u(p),orw_u(p_club),600),
   'rate_20000',public.fn_player_rakeback_rate(orw_u(p),orw_u(p_club),20000)))
 FROM unnest(p_players) p $$;
CREATE FUNCTION public.orw_terms_error(p_club text,p_user text,p_at timestamptz) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM public.fn_accounting_agent_terms_at(orw_u(p_club),orw_u(p_user),p_at); RETURN 'honoured';
EXCEPTION WHEN SQLSTATE '55000' THEN RETURN SQLERRM; END $$;
CREATE FUNCTION public.orw_money() RETURNS text LANGUAGE sql AS $$
 SELECT md5(COALESCE((SELECT string_agg(to_jsonb(a)::text,'|' ORDER BY a.id) FROM public.agents a),'')
  ||(SELECT string_agg(c.id||':'||c.chip_treasury||':'||COALESCE(c.owner_id::text,''),'|' ORDER BY c.id) FROM public.clubs c)
  ||(SELECT string_agg(m.club_id||':'||m.user_id||':'||m.chip_balance||':'||m.role,'|' ORDER BY m.club_id,m.user_id) FROM public.club_members m)
  ||(SELECT count(*) FROM public.chip_ledger)||':'||(SELECT count(*) FROM public.chip_transactions)||':'||(SELECT count(*) FROM public.accounting_agreement_history)) $$;
-- The installed round 3 payment leg (fn_settle_accounting_rakeback_stage
-- 21409a0d, lines 356-361 and 381-387): autoskip on, the payer's agent wallet
-- debited by (club_id, user_id) with no status filter, the player credited,
-- and the stage's own journal leg.
CREATE FUNCTION public.orw_round3_leg(p_club text,p_payer text,p_player text,amount numeric,p_journal boolean DEFAULT true) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE payer_after numeric; player_after numeric;
BEGIN
 PERFORM set_config('app.ledger_autoskip_clubs','1',true);PERFORM set_config('app.ledger_autoskip_club_members','1',true);PERFORM set_config('app.ledger_autoskip_agents','1',true);
 UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance-amount,updated_at=now() WHERE club_id=orw_u(p_club) AND user_id=orw_u(p_payer) AND agent_wallet_balance>=amount RETURNING agent_wallet_balance INTO payer_after;
 IF payer_after IS NULL THEN
  PERFORM set_config('app.ledger_autoskip_clubs','',true);PERFORM set_config('app.ledger_autoskip_club_members','',true);PERFORM set_config('app.ledger_autoskip_agents','',true);
  RETURN NULL; END IF;
 UPDATE public.club_members SET chip_balance=chip_balance+amount,updated_at=now() WHERE club_id=orw_u(p_club) AND user_id=orw_u(p_player) RETURNING chip_balance INTO player_after;
 IF p_journal THEN
  INSERT INTO public.chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,description)
  VALUES('agent_wallet',orw_u(p_payer),'player_wallet',orw_u(p_player),amount,'rakeback',orw_u(p_club),'Weekly rakeback');
 END IF;
 PERFORM set_config('app.ledger_autoskip_clubs','',true);PERFORM set_config('app.ledger_autoskip_club_members','',true);PERFORM set_config('app.ledger_autoskip_agents','',true);
 RETURN payer_after;
END $$;
CREATE FUNCTION public.orw_as(p_user text) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',orw_u(p_user)::text,true), set_config('request.jwt.claim.role','authenticated',true);
 SELECT set_config('request.jwt.claims',jsonb_build_object('sub',orw_u(p_user),'role','authenticated')::text,true) $$;
CREATE FUNCTION public.orw_wallet(p_club text,p_user text) RETURNS public.agents LANGUAGE sql AS $$
 SELECT a FROM public.agents a WHERE a.club_id=orw_u(p_club) AND a.user_id=orw_u(p_user) $$;
