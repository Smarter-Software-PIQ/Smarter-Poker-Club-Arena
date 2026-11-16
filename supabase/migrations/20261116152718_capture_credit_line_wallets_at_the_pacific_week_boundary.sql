-- @live-proof: position('agent_credit_cutoff' in pg_get_functiondef('smarter_private.agent_wallet_keeps_weekly_reserve()'::regprocedure))>0 AND position('agent_credit_cutoff' in pg_get_functiondef('public.fn_capture_agent_credit_week(uuid[],timestamptz,timestamptz,text,uuid)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
-- The first change after Pacific Sunday ends preserves exactly what was there
-- before that change. Unchanged lines/wallets already are their closing value.
CREATE TABLE smarter_private.agent_credit_cutoff (
  agent_id uuid NOT NULL, period_end timestamptz NOT NULL, club_id uuid NOT NULL,
  credit_line numeric NOT NULL, prepaid boolean NOT NULL, wallet_balance numeric NOT NULL,
  PRIMARY KEY(agent_id,period_end)
);
REVOKE ALL ON smarter_private.agent_credit_cutoff FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE
  s text; start_at integer; stop_at integer;
BEGIN
  s:=pg_get_functiondef('smarter_private.agent_wallet_keeps_weekly_reserve()'::regprocedure);
  IF md5(s)<>'7279fb49d3ce7236a838f639f831dd44' THEN RAISE EXCEPTION 'weekly_wallet_observer_preimage_changed'; END IF;
  s:=replace(s,'BEGIN'||chr(10)||' IF TG_OP=', $body$BEGIN
 IF (NOT coalesce(OLD.is_prepaid,false) AND OLD.credit_limit>0
      OR TG_OP='UPDATE' AND NOT coalesce(NEW.is_prepaid,false) AND NEW.credit_limit>0)
    AND (TG_OP='DELETE' OR ROW(OLD.club_id,OLD.credit_limit,OLD.is_prepaid,OLD.agent_wallet_balance)
      IS DISTINCT FROM ROW(NEW.club_id,NEW.credit_limit,NEW.is_prepaid,NEW.agent_wallet_balance)) THEN
   DECLARE boundary timestamptz:=public.fn_union_week_start(statement_timestamp());
   BEGIN
     IF OLD.created_at<boundary AND NOT EXISTS(SELECT FROM public.agent_credit_weekly_scopes sc
       WHERE sc.period_end=boundary AND sc.club_id=OLD.club_id) THEN
       INSERT INTO smarter_private.agent_credit_cutoff(agent_id,period_end,club_id,credit_line,prepaid,wallet_balance)
         VALUES(OLD.id,boundary,OLD.club_id,coalesce(OLD.credit_limit,0),coalesce(OLD.is_prepaid,false),coalesce(OLD.agent_wallet_balance,0))
         ON CONFLICT(agent_id,period_end) DO NOTHING;
     END IF;
   END;
 END IF;
 IF TG_OP=$body$);
  EXECUTE s;
  s:=pg_get_functiondef('public.fn_capture_agent_credit_week(uuid[],timestamptz,timestamptz,text,uuid)'::regprocedure);
  IF md5(s)<>'0d3ab6e7532fc9a3ee245658c617d79a' THEN RAISE EXCEPTION 'weekly_credit_capture_preimage_changed'; END IF;
  start_at:=position(' FOR a IN SELECT id,club_id,credit_limit,agent_wallet_balance' in s);
  stop_at:=position('  INSERT INTO public.agent_credit_weekly_basis' in s);
  IF start_at=0 OR stop_at<=start_at THEN RAISE EXCEPTION 'weekly_credit_capture_query_changed'; END IF;
  EXECUTE substr(s,1,start_at-1)||$body$
 -- Lock the original agents first. A concurrent first post-cutoff wallet
 -- change commits its witness before the subsequent read at READ COMMITTED.
 PERFORM a1.id FROM public.agents a1 WHERE a1.created_at<p_to AND
   (a1.club_id=ANY(p_clubs) AND a1.credit_limit>0 OR EXISTS(SELECT FROM smarter_private.agent_credit_cutoff k
    WHERE k.agent_id=a1.id AND k.period_end=p_to AND k.club_id=ANY(p_clubs)))
   ORDER BY a1.club_id,a1.id FOR UPDATE OF a1;
 FOR a IN SELECT a1.id,coalesce(k.club_id,a1.club_id) club_id,
   coalesce(k.credit_line,a1.credit_limit) credit_limit,coalesce(k.wallet_balance,a1.agent_wallet_balance) agent_wallet_balance
   FROM public.agents a1 LEFT JOIN smarter_private.agent_credit_cutoff k ON k.agent_id=a1.id AND k.period_end=p_to
   WHERE a1.created_at<p_to AND coalesce(k.club_id,a1.club_id)=ANY(p_clubs)
    AND NOT coalesce(k.prepaid,a1.is_prepaid,false) AND coalesce(k.credit_line,a1.credit_limit)>0
    AND NOT EXISTS(SELECT FROM public.agent_credit_weekly_scopes sc
      WHERE sc.club_id=coalesce(k.club_id,a1.club_id) AND sc.period_end=p_to)
   ORDER BY club_id,a1.id LOOP
$body$||substr(s,stop_at);
END $patch$;
COMMIT;
