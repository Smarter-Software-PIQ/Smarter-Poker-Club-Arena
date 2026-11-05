-- Free Buy ticket and cutoff cases, run after the exact candidate migration.
-- One transaction; the deferred ledger/store invariant is forced before COMMIT.
BEGIN;
CREATE FUNCTION pg_temp.agree(t uuid,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e tournament_escrow%ROWTYPE; s record; r tournaments%ROWTYPE;
BEGIN
 SELECT * INTO e FROM tournament_escrow WHERE tournament_id=t;
 SELECT * INTO s FROM fn_ca_tournament_escrow_chips(t);
 SELECT * INTO r FROM tournaments WHERE id=t;
 IF r.prize_pool IS DISTINCT FROM e.prize_balance OR r.bounty_pool IS DISTINCT FROM e.bounty_balance
    OR s.prize_balance IS DISTINCT FROM e.prize_balance OR s.bounty_balance IS DISTINCT FROM e.bounty_balance THEN
  RAISE EXCEPTION '% escrow disagreement: pools %/% escrow %/% shadow %/%',label,
   r.prize_pool,r.bounty_pool,e.prize_balance,e.bounty_balance,s.prize_balance,s.bounty_balance;
 END IF;
END $$;
CREATE FUNCTION pg_temp.u(n int) RETURNS uuid LANGUAGE sql AS $$SELECT ('40000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
CREATE FUNCTION pg_temp.promo() RETURNS numeric LANGUAGE sql AS $$SELECT promo_wallet FROM union_wallets$$;
-- p_n paid 1-chip rebuys by one seated player (bust reset between them).
CREATE FUNCTION pg_temp.rebuys(t uuid, p_user uuid, p_n int) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i int; tb uuid;
BEGIN
 IF p_n=0 THEN RETURN; END IF;
 SELECT id INTO tb FROM tables WHERE tournament_id=t;
 IF tb IS NULL THEN tb:=gen_random_uuid(); INSERT INTO tables(id,tournament_id,status) VALUES(tb,t,'active'); END IF;
 IF NOT EXISTS(SELECT 1 FROM table_seats WHERE table_id=tb AND user_id=p_user) THEN
  INSERT INTO table_seats(id,table_id,user_id,stack,joined_at) VALUES(gen_random_uuid(),tb,p_user,0,now());
 END IF;
 PERFORM set_config('fixture.uid',p_user::text,true);
 FOR i IN 1..p_n LOOP
  UPDATE table_seats SET stack=0 WHERE table_id=tb AND user_id=p_user;
  PERFORM fn_ca_process_tournament_chip_purchase_money_v1(t,p_user,'rebuy',1,3000,1,'rb-'||t||'-'||p_user||'-'||i);
 END LOOP;
END $$;
-- Close every window and run the production guarantee entry point.
CREATE FUNCTION pg_temp.cutoff(t uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 UPDATE tournaments SET status='RUNNING',started_at=COALESCE(started_at,now()),current_level=4 WHERE id=t;
 RETURN fn_apply_prize_guarantee(t,'fixture');
END $$;

-- 1. The owner's acceptance table, through the one arithmetic the cutoff uses.
DO $$DECLARE r record; c record;
BEGIN
 FOR c IN SELECT * FROM (VALUES
   (500::numeric,250,160::numeric,500::numeric,340::numeric),
   (500,250,0,500,500),
   (500,250,500,500,0),
   (500,250,650,650,0),
   (0,250,160,410,250),
   (0,250,0,250,250)) v(g,tickets,c,p,u)
 LOOP
  SELECT * INTO r FROM fn_ca_free_buy_cutoff_terms(c.g,c.c,c.tickets,1);
  IF r.prize_pool<>c.p OR r.promo_support<>c.u THEN
   RAISE EXCEPTION 'terms G=% tickets=% C=%: got P=% U=%, expected P=% U=%',c.g,c.tickets,c.c,r.prize_pool,r.promo_support,c.p,c.u;
  END IF;
 END LOOP;
END $$;
SELECT 'PASS: acceptance table (G 500: 160->500/340, 0->500/500, 500->500/0, 650->650/0; no G: 160->410/250, 0->250/250)';

-- 2. The tournament day: it turns over at 04:00 Chicago, so 12:30 AM is the
-- previous day's fifth Free Buy.
DO $$BEGIN
 IF fn_ca_free_buy_ticket_day('2026-11-21 00:30 America/Chicago')<>DATE '2026-11-20'
  OR fn_ca_free_buy_ticket_day('2026-11-20 08:30 America/Chicago')<>DATE '2026-11-20'
  OR fn_ca_free_buy_ticket_day('2026-11-20 03:59 America/Chicago')<>DATE '2026-11-19'
  OR fn_ca_free_buy_ticket_day('2026-11-20 04:00 America/Chicago')<>DATE '2026-11-20'
  OR fn_ca_free_buy_ticket_day('2026-03-08 00:30 America/Chicago')<>DATE '2026-03-07' THEN
  RAISE EXCEPTION 'Tournament day boundary wrong'; END IF;
END $$;
SELECT 'PASS: the 12:30 AM Free Buy uses the previous day''s ticket (day turns at 04:00 Chicago)';

-- 3. Daily grant: every account once per day, offline or not; a later joiner
-- once on first use; a grant moves no chips.
DO $$DECLARE n1 int; n2 int; chips numeric:=(SELECT sum(chip_balance) FROM club_members); p numeric:=pg_temp.promo();
BEGIN
 n1:=fn_ca_grant_daily_free_buy_tickets(DATE '2026-11-20');
 n2:=fn_ca_grant_daily_free_buy_tickets(DATE '2026-11-20');
 IF n1<>(SELECT count(*) FROM profiles) OR n2<>0 THEN RAISE EXCEPTION 'daily grant % then %',n1,n2; END IF;
 IF (SELECT count(*) FROM ca_free_buy_ticket_grants WHERE ticket_day='2026-11-20')<>(SELECT count(*) FROM profiles)
  OR EXISTS(SELECT 1 FROM ca_free_buy_ticket_grants WHERE tickets<>5) THEN RAISE EXCEPTION 'grant rows wrong'; END IF;
 INSERT INTO profiles(id,display_name,is_horse) VALUES('40000000-0000-0000-0000-000000000999','Late Joiner',false);
 INSERT INTO club_members(user_id,club_id,chip_balance) VALUES('40000000-0000-0000-0000-000000000999','fade0000-0000-0000-0000-000000000001',0);
 IF fn_ca_grant_daily_free_buy_tickets(DATE '2026-11-20')<>1 OR fn_ca_grant_daily_free_buy_tickets(DATE '2026-11-20')<>0 THEN
  RAISE EXCEPTION 'a later joiner was not granted exactly once'; END IF;
 IF (SELECT sum(chip_balance) FROM club_members)<>chips OR pg_temp.promo()<>p THEN RAISE EXCEPTION 'A grant moved chips'; END IF;
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='free-buy-daily-tickets' AND command LIKE '%fn_ca_grant_daily_free_buy_tickets%') THEN
  RAISE EXCEPTION 'daily grant is not scheduled'; END IF;
 BEGIN UPDATE ca_free_buy_ticket_grants SET granted_by='first_use'; RAISE EXCEPTION 'grant row was editable';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
SELECT 'PASS: daily grant happens exactly once per user and day (offline and late joiners included) and moves no chips';

-- 4. Rollout compatibility: every standing registration kept its free entry.
DO $$BEGIN
 IF (SELECT count(*) FROM ca_free_buy_ticket_redemptions WHERE kind='rollout_compat')
    <>(SELECT count(*) FROM tournament_players tp JOIN tournaments t ON t.id=tp.tournament_id
        WHERE t.free_buy AND NOT COALESCE(t.prize_pool_finalized,false)) THEN
  RAISE EXCEPTION 'not every standing registration has a compatibility record'; END IF;
 IF (SELECT count(*) FROM ca_free_buy_ticket_events WHERE action='rollout_compat')
    <>(SELECT count(*) FROM ca_free_buy_ticket_redemptions WHERE kind='rollout_compat') THEN
  RAISE EXCEPTION 'compatibility records are not in the history'; END IF;
 IF (SELECT count(*) FROM ca_free_buy_ticket_redemptions WHERE kind='rollout_compat'
       AND tournament_id IN ('50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-0000000000a2','50000000-0000-0000-0000-0000000000a3'))<>8 THEN
  RAISE EXCEPTION 'legacy events lack their compatibility records'; END IF;
END $$;
SELECT 'PASS: rollout compatibility records cover every registration made before tickets shipped';

-- 5. Guaranteed Free Buys (All-In Or Fold, 500 guarantee), 250 ticket entries
-- each, C from paid rebuys. Nothing is credited or debited before the cutoff.
SELECT fixture_event(('50000000-0000-0000-0000-0000000000b'||g)::uuid,'Afternoon Free Buy (NLH)','aiof',
  '2026-11-20 10:00 America/Chicago'::timestamptz+make_interval(hours=>g)) FROM generate_series(1,4) g;
DO $$DECLARE g int; i int; t uuid; p0 numeric; cs int[]:=ARRAY[160,0,500,650]; ps numeric[]:=ARRAY[500,500,500,650];
  us numeric[]:=ARRAY[340,500,0,0]; j jsonb; w0 numeric; refused boolean;
BEGIN
 FOR g IN 1..4 LOOP
  t:=('50000000-0000-0000-0000-0000000000b'||g)::uuid;
  IF (SELECT guaranteed_prize FROM tournaments WHERE id=t)<>500 THEN RAISE EXCEPTION 'not a 500 guarantee'; END IF;
  p0:=pg_temp.promo();
  FOR i IN 1..250 LOOP PERFORM fixture_register(t,pg_temp.u(i)); END LOOP;
  PERFORM fixture_register(t,pg_temp.u(251));
  IF pg_temp.promo()<>p0 THEN RAISE EXCEPTION 'a guaranteed ticket entry debited promo'; END IF;
  w0:=(SELECT chip_balance FROM club_members WHERE user_id=pg_temp.u(251));
  PERFORM pg_temp.rebuys(t,pg_temp.u(251),cs[g]);
  IF (SELECT chip_balance FROM club_members WHERE user_id=pg_temp.u(251))<>w0-cs[g] THEN RAISE EXCEPTION 'rebuys not paid from the wallet'; END IF;
  IF pg_temp.promo()<>p0 OR (SELECT prize_pool FROM tournaments WHERE id=t)<>cs[g]
   OR (SELECT bounty_pool FROM tournaments WHERE id=t)<>0 THEN
   RAISE EXCEPTION 'before the cutoff: promo % pool %',pg_temp.promo()-p0,(SELECT prize_pool FROM tournaments WHERE id=t); END IF;
  PERFORM pg_temp.agree(t,'held '||g);
  -- A window boundary: rebuy level 3 of 4 is still open, so nothing finalizes and nothing moves.
  UPDATE tournaments SET status='RUNNING',started_at=now(),current_level=3 WHERE id=t;
  refused:=false;
  BEGIN PERFORM fn_apply_prize_guarantee(t,'fixture');
  EXCEPTION WHEN check_violation THEN refused:=SQLERRM LIKE '%before late registration level 4 closes%'; END;
  IF NOT refused OR pg_temp.promo()<>p0 OR EXISTS(SELECT 1 FROM ca_free_buy_cutoff_fundings WHERE tournament_id=t) THEN
   RAISE EXCEPTION 'funded or finalized while a window was open'; END IF;
  j:=pg_temp.cutoff(t);
  IF NOT (j->>'ok')::boolean THEN RAISE EXCEPTION 'cutoff % refused: %',g,j; END IF;
  IF (SELECT prize_pool FROM tournaments WHERE id=t)<>ps[g] OR p0-pg_temp.promo()<>us[g]
   OR NOT (SELECT prize_pool_finalized FROM tournaments WHERE id=t) THEN
   RAISE EXCEPTION 'G=500 C=%: P=% U=% expected %/%',cs[g],(SELECT prize_pool FROM tournaments WHERE id=t),p0-pg_temp.promo(),ps[g],us[g]; END IF;
  IF (SELECT valid_tickets||'/'||promo_support||'/'||moved||'/'||wallet_chips FROM ca_free_buy_cutoff_fundings WHERE tournament_id=t)
     <>('251/'||us[g]||'.00/'||us[g]||'.00/'||cs[g]||'.00') THEN
   RAISE EXCEPTION 'funding row wrong: %',(SELECT to_jsonb(f) FROM ca_free_buy_cutoff_fundings f WHERE tournament_id=t); END IF;
  IF (SELECT count(*) FROM chip_ledger WHERE tournament_id=t AND idempotency_key LIKE '%free_buy_cutoff%')<>(CASE WHEN us[g]>0 THEN 1 ELSE 0 END)
   OR EXISTS(SELECT 1 FROM chip_ledger WHERE tournament_id=t AND metadata->>'kind'='midway_free_buy_promo_head') THEN
   RAISE EXCEPTION 'cutoff journal wrong'; END IF;
  PERFORM pg_temp.agree(t,'funded '||g);
  -- A retry of the cutoff moves nothing.
  j:=fn_apply_prize_guarantee(t,'fixture');
  IF p0-pg_temp.promo()<>us[g] OR (SELECT prize_pool FROM tournaments WHERE id=t)<>ps[g] THEN RAISE EXCEPTION 'retry moved money'; END IF;
 END LOOP;
END $$;
SELECT 'PASS: guaranteed Free Buy rows of the acceptance table end to end (500/340, 500/500, 500/0, 650/0), promo only at the cutoff, retry moves nothing';
SELECT 'PASS: window boundaries: an open rebuy level refuses the cutoff and moves nothing';
SELECT 'PASS: paid rebuys after a ticket entry come from the player wallet; tickets add no chip';

-- 6. Non-guaranteed Free Buys: Mystery (each ticket 0.50 bounty head now,
-- 0.50 prize at the cutoff) and a bounty-only PKO.
SELECT fixture_event('50000000-0000-0000-0000-0000000000b5','Prime Time Free Buy (NLH)','mystery','2026-11-20 20:30 America/Chicago');
SELECT fixture_event('50000000-0000-0000-0000-0000000000b6','Prime Time Free Buy (NLH)','mystery','2026-11-21 20:30 America/Chicago');
SELECT fixture_event('50000000-0000-0000-0000-0000000000b7','Midnight Free Buy (NLH)','pko','2026-11-22 00:30 America/Chicago');
DO $$DECLARE t uuid; p0 numeric; g int; i int; cs int[]:=ARRAY[160,0]; j jsonb;
BEGIN
 FOR g IN 1..2 LOOP
  t:=('50000000-0000-0000-0000-0000000000b'||(4+g))::uuid;
  p0:=pg_temp.promo();
  FOR i IN 1..250 LOOP PERFORM fixture_register(t,pg_temp.u(i)); END LOOP;
  IF p0-pg_temp.promo()<>125 OR (SELECT prize_pool FROM tournaments WHERE id=t)<>0
   OR (SELECT bounty_pool FROM tournaments WHERE id=t)<>125 THEN RAISE EXCEPTION 'mystery heads wrong'; END IF;
  PERFORM fixture_register(t,pg_temp.u(251));
  PERFORM pg_temp.rebuys(t,pg_temp.u(251),cs[g]);
  IF (SELECT prize_pool FROM tournaments WHERE id=t)<>cs[g]/2.0 THEN RAISE EXCEPTION 'mystery rebuy split wrong'; END IF;
  PERFORM pg_temp.agree(t,'mystery held');
  j:=pg_temp.cutoff(t);
  IF NOT (j->>'ok')::boolean THEN RAISE EXCEPTION 'mystery cutoff refused: %',j; END IF;
  -- 251 tickets: V = 251 chips in all, half bounty (already booked) and half prize now.
  IF (SELECT prize_pool FROM tournaments WHERE id=t)<>125.5+cs[g]/2.0 OR p0-pg_temp.promo()<>251
   OR (SELECT bounty_pool FROM tournaments WHERE id=t)<>125.5+cs[g]/2.0 THEN
   RAISE EXCEPTION 'mystery P=% bounty=% U=%',(SELECT prize_pool FROM tournaments WHERE id=t),
     (SELECT bounty_pool FROM tournaments WHERE id=t),p0-pg_temp.promo(); END IF;
  PERFORM pg_temp.agree(t,'mystery funded');
 END LOOP;
 -- The 12:30 AM PKO on Nov 22 is Nov 21's fifth ticket; bounty-only: its
 -- prize pool is 0 at the cutoff and stays 0, every chip stays a bounty.
 t:='50000000-0000-0000-0000-0000000000b7';
 p0:=pg_temp.promo();
 FOR i IN 1..5 LOOP PERFORM fixture_register(t,pg_temp.u(i)); END LOOP;
 PERFORM pg_temp.rebuys(t,pg_temp.u(5),3);
 IF (SELECT ticket_day FROM ca_free_buy_ticket_redemptions WHERE tournament_id=t LIMIT 1)<>DATE '2026-11-21' THEN
  RAISE EXCEPTION 'the 12:30 AM PKO took the wrong day''s ticket'; END IF;
 j:=pg_temp.cutoff(t);
 IF NOT (j->>'ok')::boolean OR NOT (SELECT prize_pool_finalized FROM tournaments WHERE id=t)
  OR (SELECT prize_pool FROM tournaments WHERE id=t)<>0 OR (SELECT bounty_pool FROM tournaments WHERE id=t)<>8
  OR p0-pg_temp.promo()<>5
  OR (SELECT prize_pool||'/'||promo_support||'/'||moved FROM ca_free_buy_cutoff_fundings WHERE tournament_id=t)<>'0.00/0.00/0.00' THEN
  RAISE EXCEPTION 'zero-prize PKO cutoff wrong: %',j; END IF;
 PERFORM pg_temp.agree(t,'pko');
END $$;
SELECT 'PASS: non-guaranteed Free Buys: P = V + C, U = V (Mystery splits each ticket 0.50 bounty / 0.50 prize)';
SELECT 'PASS: a bounty-only PKO finalizes with a 0 prize pool and its bounties untouched (settlement: #9570)';

-- 7. One ticket per user per event, five per day, and unregister/re-register.
DO $$DECLARE t uuid; reg uuid; rid uuid; rid2 uuid; refused text; p0 numeric; n1 numeric; n2 numeric;
BEGIN
 -- users 1..250 hold five Nov 20 tickets in use (b1-b5): a sixth is refused.
 PERFORM fixture_event('50000000-0000-0000-0000-0000000000b8','Morning Free Buy (NLH)','regular','2026-11-20 08:30 America/Chicago');
 t:='50000000-0000-0000-0000-0000000000b8';
 BEGIN PERFORM fixture_register(t,pg_temp.u(7)); refused:=NULL;
 EXCEPTION WHEN OTHERS THEN refused:=SQLERRM; END;
 IF refused IS NULL OR refused NOT LIKE '%free_buy_ticket_unavailable%' THEN RAISE EXCEPTION 'a sixth ticket was spent: %',refused; END IF;
 IF EXISTS(SELECT 1 FROM tournament_players WHERE tournament_id=t) THEN RAISE EXCEPTION 'a refused entry stayed'; END IF;
 -- A fresh player registers, retries, unregisters (ticket restored) and re-registers on the same row.
 PERFORM fixture_register(t,pg_temp.u(260));
 SELECT id INTO reg FROM tournament_players WHERE tournament_id=t AND user_id=pg_temp.u(260);
 SELECT id INTO rid FROM ca_free_buy_ticket_redemptions WHERE tournament_id=t AND user_id=pg_temp.u(260);
 IF fn_ca_free_buy_ticket_redeem(t,pg_temp.u(260),reg)<>rid THEN RAISE EXCEPTION 'a retry made a second redemption'; END IF;
 BEGIN PERFORM fn_ca_free_buy_ticket_redeem(t,pg_temp.u(260),gen_random_uuid()); refused:=NULL;
 EXCEPTION WHEN OTHERS THEN refused:=SQLERRM; END;
 IF refused NOT LIKE 'free_buy_ticket_already_used%' THEN RAISE EXCEPTION 'a second entry used a ticket: %',refused; END IF;
 p0:=pg_temp.promo();
 -- (each call is its own statement: a subquery in the same expression would read the pre-call snapshot)
 n1:=fn_ca_midway_free_buy_promo_head(t,reg,true); n2:=fn_ca_midway_free_buy_promo_head(t,reg,true);
 IF n1<>0 OR n2<>0
  OR (SELECT status FROM ca_free_buy_ticket_redemptions WHERE id=rid)<>'restored' OR pg_temp.promo()<>p0 THEN
  RAISE EXCEPTION 'unregister did not restore the ticket exactly once'; END IF;
 DELETE FROM tournament_players WHERE id=reg;
 PERFORM fixture_register(t,pg_temp.u(260));
 SELECT id INTO rid2 FROM ca_free_buy_ticket_redemptions WHERE tournament_id=t AND user_id=pg_temp.u(260);
 IF rid2<>rid OR (SELECT status FROM ca_free_buy_ticket_redemptions WHERE id=rid)<>'redeemed'
  OR (SELECT string_agg(action,',' ORDER BY id) FROM ca_free_buy_ticket_events WHERE redemption_id=rid)<>'redeem,restore,redeem' THEN
  RAISE EXCEPTION 'unregister/re-register history wrong'; END IF;
 IF (SELECT count(*) FROM ca_free_buy_ticket_redemptions WHERE user_id=pg_temp.u(260) AND status='redeemed')<>1 THEN
  RAISE EXCEPTION 'duplicate redemption'; END IF;
 -- A mystery head's bounty share returns to promo once on an unplayed unregister.
 t:='50000000-0000-0000-0000-0000000000a2';
 PERFORM fixture_register(t,pg_temp.u(261));
 SELECT id INTO reg FROM tournament_players WHERE tournament_id=t AND user_id=pg_temp.u(261);
 p0:=pg_temp.promo();
 n1:=fn_ca_midway_free_buy_promo_head(t,reg,true); n2:=fn_ca_midway_free_buy_promo_head(t,reg,true);
 IF n1<>1 OR n2<>0 OR pg_temp.promo()<>p0+0.50 THEN RAISE EXCEPTION 'mystery head return wrong'; END IF;
 DELETE FROM tournament_players WHERE id=reg;
 PERFORM pg_temp.agree(t,'mystery return');
 -- A pre-ticket entry unregisters through its own 1-chip leg and its compatibility record.
 SELECT id INTO reg FROM tournament_players WHERE tournament_id=t AND user_id=pg_temp.u(2);
 p0:=pg_temp.promo();
 n1:=fn_ca_midway_free_buy_promo_head(t,reg,true);
 IF n1<>1 OR pg_temp.promo()<>p0+1
  OR (SELECT status FROM ca_free_buy_ticket_redemptions WHERE registration_id=reg)<>'restored' THEN
  RAISE EXCEPTION 'pre-ticket unregister wrong'; END IF;
 DELETE FROM tournament_players WHERE id=reg;
 PERFORM pg_temp.agree(t,'legacy return');
END $$;
SELECT 'PASS: one ticket per user per event; five per day; unregister restores once and re-register reuses the same record';

-- 8. Duplicate and interrupted cutoffs.
DO $$DECLARE t uuid:='50000000-0000-0000-0000-0000000000b8'; p0 numeric; j jsonb;
BEGIN
 p0:=pg_temp.promo();
 -- interrupted after funding: everything rolls back together.
 BEGIN
  PERFORM pg_temp.cutoff(t);
  RAISE EXCEPTION 'fixture interruption';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'fixture interruption' THEN RAISE; END IF;
 END;
 IF pg_temp.promo()<>p0 OR EXISTS(SELECT 1 FROM ca_free_buy_cutoff_fundings WHERE tournament_id=t)
  OR (SELECT prize_pool_finalized FROM tournaments WHERE id=t) THEN RAISE EXCEPTION 'interrupted cutoff left money behind'; END IF;
 -- a refused finalization rolls the funding back with it.
 PERFORM set_config('fixture.core_refuses','on',true);
 j:=pg_temp.cutoff(t);
 PERFORM set_config('fixture.core_refuses','off',true);
 IF (j->>'ok')::boolean OR pg_temp.promo()<>p0 OR EXISTS(SELECT 1 FROM ca_free_buy_cutoff_fundings WHERE tournament_id=t) THEN
  RAISE EXCEPTION 'a refused finalization kept its funding: %',j; END IF;
 -- then the real cutoff: 250 guarantee, C = 0, 1 ticket: P 250, U 250, once.
 j:=pg_temp.cutoff(t); j:=fn_apply_prize_guarantee(t,'fixture'); j:=fn_apply_prize_guarantee(t,'fixture');
 IF p0-pg_temp.promo()<>250 OR (SELECT prize_pool FROM tournaments WHERE id=t)<>250
  OR (SELECT count(*) FROM chip_ledger WHERE tournament_id=t AND idempotency_key LIKE '%free_buy_cutoff%')<>1 THEN
  RAISE EXCEPTION 'duplicate cutoff moved money twice'; END IF;
 PERFORM pg_temp.agree(t,'duplicate');
 IF (fn_ca_free_buy_fund_at_cutoff(t)->>'already_finalized')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'finalized event re-funded'; END IF;
END $$;
SELECT 'PASS: duplicate and interrupted cutoffs: a rollback leaves nothing, a refusal keeps nothing, repeats move nothing';

-- 9. Pre-ticket events at the cutoff: recorded promo chips are reconciled.
DO $$DECLARE p0 numeric; j jsonb;
BEGIN
 -- a1: 500 guarantee, 3 pre-ticket chips, C 0 -> P 500; promo pays the remaining 497.
 p0:=pg_temp.promo();
 j:=pg_temp.cutoff('50000000-0000-0000-0000-0000000000a1');
 IF (SELECT prize_pool FROM tournaments WHERE id='50000000-0000-0000-0000-0000000000a1')<>500 OR p0-pg_temp.promo()<>497 THEN
  RAISE EXCEPTION 'a1 P=% moved=%',(SELECT prize_pool FROM tournaments WHERE id='50000000-0000-0000-0000-0000000000a1'),p0-pg_temp.promo(); END IF;
 PERFORM pg_temp.agree('50000000-0000-0000-0000-0000000000a1','a1');
 -- a3: 500 guarantee, 3 pre-ticket chips, C 600 -> P 600, U 0: the 3 chips go back to promo before anything is paid.
 PERFORM pg_temp.rebuys('50000000-0000-0000-0000-0000000000a3',pg_temp.u(3),600);
 p0:=pg_temp.promo();
 j:=pg_temp.cutoff('50000000-0000-0000-0000-0000000000a3');
 IF (SELECT prize_pool FROM tournaments WHERE id='50000000-0000-0000-0000-0000000000a3')<>600 OR pg_temp.promo()-p0<>3
  OR (SELECT moved FROM ca_free_buy_cutoff_fundings WHERE tournament_id='50000000-0000-0000-0000-0000000000a3')<>-3 THEN
  RAISE EXCEPTION 'a3 P=% returned=%',(SELECT prize_pool FROM tournaments WHERE id='50000000-0000-0000-0000-0000000000a3'),pg_temp.promo()-p0; END IF;
 PERFORM pg_temp.agree('50000000-0000-0000-0000-0000000000a3','a3');
 -- a2: Mystery, one pre-ticket entry left (0.50 prize recorded), V prize 0.50: nothing moves.
 p0:=pg_temp.promo();
 j:=pg_temp.cutoff('50000000-0000-0000-0000-0000000000a2');
 IF (SELECT prize_pool FROM tournaments WHERE id='50000000-0000-0000-0000-0000000000a2')<>0.50 OR pg_temp.promo()<>p0 THEN
  RAISE EXCEPTION 'a2 wrong'; END IF;
 PERFORM pg_temp.agree('50000000-0000-0000-0000-0000000000a2','a2');
END $$;
SELECT 'PASS: rollout compatibility at the cutoff: already-recorded promo chips count toward U; an excess returns by compensating entry';

-- 10. The horse door spends a ticket the same way.
DO $$DECLARE j jsonb; t uuid:='50000000-0000-0000-0000-0000000000b6';
BEGIN
 PERFORM fixture_event('50000000-0000-0000-0000-0000000000b9','Morning Free Buy (NLH)','regular','2026-11-25 08:30 America/Chicago');
 j:=fn_register_horse_for_tournament_before_maintenance_gate('50000000-0000-0000-0000-0000000000b9','30000000-0000-0000-0000-000000000002');
 IF NOT (j->>'ok')::boolean OR NOT EXISTS(SELECT 1 FROM ca_free_buy_ticket_redemptions
    WHERE tournament_id='50000000-0000-0000-0000-0000000000b9' AND user_id='30000000-0000-0000-0000-000000000002' AND kind='ticket') THEN
  RAISE EXCEPTION 'horse ticket entry wrong: %',j; END IF;
END $$;
SELECT 'PASS: a horse''s first entry uses its own ticket through the horse door';

-- 11. Execution boundaries.
DO $$BEGIN
 IF has_function_privilege('service_role','fn_ca_free_buy_fund_at_cutoff(uuid)','execute')
  OR has_function_privilege('authenticated','fn_ca_free_buy_fund_at_cutoff(uuid)','execute')
  OR has_function_privilege('service_role','fn_ca_free_buy_ticket_redeem(uuid,uuid,uuid)','execute')
  OR has_function_privilege('authenticated','fn_ca_free_buy_ticket_restore(uuid,uuid,uuid,text)','execute')
  OR has_function_privilege('anon','fn_my_free_buy_tickets()','execute')
  OR NOT has_function_privilege('authenticated','fn_my_free_buy_tickets()','execute')
  OR has_table_privilege('authenticated','ca_free_buy_ticket_redemptions','select') THEN
  RAISE EXCEPTION 'Execution boundaries wrong'; END IF;
 PERFORM set_config('fixture.uid','40000000-0000-0000-0000-000000000260',true);
 IF (fn_my_free_buy_tickets()->>'tickets')::int<>5 THEN RAISE EXCEPTION 'own ticket read wrong'; END IF;
END $$;
SELECT 'PASS: only the registration and cutoff owners can spend tickets or promo; players read only their own count';

SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
SELECT 'PASS: ledger/store conservation held at commit';
