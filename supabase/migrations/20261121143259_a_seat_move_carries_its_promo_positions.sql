-- @live-proof: to_regprocedure('public.fn_ca_promo_follow_seat_move(uuid,uuid,uuid)') IS NOT NULL AND position('fn_ca_promo_follow_seat_move(source_row.user_id' in pg_get_functiondef('public.fn_cash_seat_move_execute(uuid)'::regprocedure))>0 AND position('fn_ca_promo_follow_seat_move(partner_source.user_id' in pg_get_functiondef('public.fn_cash_seat_move_execute(uuid)'::regprocedure))>0
-- 20261121143259_a_seat_move_carries_its_promo_positions.sql
--
-- WHAT WAS WRONG (incidents bb04ee5f, e542fbd7, 887c0008; 2026-11-21)
--
-- Every restricted promo position on the felt is keyed to the TABLE the
-- chips sit on: ca_promo_principal_custody, ca_promo_profit_custody and
-- ca_promo_integrity_custody rows with kind 'table_stack' and
-- entity_id = tables.id. Buy-in, cash-out and every accepted cash hand read
-- and write the position at that table.
--
-- fn_cash_seat_move_execute (cluster balance, must-move and swap) moves a
-- player's whole stack to another table of the game. It moved the chips and
-- the Diamond custody (fn_poker_diamond_move_custody) and nothing else, so the
-- promo positions stayed keyed to the table the player had left:
--   * on the new table fn_ca_promo_accept_cash_hand found no position and
--     charged no loss to the promo, so the principal never shrank with the
--     stack;
--   * a cash-out from the new table moved nothing back to the wallet, so the
--     principal stayed on the old table;
--   * when the player came back to the old table (must-move), the stale
--     position exceeded the stack and fn_ca_promo_profit_capture_cash refused
--     the hand with original_winnings_sources_exceed_accepted_stack.
-- 2026-11-21 08:16 UTC: e922e29a, 7.20 left on dbbc148e while 37 hands on
-- feeder a5d84d81 took the stack to 2.64; the refused hand #60380607 froze
-- dbbc148e and its engine was rebuilt ~20 times a minute for six hours.
-- Settled by 20261121142000, 20261121142714 and 20261121143102.
--
-- WHAT THIS CHANGES (the line that produced it)
--
-- public.fn_ca_promo_follow_seat_move(user, from_table, to_table) moves EVERY
-- position the player holds at (table_stack, from_table) to
-- (table_stack, to_table) inside the seat move's own transaction, with the
-- platform's existing movers and in the cash-out's order:
--   1. the same advisory scopes and grant locks the cash-out takes
--      (fn_ca_promo_profit_prelock_source);
--   2. integrity custody per club (fn_ca_promo_integrity_move, which carries
--      its winnings overlap through fn_ca_promo_profit_follow_integrity);
--   3. winnings custody per grant (fn_ca_promo_profit_move_grant);
--   4. principal custody of every open grant
--      (fn_ca_promo_move_selected_custody, both rows in one statement so the
--      deferred conservation trigger holds).
-- It then refuses the move (23514, promo_position_left_behind_by_seat_move)
-- if any open principal, locked winnings or unreleased integrity position is
-- still keyed to the table the player left: a seat cannot arrive without its
-- restrictions. A player with no position at the old table pays one indexed
-- EXISTS and nothing else.
--
-- fn_cash_seat_move_execute calls it for the mover and, in a swap, for the
-- partner, right after each player's Diamond custody follows the seat.
-- Exact preimage md5 + one anchor each; owner/security/ACL/config unchanged.
--
-- One transaction (club-arena CLAUDE.md production DDL policy).

BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';

CREATE OR REPLACE FUNCTION public.fn_ca_promo_follow_seat_move(p_user uuid,p_from uuid,p_to uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record;ids uuid[];total numeric;moved numeric;
BEGIN
 IF p_user IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from=p_to THEN RETURN;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
   WHERE g.user_id=p_user AND c.kind='table_stack' AND c.entity_id=p_from AND c.amount>0)
  AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_custody c WHERE c.user_id=p_user AND c.kind='table_stack' AND c.entity_id=p_from AND c.amount>0)
  AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_custody c WHERE c.user_id=p_user AND c.kind='table_stack' AND c.entity_id=p_from AND c.amount>0)
 THEN RETURN;END IF;
 -- 1. The cash-out's own locks, per club holding a position here.
 FOR r IN SELECT DISTINCT q.club_id FROM(
   SELECT g.club_id FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
    WHERE g.user_id=p_user AND c.kind='table_stack' AND c.entity_id=p_from AND c.amount>0
   UNION SELECT c.club_id FROM public.ca_promo_profit_custody c WHERE c.user_id=p_user AND c.kind='table_stack' AND c.entity_id=p_from AND c.amount>0
   UNION SELECT c.club_id FROM public.ca_promo_integrity_custody c WHERE c.user_id=p_user AND c.kind='table_stack' AND c.entity_id=p_from AND c.amount>0)q
  ORDER BY q.club_id LOOP
  PERFORM public.fn_ca_promo_profit_prelock_source(r.club_id,p_user,'table_stack',p_from);
 END LOOP;
 -- 2. Integrity (and the winnings overlap it carries).
 FOR r IN SELECT c.club_id,sum(c.amount) amount FROM public.ca_promo_integrity_custody c
   WHERE c.user_id=p_user AND c.kind='table_stack' AND c.entity_id=p_from AND c.amount>0
    AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases x WHERE x.case_id=c.case_id)
   GROUP BY c.club_id ORDER BY c.club_id LOOP
  moved:=public.fn_ca_promo_integrity_move(r.club_id,p_user,'table_stack',p_from,'table_stack',p_to,r.amount,r.club_id,p_user);
 END LOOP;
 -- 3. Winnings, grant by grant.
 FOR r IN SELECT c.grant_id,c.club_id,c.amount FROM public.ca_promo_profit_custody c
   WHERE c.user_id=p_user AND c.kind='table_stack' AND c.entity_id=p_from AND c.amount>0 ORDER BY c.grant_id,c.club_id LOOP
  PERFORM public.fn_ca_promo_profit_move_grant(r.grant_id,r.club_id,p_user,'table_stack',p_from,'table_stack',p_to,r.amount,r.club_id,p_user);
 END LOOP;
 -- 4. Principal of every open grant, per club.
 FOR r IN SELECT g.club_id,array_agg(DISTINCT g.id) ids,sum(c.amount) amount FROM public.ca_promo_principal_custody c
   JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
   WHERE g.user_id=p_user AND g.closed_at IS NULL AND c.kind='table_stack' AND c.entity_id=p_from AND c.amount>0
   GROUP BY g.club_id ORDER BY g.club_id LOOP
  moved:=public.fn_ca_promo_move_selected_custody(r.club_id,p_user,'table_stack',p_from,'table_stack',p_to,r.amount,'spent',r.ids);
  IF moved IS DISTINCT FROM r.amount THEN RAISE EXCEPTION 'promo_position_left_behind_by_seat_move' USING ERRCODE='23514';END IF;
 END LOOP;
 -- A seat never arrives without its restrictions.
 IF EXISTS(SELECT 1 FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
   WHERE g.user_id=p_user AND g.closed_at IS NULL AND c.kind='table_stack' AND c.entity_id=p_from AND c.amount>0)
 OR EXISTS(SELECT 1 FROM public.ca_promo_profit_custody c JOIN public.ca_promo_profit_gates w ON w.grant_id=c.grant_id AND w.unlocked_at IS NULL
   WHERE c.user_id=p_user AND c.kind='table_stack' AND c.entity_id=p_from AND c.amount>0)
 OR EXISTS(SELECT 1 FROM public.ca_promo_integrity_custody c WHERE c.user_id=p_user AND c.kind='table_stack' AND c.entity_id=p_from AND c.amount>0
   AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases x WHERE x.case_id=c.case_id))
 THEN RAISE EXCEPTION 'promo_position_left_behind_by_seat_move' USING ERRCODE='23514';END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_follow_seat_move(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Executes the new body inside this transaction and always unwinds: once for
-- a player with no position (the one indexed EXISTS), and once on a live
-- principal position moved to an unused table id, which reaches the locks and
-- all three movers (proved on production 2026-11-21: 2.54 moved, conservation held).
-- @probe-for: public.fn_ca_promo_follow_seat_move
DO $probe$
DECLARE u uuid; t uuid; dest uuid:=gen_random_uuid();
BEGIN
  PERFORM public.fn_ca_promo_follow_seat_move(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
  SELECT g.user_id,c.entity_id INTO u,t FROM public.ca_promo_principal_custody c
    JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
   WHERE c.kind='table_stack' AND c.amount>0 AND g.closed_at IS NULL LIMIT 1;
  IF u IS NOT NULL THEN
    PERFORM public.fn_ca_promo_follow_seat_move(u,t,dest);
    IF EXISTS(SELECT 1 FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
      WHERE g.user_id=u AND g.closed_at IS NULL AND c.kind='table_stack' AND c.entity_id=t AND c.amount>0) THEN
      RAISE EXCEPTION 'seat_move_promo_probe_left_position_behind';
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

DO $install$
DECLARE
 sig constant regprocedure:='public.fn_cash_seat_move_execute(uuid)'::regprocedure;
 o1 text:=$anchor$ PERFORM public.fn_poker_diamond_move_custody(source_row,destination,m.game_id);
$anchor$;
 n1 text:=$anchor$ PERFORM public.fn_poker_diamond_move_custody(source_row,destination,m.game_id);
 -- A seat move carries every promo position with its stack (2026-11-21).
 PERFORM public.fn_ca_promo_follow_seat_move(source_row.user_id,m.from_table_id,m.to_table_id);
$anchor$;
 o2 text:=$anchor$  PERFORM public.fn_poker_diamond_move_custody(partner_source,partner_destination,pm.game_id);
$anchor$;
 n2 text:=$anchor$  PERFORM public.fn_poker_diamond_move_custody(partner_source,partner_destination,pm.game_id);
  PERFORM public.fn_ca_promo_follow_seat_move(partner_source.user_id,pm.from_table_id,pm.to_table_id);
$anchor$;
 d text; before jsonb;
BEGIN
 IF public.fn_platform_frozen() IS DISTINCT FROM false THEN RAISE EXCEPTION 'seat_move_promo_freeze_refused';END IF;
 d:=pg_get_functiondef(sig);
 IF md5(d)<>'5145b0cf788bd10d693df9e10f109e89' THEN RAISE EXCEPTION 'seat_move_promo_preimage_refused';END IF;
 IF (length(d)-length(replace(d,o1,'')))/length(o1)<>1 OR (length(d)-length(replace(d,o2,'')))/length(o2)<>1 THEN RAISE EXCEPTION 'seat_move_promo_anchor_refused';END IF;
 SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) INTO before FROM pg_proc p WHERE p.oid=sig;
 EXECUTE replace(replace(d,o1,n1),o2,n2);
 d:=pg_get_functiondef(sig);
 IF position('fn_ca_promo_follow_seat_move(source_row.user_id,m.from_table_id,m.to_table_id)' IN d)=0
 OR position('fn_ca_promo_follow_seat_move(partner_source.user_id,pm.from_table_id,pm.to_table_id)' IN d)=0
 OR position('SEAT_MOVE_CONSERVATION_FAILED' IN d)=0 THEN RAISE EXCEPTION 'seat_move_promo_postimage_refused';END IF;
 IF (SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) FROM pg_proc p WHERE p.oid=sig) IS DISTINCT FROM before THEN RAISE EXCEPTION 'seat_move_promo_security_refused';END IF;
END $install$;

COMMIT;
