CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_fund_agent_shortfalls(p_run uuid, p_kind text, p_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE d_from date:=(p_from AT TIME ZONE 'America/Los_Angeles')::date; s record; res jsonb; out jsonb:='[]'::jsonb; saved text:=current_setting('request.jwt.claims',true); saved_sub text:=current_setting('request.jwt.claim.sub',true);
BEGIN
 FOR s IN
  WITH f AS (SELECT c.club_id, fp.payer_user, fp.owed FROM public.accounting_rakeback_period_calculations c JOIN public.rakeback_periods rp ON rp.id=c.period_id
    CROSS JOIN LATERAL smarter_private.rakeback_certificate_wallets(c.id) fp
    JOIN public.clubs cl ON cl.id=c.club_id
    WHERE rp.period_start=d_from AND rp.status='pending' AND c.payer_kind<>'club'
     AND ((p_kind='union' AND c.coordinator_union_id=p_id) OR (p_kind='club' AND c.club_id=p_id AND c.coordinator_union_id IS NULL))
     AND fp.payer_kind<>'club' AND fp.payer_user IS NOT NULL AND fp.payer_user<>cl.owner_id AND fp.owed>0)
  SELECT f.club_id, f.payer_user, round(sum(f.owed),2) owed, a.agent_wallet_balance bal, cl.owner_id
  FROM f JOIN public.agents a ON a.club_id=f.club_id AND a.user_id=f.payer_user JOIN public.clubs cl ON cl.id=f.club_id
  GROUP BY f.club_id,f.payer_user,a.agent_wallet_balance,cl.owner_id HAVING round(sum(f.owed),2)>a.agent_wallet_balance
 LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',s.owner_id,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',s.owner_id::text,true);
  res:=public.fn_club_bank_send(s.club_id,s.payer_user,round(s.owed-s.bal,2),'agent_wallet',
    'Weekly rakeback funding: agent wallet short for players (week ending '||to_char(p_to AT TIME ZONE 'America/Chicago','Mon DD')||')',
    md5(p_run::text||':'||s.club_id::text||':'||s.payer_user::text)::uuid);
  IF COALESCE(res->>'success','false')<>'true' THEN RAISE EXCEPTION 'weekly_payout_agent_funding_refused %',res::text; END IF;
  out:=out||jsonb_build_array(jsonb_build_object('club_id',s.club_id,'agent_user_id',s.payer_user,'owed',s.owed,'wallet_before',s.bal,'funded',round(s.owed-s.bal,2)));
 END LOOP;
 PERFORM set_config('request.jwt.claims',COALESCE(saved,''),true);
 PERFORM set_config('request.jwt.claim.sub',COALESCE(saved_sub,''),true);
 RETURN out;
END $function$
