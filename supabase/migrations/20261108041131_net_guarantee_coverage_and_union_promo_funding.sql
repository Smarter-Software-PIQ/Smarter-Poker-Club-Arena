-- Owner November 7: restore net guarantee coverage and original-close union promo funding.
-- Rake remains separately earned and never counts as prizes. House transfers are not player coverage.
-- Journal-bound finalized correction admission is limited to the exact authorized 88-chip event.
-- @live-proof: position('net_coverage' in pg_get_functiondef('public.fn_ca_guarantee_funding(uuid)'::regprocedure))>0 AND position('fn_ca_fund_union_guarantee_promo_locked' in pg_get_functiondef('public.fn_apply_prize_guarantee(uuid,text)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
-- Completed books stay sealed. Only settled, correlated promo supplements
-- through the approved adjustment and idempotent wallet doors count as paid.
CREATE FUNCTION public.fn_ca_guarantee_house_supplements(p_tournament_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $supplement$
 SELECT coalesce(sum(l.amount),0) FROM public.chip_ledger l
 JOIN public.ca_manual_adjustments a ON a.id=l.correlation_id
 JOIN public.wallet_credit_idempotency c ON c.key=l.idempotency_key
 WHERE a.tournament_id=p_tournament_id AND a.status='settled'
 AND a.target_kind='player_wallet' AND a.target_id=c.user_id AND a.amount=c.amount
 AND c.amount=l.amount AND l.to_type='player_wallet' AND l.to_entity_id=c.user_id
 AND l.from_type='union_wallet' AND l.from_label='union_wallets.promo_wallet'
 AND l.from_entity_id=(SELECT t.union_id FROM public.tournaments t WHERE t.id=p_tournament_id)
 AND l.category='settlement' AND coalesce(l.status,'posted')='posted'
 AND l.tournament_id IS NULL
 AND l.idempotency_key='net-guarantee-house:'||p_tournament_id::text||':'||c.user_id::text;
$supplement$;
REVOKE ALL ON FUNCTION public.fn_ca_guarantee_house_supplements(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_guarantee_house_supplements(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_guarantee_funding(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 WITH t AS (
  SELECT x.id, round(greatest(coalesce(x.guaranteed_prize, 0), 0), 2) AS g, round(greatest(coalesce(x.total_rake, 0), 0), 2) AS rake
    FROM public.tournaments x WHERE x.id = p_tournament_id
 ), l AS (
  SELECT c.category, c.from_type, c.to_type, c.from_entity_id, c.to_entity_id, c.amount
    FROM public.chip_ledger c
   WHERE (c.to_entity_id = p_tournament_id OR c.from_entity_id = p_tournament_id)
     AND coalesce(c.status, 'posted') = 'posted'
 ), s AS (
  SELECT
   coalesce(sum(l.amount) FILTER (WHERE l.to_entity_id = p_tournament_id AND l.to_type = 'prize_liability' AND (
      (l.from_type = 'player_wallet' AND l.category IN ('tournament_buyin', 'rebuy', 'addon'))
      OR (l.from_type = 'prize_liability' AND l.category = 'tournament_buyin' AND l.from_entity_id IS DISTINCT FROM p_tournament_id)
      OR (l.from_type = 'escrow' AND l.category = 'ticket_redeem'))), 0) AS paid_in,
   coalesce(sum(l.amount) FILTER (WHERE l.from_entity_id = p_tournament_id AND l.from_type = 'prize_liability'
      AND l.to_type = 'player_wallet' AND l.category IN ('refund', 'reversal')), 0) AS paid_back,
   coalesce(sum(l.amount) FILTER (WHERE l.to_entity_id = p_tournament_id AND l.to_type = 'prize_liability'
      AND l.category IN ('overlay', 'promo_send') AND l.from_type IN ('union_bank', 'union_wallet', 'club_treasury')), 0) AS house_in,
   coalesce(sum(l.amount) FILTER (WHERE l.from_entity_id = p_tournament_id AND l.from_type = 'prize_liability'
      AND l.category = 'reversal' AND l.to_type IN ('union_bank', 'union_wallet', 'club_treasury')), 0) AS house_out
  FROM l
 ), v AS (
  SELECT t.g, round(greatest(0, s.paid_in - s.paid_back), 2) AS gross, round(greatest(0, s.paid_in - s.paid_back - t.rake), 2) AS c, round(s.house_in - s.house_out + public.fn_ca_guarantee_house_supplements(p_tournament_id), 2) AS p
    FROM t, s
 )
 SELECT jsonb_build_object(
  'guarantee', v.g,
  'gross_coverage', v.gross,
  'net_coverage', v.c,
  'house_required', greatest(0, v.g - v.c),
  'house_posted', v.p,
  'house_supplement_paid', public.fn_ca_guarantee_house_supplements(p_tournament_id),
  'house_due', greatest(0, greatest(0, v.g - v.c) - v.p),
  'house_over_required', greatest(0, v.p - greatest(0, v.g - v.c)))
 FROM v;
$function$
;
-- Guarantees cover funded places and bounties, never rake (owner November 7).
-- The original close transaction funds its net shortfall from the union promo
-- wallet before finalization. The existing core still proves the final pool.
CREATE FUNCTION public.fn_ca_fund_union_guarantee_promo_locked(p_tournament_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
 t public.tournaments%ROWTYPE; due numeric; k text; prev text;
 before_bank numeric; after_bank numeric; before_escrow numeric;
BEGIN
 PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 IF NOT FOUND OR coalesce(t.prize_pool_finalized,false) OR t.union_id IS NULL
   OR coalesce(t.is_private,false) OR coalesce(t.guaranteed_prize,0)<=0
   OR public.fn_poker_diamond_tournament(p_tournament_id) THEN RETURN 0; END IF;
 due:=round((public.fn_ca_guarantee_funding(p_tournament_id)->>'house_due')::numeric,2);
 IF due IS NULL OR due<=0 THEN RETURN 0; END IF;
 IF public.fn_tournament_late_registration_open(t.id) THEN
   RAISE EXCEPTION 'guarantee promo cannot fund before registration closes'; END IF;
 k:='tourney:'||p_tournament_id::text||':net_guarantee_promo';
 IF EXISTS(SELECT 1 FROM public.chip_ledger WHERE idempotency_key=k) THEN
   RAISE EXCEPTION 'existing guarantee promo receipt conflicts with outstanding shortfall';
 END IF;
 PERFORM public.fn_ca_escrow_apply(p_tournament_id,'Net guarantee promo prelock');
 SELECT prize_balance INTO STRICT before_escrow FROM public.tournament_escrow
   WHERE tournament_id=p_tournament_id FOR UPDATE;
 SELECT promo_wallet INTO STRICT before_bank FROM public.union_wallets
   WHERE union_id=t.union_id FOR UPDATE;
 IF before_bank IS NULL OR before_bank::text IN ('NaN','Infinity','-Infinity') OR before_bank<due THEN
   RAISE EXCEPTION 'union promo wallet cannot fund guarantee shortfall'; END IF;
 prev:=current_setting('app.ledger_autoskip_union_wallets',true);
 PERFORM set_config('app.ledger_autoskip_union_wallets','1',true);
 UPDATE public.union_wallets SET promo_wallet=promo_wallet-due,updated_at=now()
   WHERE union_id=t.union_id AND promo_wallet>=due RETURNING promo_wallet INTO after_bank;
 PERFORM set_config('app.ledger_autoskip_union_wallets',coalesce(prev,''),true);
 IF after_bank IS DISTINCT FROM before_bank-due THEN RAISE EXCEPTION 'union promo debit mismatch'; END IF;
 INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,from_label,
   to_type,to_entity_id,to_label,amount,category,club_id,tournament_id,idempotency_key,description,metadata)
 VALUES(coalesce(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),
   'union_wallet',t.union_id,'union_wallets.promo_wallet','prize_liability',t.id,
   'tournament_escrow.prize_balance',due,'promo_send',t.club_id,t.id,k,
   'Union Promo Funds Net Tournament Guarantee At Registration Close',
   jsonb_build_object('kind','net_guarantee_promo','rake_excluded',t.total_rake,
     'prize_part',due,'bounty_part',0,'source_balance_before',before_bank,'source_balance_after',after_bank));
 PERFORM public.fn_ca_escrow_apply(t.id,'Net guarantee promo',p_gross_in=>due);
 UPDATE public.tournaments SET prize_pool=coalesce(prize_pool,0)+due WHERE id=t.id;
 IF (SELECT prize_balance FROM public.tournament_escrow WHERE tournament_id=t.id)
      IS DISTINCT FROM before_escrow+due
   OR (public.fn_ca_guarantee_funding(t.id)->>'house_due')::numeric<>0 THEN
   RAISE EXCEPTION 'net guarantee promo did not fund exact escrow and liability';
 END IF;
 RETURN due;
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_ca_fund_union_guarantee_promo_locked(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_fund_union_guarantee_promo_locked(uuid) TO service_role;

DO $wire$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.fn_apply_prize_guarantee(uuid,text)'::regprocedure);
 IF md5(d)<>'99915c591711aeb431e68f35200accb0' THEN RAISE EXCEPTION 'guarantee close owner changed'; END IF;
 EXECUTE replace(d,$old$    v_result:=public.fn_ca_apply_prize_guarantee_core($old$,$new$    PERFORM public.fn_ca_fund_union_guarantee_promo_locked(p_tournament_id);
    v_result:=public.fn_ca_apply_prize_guarantee_core($new$);
END $wire$;
CREATE OR REPLACE FUNCTION public.fn_overlay_at_risk(p_union uuid DEFAULT NULL::uuid)
 RETURNS TABLE(tournament_id uuid, name text, club_id uuid, status text, start_time timestamp with time zone, buy_in numeric, guaranteed_prize numeric, entries_needed integer, current_players integer, shortfall integer, max_players integer, minutes_to_start numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH admission AS MATERIALIZED (SELECT public.fn_ca_read_mtt_admission_contract() AS abi)
  select t.id, t.name, t.club_id, t.status, t.start_time,
         t.buy_in_amount, t.guaranteed_prize,
         coalesce(att.attendance_floor, ceil(t.guaranteed_prize / nullif(t.buy_in_amount, 0))::int),
         coalesce(t.current_players, 0),
         greatest(
           least(
             coalesce(att.attendance_floor, ceil(t.guaranteed_prize / nullif(t.buy_in_amount, 0))::int)
               - coalesce(t.current_players, 0),
             CASE WHEN a.abi='unlimited-mtt-v2' AND t.format_contract IN ('mtt-v1','mtt-v2') THEN NULL
               ELSE coalesce(t.max_players, 0) - coalesce(t.current_players, 0) END
           ), 0)::int,
         CASE WHEN a.abi='unlimited-mtt-v2' AND t.format_contract IN ('mtt-v1','mtt-v2') THEN NULL ELSE coalesce(t.max_players, 0) END,
         round(extract(epoch from (t.start_time - now())) / 60.0, 1)
  from tournaments t CROSS JOIN admission a
  CROSS JOIN LATERAL public.fn_tournament_entry_split(
    t.buy_in_amount, t.buy_in_fee, t.bounty_amount,
    COALESCE(t.is_bounty,false) OR COALESCE(t.is_pko,false)
      OR COALESCE(t.is_mystery_bounty,false)) funding
  LEFT JOIN smarter_private.nov3_tournament_attendance att ON att.tournament_id=t.id
    AND (t.start_time AT TIME ZONE 'America/Chicago')::date=DATE '2026-11-03'
  left join clubs c on c.id = t.club_id
  where (t.guaranteed_prize > 0 OR att.attendance_floor > 0)
    and t.buy_in_amount > 0
    and upper(t.status) in ('SCHEDULED', 'REGISTERING', 'ANNOUNCED', 'RUNNING')
    and t.start_time > now() - interval '30 minutes'
    and t.start_time < now() + interval '3 hours'
    and (p_union is null or c.union_id = p_union or c.id = p_union)
    and coalesce(att.attendance_floor, ceil(t.guaranteed_prize / nullif(t.buy_in_amount, 0))::int) > coalesce(t.current_players, 0)
  order by t.start_time asc;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_tournament_guarantee_check(p_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_checked   integer := 0;
  v_short     integer := 0;
  v_unpaid    integer := 0;
  v_chips     numeric := 0;
  v_raised    integer := 0;
  r           record;
BEGIN
  FOR r IN
    WITH scope AS (
      SELECT t.id, t.name, t.club_id, t.guaranteed_prize,
             COALESCE(t.total_rake, 0) AS rake,
             COALESCE(t.prize_pool, 0) AS pool,
             /* THE BUBBLE IS PAID FROM THE GUARANTEED POOL (2026-10-03). A
                bubble-protected event reserves one base buy-in for its stone
                bubble out of the prize pool before the ladder is priced, and
                says so on the event page. That refund is part of what the
                guarantee paid out, as is an overlay backpay that made a short
                pool whole. Leaving them out read f84852af (Sunday $200 Deep
                Stack, 2026-09-27: 19,820.00 to places 1-2 plus 180.00 to the
                bubble, 20,000.00 in all) as 180.00 short, and 690bfcb0 on
                2026-09-14 the same way. */
             COALESCE((
               SELECT sum(p.amount) FROM public.tournament_payouts p
                WHERE p.tournament_id = t.id
                  AND p.source IN ('structure','reconcile','hu_shortfall',
                                   'late_reg_adjustment','final_table_deal',
                                   'spin_backpay','bubble_protection',
                                   'overlay_backpay')
             ), 0) + COALESCE(t.bounty_pool_paid, 0) + public.fn_ca_guarantee_house_supplements(t.id) AS paid,
             EXISTS (SELECT 1 FROM public.tournament_guarantee_overlays o
                      WHERE o.tournament_id = t.id) AS overlay_funded,
             t.ended_at
        FROM public.tournaments t
       WHERE COALESCE(t.guaranteed_prize, 0) > 0
         AND t.status = 'COMPLETED'
         AND t.ended_at > now() - make_interval(hours => GREATEST(p_hours, 1))
         AND COALESCE(t.variant, '') <> 'satellite'
         AND UPPER(COALESCE(t.tournament_type, '')) <> 'SATELLITE'
    )
    SELECT * FROM scope
  LOOP
    v_checked := v_checked + 1;

    -- Rounded to the cent before comparing: the payout structure distributes
    -- in basis points with the residual on the last paid place, so an exact
    -- equality test would report a phantom shortfall of a fraction of a chip.
    -- Owner November 7: fees are not prize coverage.
    CONTINUE WHEN round(r.paid, 2) >= round(r.guaranteed_prize, 2);

    v_short := v_short + 1;
    v_chips := v_chips + (r.guaranteed_prize - r.paid);
    IF r.paid = 0 THEN v_unpaid := v_unpaid + 1; END IF;

    -- One alert per event, ever. Re-running this hourly must not manufacture
    -- a new critical for the same settled tournament.
    IF NOT EXISTS (
      SELECT 1 FROM public.financial_alerts a
       WHERE a.source = 'Tournament.guarantee_not_met'
         AND a.context ->> 'tournament_id' = r.id::text
    ) THEN
      INSERT INTO public.financial_alerts (severity, source, message, context)
      VALUES (
        CASE WHEN r.paid = 0 THEN 'critical' ELSE 'warning' END,
        'Tournament.guarantee_not_met',
        CASE WHEN r.paid = 0
          THEN 'A tournament advertised a guaranteed prize, crowned its field, and paid nobody anything.'
          ELSE 'A tournament paid out less than its advertised guaranteed prize.'
        END,
        jsonb_build_object(
          'tournament_id',    r.id,
          'tournament_name',  r.name,
          'club_id',          r.club_id,
          'guaranteed_prize', r.guaranteed_prize,
          'prize_pool',       r.pool,
          'actually_paid',    r.paid,
          'shortfall',        round(r.guaranteed_prize - r.paid, 2),
          'rake',             r.rake,
          'overlay_funded',   r.overlay_funded,
          'ended_at',         r.ended_at
        )
      );
      v_raised := v_raised + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'window_hours', GREATEST(p_hours, 1),
    'checked', v_checked,
    'short_of_guarantee', v_short,
    'paid_nothing', v_unpaid,
    'chips_short', round(v_chips, 2),
    'alerts_raised', v_raised
  );
END;
$function$
;
DO $admit$
DECLARE d text; f record;
BEGIN
 FOR f IN SELECT * FROM (VALUES ('public.fn_guard_managed_game_lifecycle()','766aeba0ff5dc94d3bcaf9676a819003'),('public.trg_freeze_finalized_tournament_prize_pool()','0ad37ed9105c244a62c44b34c7f37a73'))x(signature,hash) LOOP
 d:=pg_get_functiondef(f.signature::regprocedure);
 IF md5(d)<>f.hash OR position(E'BEGIN\n' in d)=0 THEN RAISE EXCEPTION 'finalized guard owner changed: %',f.signature; END IF;
 d:=overlay(d placing E'BEGIN\n'||$admission$
  -- Exact owner correction, bound to the committed promo journal and both rows.
  IF TG_TABLE_NAME='tournaments' AND current_user='postgres'
    AND OLD.id='f22ceae6-2850-40ef-8f97-7d3660be32a3'::uuid
    AND OLD.status='RUNNING' AND NEW.status='RUNNING'
    AND OLD.prize_pool=1742 AND NEW.prize_pool=1830
    AND OLD.guaranteed_prize=2500 AND NEW.guaranteed_prize=2500
    AND OLD.bounty_pool=670 AND NEW.bounty_pool=670
    AND OLD.prize_pool_finalized AND NEW.prize_pool_finalized
    AND (to_jsonb(NEW)-'prize_pool')=(to_jsonb(OLD)-'prize_pool')
    AND current_setting('app.owner_net_guarantee_correction',true)=
      'tourney:f22ceae6-2850-40ef-8f97-7d3660be32a3:owner_net_guarantee_88'
    AND EXISTS(SELECT 1 FROM public.chip_ledger l
      WHERE l.idempotency_key=current_setting('app.owner_net_guarantee_correction',true)
        AND l.tournament_id=OLD.id AND l.category='promo_send' AND l.amount=88
        AND l.from_type='union_wallet' AND l.from_label='union_wallets.promo_wallet'
        AND l.from_entity_id='fade0000-0000-0000-0000-000000000001'::uuid
        AND l.to_type='prize_liability' AND l.to_entity_id=OLD.id
        AND l.metadata->>'kind'='owner_net_guarantee_88'
        AND l.metadata->'tournament_before'=to_jsonb(OLD)
        AND l.metadata->'tournament_after'=to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;
$admission$ from position(E'BEGIN\n' in d) for 6);
 EXECUTE d;
 END LOOP;
END $admit$;
DO $credit$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.fn_audit_overlays(date)'::regprocedure);
 IF md5(d)<>'5f8f22881e5dac4b1e8836518e8a813a' THEN RAISE EXCEPTION 'net guarantee credit owner changed: fn_audit_overlays(date)'; END IF;
 d:=replace(d,$old$coalesce(t.bounty_pool,0)+coalesce(t.total_rake,0) pool_credit$old$,$new$coalesce(t.bounty_pool,0) pool_credit$new$);
 d:=replace(d,$old$entries*(bi+fee)$old$,$new$entries*bi$new$);
 d:=replace(d,E'AS $function$\n',E'AS $function$\n-- Owner November 7: net prize coverage excludes rake; satellite seat prices stay unchanged.\n');
 EXECUTE d;
END $credit$;
DO $credit$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.trg_tournaments_guarantee_affordable()'::regprocedure);
 IF md5(d)<>'efde5cebc699be085dfcfbc327b7f322' THEN RAISE EXCEPTION 'net guarantee credit owner changed: trg_tournaments_guarantee_affordable()'; END IF;
 d:=replace(d,$old$+ coalesce(t.total_rake,0)$old$,$new$$new$);
 d:=replace(d,$old$+ coalesce(new.total_rake,0)$old$,$new$$new$);
 d:=replace(d,E'AS $function$\n',E'AS $function$\n-- Owner November 7: net prize coverage excludes rake; satellite seat prices stay unchanged.\n');
 EXECUTE d;
END $credit$;
DO $credit$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.fn_notify_guarantee_bank_short(uuid)'::regprocedure);
 IF md5(d)<>'44d4ebbc497c11ce739d8a7d63c93b0c' THEN RAISE EXCEPTION 'net guarantee credit owner changed: fn_notify_guarantee_bank_short(uuid)'; END IF;
 d:=replace(d,$old$+ coalesce(t.total_rake, 0)$old$,$new$$new$);
 d:=replace(d,E'AS $function$\n',E'AS $function$\n-- Owner November 7: net prize coverage excludes rake; satellite seat prices stay unchanged.\n');
 EXECUTE d;
END $credit$;
DO $credit$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.fn_tournament_management_readiness_for_row(jsonb)'::regprocedure);
 IF md5(d)<>'88ac34de6a2a33d22673cb324bd46497' THEN RAISE EXCEPTION 'net guarantee credit owner changed: fn_tournament_management_readiness_for_row(jsonb)'; END IF;
 d:=replace(d,$old$+ COALESCE(t.total_rake, 0)$old$,$new$$new$);
 d:=replace(d,$old$v_pool + v_bounty + v_rake$old$,$new$v_pool + v_bounty$new$);
 d:=replace(d,E'AS $function$\n',E'AS $function$\n-- Owner November 7: net prize coverage excludes rake; satellite seat prices stay unchanged.\n');
 EXECUTE d;
END $credit$;

-- Explicitly restate the measured existing service-only ACLs.
REVOKE ALL ON FUNCTION public.fn_ca_guarantee_funding(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_guarantee_funding(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_overlay_at_risk(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_overlay_at_risk(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tournament_guarantee_check(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tournament_guarantee_check(integer) TO service_role;
COMMIT;
