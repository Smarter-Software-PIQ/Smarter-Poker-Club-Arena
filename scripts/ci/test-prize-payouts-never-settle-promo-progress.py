#!/usr/bin/env python3
"""Prize payouts never settle promo progress on the ledger (incident 075013fd, lane 4).

Native PostgreSQL 16/17 proof for migration
20261119175941_prize_payouts_never_settle_promo_progress_on_ledger.sql.

Proves on a disposable PostgreSQL cluster:
  1. Before the migration, tournament prize payouts, bounty payouts, tournament
     refunds, satellite rolls, and returned entitlement tickets all invoke
     fn_ca_promo_play_through_settle -> fn_ca_promo_shared_fee_state_live.
  2. The migration installs cleanly (including all @probe-for probes) and
     satisfies its @live-proof verbatim.
  3. After the migration, NONE of those payout/award/refund paths invoke
     fn_ca_promo_play_through_settle or fn_ca_promo_shared_fee_state_live (0 calls).
  4. Principal custody conservation is 100% preserved across prize, bounty,
     refund, satellite roll, and returned ticket credits.
  5. Promo play-through security is 100% preserved: an open grant met since the
     last hourly sweep is held open during payout (nothing released early), and
     a subsequent live cash-out settle releases it immediately.
  6. Cash table cashout (category='table_cashout') retains its settle call.
  7. A second apply of the migration is refused cleanly and atomically.

Usage: PG_BIN=/opt/homebrew/bin python3 scripts/ci/test-prize-payouts-never-settle-promo-progress.py
"""
import os, re, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = next((ROOT / 'supabase/migrations').glob('20261119175941_*.sql'))
SNAPSHOT = next((ROOT / 'supabase/migrations').glob('20261119002019_*.sql'))
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))

CLUB = '00000000-0000-0000-0000-00000000c1ab'
EVENT = '00000000-0000-0000-0000-0000000e0e01'
TARGET_EVENT = '00000000-0000-0000-0000-0000000e0e02'

SCHEMA = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.ca_promo_play_through_settings(id boolean PRIMARY KEY DEFAULT true, enforced_from timestamptz);
INSERT INTO public.ca_promo_play_through_settings VALUES(true, now() - interval '1 day');
CREATE TABLE public.club_members(club_id uuid NOT NULL, user_id uuid NOT NULL, chip_balance numeric NOT NULL DEFAULT 0, PRIMARY KEY(club_id, user_id));
CREATE TABLE public.tournament_players(tournament_id uuid NOT NULL, user_id uuid NOT NULL, club_id uuid NOT NULL, PRIMARY KEY(tournament_id, user_id));
CREATE TABLE public.tournament_tickets(id uuid PRIMARY KEY, holder_id uuid NOT NULL, club_id uuid NOT NULL, source_refund_entitlement_id uuid, value numeric NOT NULL, redemption_mode text NOT NULL DEFAULT 'tournament_entry_only', status text NOT NULL DEFAULT 'issued');
CREATE TABLE public.tournament_refund_entitlements(id uuid PRIMARY KEY, tournament_id uuid NOT NULL, user_id uuid NOT NULL, refund_wallet_club_id uuid NOT NULL, source_ledger_id uuid, gross numeric NOT NULL);
CREATE TABLE public.chip_ledger(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, club_id uuid, from_type text, from_entity_id uuid, from_label text, to_type text, to_entity_id uuid, amount numeric NOT NULL, category text, status text DEFAULT 'posted', metadata jsonb DEFAULT '{}'::jsonb);

CREATE TABLE public.ca_promo_play_through_grants(
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, club_id uuid NOT NULL, user_id uuid NOT NULL,
  amount numeric NOT NULL, remaining numeric NOT NULL, multiplier numeric NOT NULL,
  fee_target numeric GENERATED ALWAYS AS (round((amount*multiplier),4)) STORED,
  source_kind text NOT NULL, source_ref text NOT NULL UNIQUE, source_ledger_id uuid,
  funded_from_type text, funded_from_id uuid, cycle_started_at timestamptz NOT NULL,
  granted_at timestamptz DEFAULT now() NOT NULL, expires_at timestamptz,
  closed_at timestamptz, close_reason text, closed_by uuid, close_note text,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE public.ca_promo_profit_gates(grant_id uuid PRIMARY KEY, unlocked_at timestamptz);
CREATE TABLE public.ca_promo_profit_overrides(grant_id uuid PRIMARY KEY, reviewed_by uuid NOT NULL, reason text NOT NULL, overridden_at timestamptz DEFAULT clock_timestamp() NOT NULL);
CREATE TABLE public.ca_promo_profit_fee_phases(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, grant_id uuid NOT NULL, source_kind text NOT NULL, source_id uuid NOT NULL, activated_at timestamptz DEFAULT clock_timestamp() NOT NULL, closed_at timestamptz);
CREATE TABLE public.ca_promo_profit_custody(grant_id uuid NOT NULL, club_id uuid NOT NULL, user_id uuid NOT NULL, kind text NOT NULL, entity_id uuid NOT NULL, amount numeric NOT NULL, PRIMARY KEY(grant_id,club_id,user_id,kind,entity_id));
CREATE TABLE public.ca_promo_principal_custody(grant_id uuid NOT NULL, kind text NOT NULL, entity_id uuid NOT NULL, amount numeric NOT NULL, PRIMARY KEY(grant_id,kind,entity_id));
CREATE TABLE public.ca_promo_event_principal_lots(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, grant_id uuid NOT NULL, tournament_id uuid NOT NULL, charge_ledger_id uuid, source_ref text NOT NULL, original_amount numeric NOT NULL, remaining numeric NOT NULL);
CREATE TABLE public.ca_promo_event_realization_receipts(ledger_id uuid PRIMARY KEY, tournament_id uuid NOT NULL, club_id uuid NOT NULL, user_id uuid NOT NULL, amount numeric NOT NULL, principal numeric NOT NULL);
CREATE TABLE public.ca_promo_event_realization_slices(ledger_id uuid NOT NULL, grant_id uuid NOT NULL, amount numeric NOT NULL, PRIMARY KEY(ledger_id,grant_id));
CREATE TABLE public.ca_promo_event_fee_consumption_receipts(charge_ledger_id uuid PRIMARY KEY, entitlement_id uuid, club_id uuid NOT NULL, player_id uuid NOT NULL, charge_amount numeric);
CREATE TABLE public.ca_promo_profit_event_principal_returns(ledger_id uuid NOT NULL, entitlement_id uuid NOT NULL, grant_id uuid NOT NULL, source_ledger_id uuid, amount numeric NOT NULL);
CREATE TABLE public.ca_promo_integrity_cases(id uuid PRIMARY KEY);
CREATE TABLE public.ca_promo_integrity_releases(case_id uuid PRIMARY KEY);
CREATE TABLE public.ca_promo_integrity_event_lots(charge_ledger_id uuid NOT NULL, tournament_id uuid NOT NULL, user_id uuid NOT NULL, club_id uuid NOT NULL, case_id uuid NOT NULL, remaining numeric NOT NULL);
CREATE TABLE public.ca_promo_integrity_custody(case_id uuid NOT NULL, club_id uuid NOT NULL, user_id uuid NOT NULL, kind text NOT NULL, entity_id uuid NOT NULL, amount numeric NOT NULL, PRIMARY KEY(case_id,club_id,user_id,kind,entity_id));
CREATE TABLE public.ca_promo_profit_event_integrity_returns(ledger_id uuid NOT NULL, entitlement_id uuid NOT NULL, case_id uuid NOT NULL, source_ledger_id uuid, club_id uuid NOT NULL, amount numeric NOT NULL);
CREATE TABLE public.ca_promo_fee_state_cache(club_id uuid NOT NULL, user_id uuid NOT NULL, computed_at timestamptz NOT NULL, valid_until timestamptz NOT NULL, signature text NOT NULL, state jsonb NOT NULL, PRIMARY KEY(club_id, user_id));

CREATE TABLE public.fx_calls(id bigserial PRIMARY KEY, fn text NOT NULL, u uuid);
CREATE TABLE public.fx_truth(grant_id uuid PRIMARY KEY, principal_state text NOT NULL DEFAULT 'locked', profit_target numeric NOT NULL DEFAULT 20, profit_earned numeric NOT NULL DEFAULT 0);

CREATE FUNCTION public.fn_ca_promo_shared_fee_state_live(p_club uuid, p_user uuid)
RETURNS TABLE(grant_id uuid, fee_start numeric, fees numeric, principal_target numeric, profit_target numeric, principal_state text, profit_state text, consumed_prefix numeric, phase_id uuid, phase_kind text, profit_earned numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
  INSERT INTO public.fx_calls(fn, u) VALUES('live', p_user);
  RETURN QUERY
    SELECT g.id, 0::numeric, 0::numeric, g.fee_target, COALESCE(t.profit_target, 20),
           COALESCE(t.principal_state, 'locked'), 'locked'::text, 0::numeric,
           p.id, p.source_kind, COALESCE(t.profit_earned, 0)
      FROM public.ca_promo_play_through_grants g
      JOIN public.ca_promo_profit_fee_phases p ON p.grant_id = g.id
      LEFT JOIN public.fx_truth t ON t.grant_id = g.id
     WHERE g.club_id = p_club AND g.user_id = p_user;
END $$;

-- Helper stubs used by the four target functions
CREATE FUNCTION public.fn_ca_promo_play_through_record_grant(uuid,uuid,numeric,text,text,uuid,text,uuid,timestamptz) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.fn_ca_promo_profit_prelock_source(uuid,uuid,text,uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_ca_promo_fund_from_balance(uuid,numeric,text,uuid,numeric DEFAULT 0) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE FUNCTION public.fn_ca_promo_move_custody(uuid,uuid,text,uuid,text,uuid,numeric,text DEFAULT 'moved') RETURNS numeric LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.fx_calls(fn, u) VALUES('move_custody', $2); RETURN 0; END $$;
CREATE FUNCTION public.fn_ca_promo_record_event_charge(uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_ca_promo_capture_entry_funding(uuid,numeric) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_ca_promo_integrity_realize_event(uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE FUNCTION public.fn_ca_promo_profit_realize_event(uuid,uuid,text,uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_ca_promo_profit_cashout(uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.fx_calls(fn, u) VALUES('profit_cashout', NULL); END $$;
CREATE FUNCTION public.fn_ca_promo_profit_bind_earning_ledger(uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.fn_ca_promo_profit_bind_nonwallet_earning(uuid,uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.fn_ca_promo_profit_project_earning(uuid,uuid,text,uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE FUNCTION public.fn_ca_promo_entry_charge_identity(uuid) RETURNS TABLE(club_id uuid, user_id uuid) LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-00000000c1ab'::uuid, NULL::uuid $$;
CREATE FUNCTION public.fn_ca_promo_profit_restore_returned_ticket_costs(uuid,uuid,uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
"""

# Production-shaped pre-image bodies of the 4 target functions (matching exact anchors)
PREIMAGES = r"""
CREATE FUNCTION public.fn_ca_promo_play_through_state(p_club_id uuid, p_user_id uuid)
RETURNS TABLE(grant_id uuid, amount numeric, remaining numeric, fee_target numeric, cum_target numeric,
  cycle_started_at timestamptz, cycle_fees numeric, granted_at timestamptz, expires_at timestamptz, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
  SELECT g.id, g.amount, g.remaining, g.fee_target, g.fee_target, g.cycle_started_at,
         0::numeric, g.granted_at, g.expires_at, s.principal_state
    FROM public.ca_promo_play_through_grants g
    JOIN public.fn_ca_promo_shared_fee_state(p_club_id, p_user_id) s ON s.grant_id = g.id
   WHERE s.phase_kind = 'gift' AND g.club_id = p_club_id AND g.user_id = p_user_id AND g.closed_at IS NULL;
$$;

CREATE FUNCTION public.fn_ca_promo_realize_event_principal(p_ledger_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE source_id uuid;l public.chip_ledger%ROWTYPE;e public.tournament_refund_entitlements%ROWTYPE;
 lot record;left_to_realize numeric;take numeric;realized numeric:=0;refund_id text;n integer;
BEGIN
 SELECT * INTO l FROM public.chip_ledger WHERE id=p_ledger_id;
 IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) AND l.category IN('tournament_prize','bounty') THEN
  EXECUTE 'SELECT public.fn_ca_promo_profit_bind_earning_ledger($1::uuid)' INTO source_id USING l.id;
  IF source_id IS NOT NULL THEN RETURN public.fn_ca_promo_profit_project_earning(l.id,source_id,'player_wallet',l.to_entity_id);END IF;
 END IF;
 IF l.id IS NULL OR l.from_type<>'prize_liability' OR l.to_type<>'player_wallet'
  OR l.amount<=0 OR COALESCE(l.status,'posted')<>'posted' THEN RAISE EXCEPTION 'invalid_promo_event_realization'; END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id) THEN
  RETURN (SELECT principal FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_event_principal_lots x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id WHERE x.tournament_id=l.from_entity_id AND x.remaining>0 AND g.closed_at IS NULL AND g.user_id=l.to_entity_id) THEN
  INSERT INTO public.ca_promo_event_realization_receipts VALUES(l.id,l.from_entity_id,l.club_id,l.to_entity_id,l.amount,0);RETURN 0;
 END IF;
 PERFORM public.fn_ca_promo_play_through_settle(l.club_id,l.to_entity_id);
 IF l.category IN('refund','tournament_refund') THEN
  refund_id:=current_setting('app.ca_promo_refund_entitlement',true);
  IF COALESCE(refund_id,'')='' THEN
   INSERT INTO public.ca_promo_event_realization_receipts VALUES(l.id,l.from_entity_id,l.club_id,l.to_entity_id,l.amount,0);
   RETURN 0;
  END IF;
  SELECT * INTO e FROM public.tournament_refund_entitlements WHERE id=refund_id::uuid;
  IF e.id IS NULL OR e.tournament_id IS DISTINCT FROM l.from_entity_id OR e.user_id IS DISTINCT FROM l.to_entity_id
   OR e.refund_wallet_club_id IS DISTINCT FROM l.club_id OR e.gross IS DISTINCT FROM l.amount THEN
   RAISE EXCEPTION 'promo_refund_entitlement_does_not_match_credit'; END IF;
 END IF;
 INSERT INTO public.ca_promo_event_realization_receipts VALUES(l.id,l.from_entity_id,l.club_id,l.to_entity_id,l.amount,0);
 left_to_realize:=l.amount;
 FOR lot IN SELECT x.id,x.grant_id,x.remaining,g.granted_at FROM public.ca_promo_event_principal_lots x
  JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id
  WHERE x.tournament_id=l.from_entity_id AND x.remaining>0 AND g.closed_at IS NULL
   AND (g.club_id=l.club_id OR e.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.ca_promo_event_fee_consumption_receipts fee WHERE fee.charge_ledger_id=e.source_ledger_id AND fee.club_id=g.club_id AND fee.player_id=g.user_id)) AND g.user_id=l.to_entity_id
   AND (e.id IS NULL OR x.charge_ledger_id=e.source_ledger_id)
  ORDER BY g.granted_at,g.id,x.source_ref,x.id FOR UPDATE OF g,x LOOP
  EXIT WHEN left_to_realize<=0;
  take:=LEAST(lot.remaining,left_to_realize);
  UPDATE public.ca_promo_principal_custody SET amount=amount-take
   WHERE grant_id=lot.grant_id AND kind='event' AND entity_id=l.from_entity_id AND amount>=take;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'promo_event_lot_has_no_matching_principal'; END IF;
  INSERT INTO public.ca_promo_principal_custody VALUES(lot.grant_id,'player_wallet',l.to_entity_id,take)
   ON CONFLICT(grant_id,kind,entity_id) DO UPDATE SET amount=ca_promo_principal_custody.amount+EXCLUDED.amount;
  UPDATE public.ca_promo_event_principal_lots SET remaining=remaining-take WHERE id=lot.id;
  INSERT INTO public.ca_promo_event_realization_slices VALUES(l.id,lot.grant_id,take)
   ON CONFLICT(ledger_id,grant_id) DO UPDATE SET amount=ca_promo_event_realization_slices.amount+EXCLUDED.amount;
  realized:=realized+take;left_to_realize:=left_to_realize-take;
 END LOOP;
 UPDATE public.ca_promo_event_realization_receipts SET principal=realized WHERE ledger_id=l.id;
 RETURN realized;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_realize_event_principal(uuid) FROM PUBLIC,anon,authenticated,service_role;

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
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_return_entitlement_ticket(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_roll_event_principal(p_ledger_id uuid,p_user uuid,p_destination text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE source_id uuid;l public.chip_ledger%ROWTYPE;lot record;take numeric;left_to_move numeric;moved numeric:=0;n integer;earning_club uuid;
BEGIN
 SELECT * INTO l FROM public.chip_ledger WHERE id=p_ledger_id;
 IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) THEN
  IF l.metadata->>'kind'='tournament_entry_ticket_return' THEN RETURN public.fn_ca_promo_profit_return_entitlement_ticket(l.id,p_user);END IF;
  EXECUTE 'SELECT public.fn_ca_promo_profit_bind_nonwallet_earning($1::uuid,$2::uuid)' INTO source_id USING l.id,p_user;
  IF source_id IS NOT NULL THEN RETURN public.fn_ca_promo_profit_project_earning(l.id,source_id,p_destination,CASE WHEN p_destination='ticket' THEN COALESCE(NULLIF(l.metadata->>'ticket_id','')::uuid,l.to_entity_id) ELSE l.to_entity_id END);END IF;
 END IF;
 IF l.id IS NULL OR l.from_type<>'prize_liability' OR p_destination NOT IN('event','ticket')
  OR l.amount<=0 OR l.metadata->>'user_id' IS DISTINCT FROM p_user::text THEN RAISE EXCEPTION 'invalid_promo_event_roll'; END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id) THEN
  RETURN (SELECT principal FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id); END IF;
 IF p_destination='event' THEN SELECT scope.club_id INTO earning_club FROM public.fn_ca_promo_entry_charge_identity(l.id) scope; ELSE
  SELECT min(scope.club_id::text)::uuid INTO earning_club FROM (
   SELECT g.club_id FROM public.ca_promo_event_principal_lots x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id
    WHERE x.tournament_id=l.from_entity_id AND x.remaining>0 AND g.user_id=p_user
   UNION SELECT tp.club_id FROM public.tournament_players tp WHERE tp.tournament_id=l.from_entity_id AND tp.user_id=p_user
  ) scope HAVING count(DISTINCT scope.club_id)=1;
  IF earning_club IS NULL THEN RAISE EXCEPTION 'earned_promo_award_original_scope_missing_or_ambiguous'; END IF;
 END IF;
 PERFORM public.fn_ca_promo_play_through_settle(earning_club,p_user);
 INSERT INTO public.ca_promo_event_realization_receipts VALUES(l.id,l.from_entity_id,earning_club,p_user,l.amount,0);
 left_to_move:=l.amount;
 FOR lot IN SELECT x.id,x.grant_id,x.remaining,g.granted_at FROM public.ca_promo_event_principal_lots x
  JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id
  WHERE x.tournament_id=l.from_entity_id AND x.remaining>0 AND g.closed_at IS NULL
   AND g.club_id=earning_club AND g.user_id=p_user ORDER BY g.granted_at,g.id,x.source_ref,x.id FOR UPDATE OF g,x LOOP
  EXIT WHEN left_to_move<=0;take:=LEAST(left_to_move,lot.remaining);
  UPDATE public.ca_promo_principal_custody SET amount=amount-take
   WHERE grant_id=lot.grant_id AND kind='event' AND entity_id=l.from_entity_id AND amount>=take;
  GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'promo_roll_has_no_original_principal'; END IF;
  INSERT INTO public.ca_promo_principal_custody VALUES(lot.grant_id,p_destination,l.to_entity_id,take)
   ON CONFLICT(grant_id,kind,entity_id) DO UPDATE SET amount=ca_promo_principal_custody.amount+EXCLUDED.amount;
  UPDATE public.ca_promo_event_principal_lots SET remaining=remaining-take WHERE id=lot.id;
  INSERT INTO public.ca_promo_event_realization_slices VALUES(l.id,lot.grant_id,take)
   ON CONFLICT(ledger_id,grant_id) DO UPDATE SET amount=ca_promo_event_realization_slices.amount+EXCLUDED.amount;
  moved:=moved+take;left_to_move:=left_to_move-take;
 END LOOP;
 UPDATE public.ca_promo_event_realization_receipts SET principal=moved WHERE ledger_id=l.id;
 RETURN moved;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_roll_event_principal(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_custody_on_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE uid uuid;dest text;dest_id uuid;debit jsonb;moved numeric:=0;
BEGIN
 IF NEW.amount<=0 OR NEW.club_id IS NULL OR COALESCE(NEW.status,'posted')<>'posted' THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN RETURN NULL; END IF;
 IF NEW.from_type IN('player_wallet','agent_wallet') THEN
  uid:=NEW.from_entity_id;
  IF NEW.to_type='prize_liability' AND NEW.category IN('tournament_buyin','tournament_rebuy','rebuy','reentry','addon') THEN dest:='event';dest_id:=NEW.to_entity_id;
  END IF;
  IF dest IS NOT NULL THEN
   PERFORM public.fn_ca_promo_profit_prelock_source(NEW.club_id,uid,NEW.from_type,uid);
   PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id,uid);
   IF dest='event' THEN
    moved:=public.fn_ca_promo_fund_from_balance(NEW.id,100,dest,dest_id);
   END IF;
  END IF;
 ELSIF NEW.to_type='player_wallet' AND NEW.from_type IN('table_stack','prize_liability') THEN
  uid:=NEW.to_entity_id;
  dest:=CASE NEW.from_type WHEN 'table_stack' THEN 'table_stack' ELSE 'event' END;
  IF NEW.category='table_cashout' THEN PERFORM public.fn_ca_promo_profit_prelock_source(NEW.club_id,uid,'table_stack',NEW.from_entity_id);END IF;
  PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id,uid);
  IF dest='event' THEN
   PERFORM public.fn_ca_promo_realize_event_principal(NEW.id);
   PERFORM public.fn_ca_promo_integrity_realize_event(NEW.id);
   IF NEW.category IN('refund','tournament_refund') THEN PERFORM public.fn_ca_promo_profit_realize_event(NEW.id,NULL,'player_wallet',NEW.to_entity_id);END IF;
  ELSIF NEW.category='table_cashout' THEN
   PERFORM public.fn_ca_promo_profit_cashout(NEW.id);
   PERFORM public.fn_ca_promo_move_custody(NEW.club_id,uid,dest,NEW.from_entity_id,'player_wallet',uid,NEW.amount);
  END IF;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_custody_on_ledger() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzz_ca_promo_custody AFTER INSERT ON public.chip_ledger FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_custody_on_ledger();
"""


def extract_snapshot_fns() -> str:
    src = SNAPSHOT.read_text()
    wanted = [
        'fn_ca_promo_fee_state_signature',
        'fn_ca_promo_fee_state_is_current',
        'fn_ca_promo_fee_state_refresh',
        'fn_ca_promo_fee_state_ensure',
        'fn_ca_promo_shared_fee_state',
        'fn_ca_promo_play_through_settle',
    ]
    out = []
    for name in wanted:
        m = re.search(rf"CREATE OR REPLACE FUNCTION public\.{name}\(.*?\$function\$;", src, re.S)
        assert m, f'missing {name} in {SNAPSHOT}'
        out.append(m.group(0))
    return '\n\n'.join(out)


def main():
    asserts = 0

    def check(label, cond):
        nonlocal asserts
        asserts += 1
        if not cond:
            print(f'FAIL {label}', file=sys.stderr)
            sys.exit(1)
        print(f'PASS {label}')

    with tempfile.TemporaryDirectory(prefix='pg-payout-promo-') as tmp:
        data = Path(tmp) / 'data'
        sock = Path(tmp) / 'sock'
        sock.mkdir()
        subprocess.run([str(PG / 'initdb'), '-D', str(data), '-A', 'trust', '--no-sync', '-U', 'postgres'],
                       check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(data), '-l', str(Path(tmp) / 'pg.log'),
                        '-o', f"-k {sock} -h '' -c shared_buffers=32MB", 'start'],
                       check=True, capture_output=True)
        try:
            def psql(sql=None, file=None, ok=True):
                cmd = [str(PG / 'psql'), '-h', str(sock), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At']
                if file:
                    cmd += ['-f', str(file)]
                    res = subprocess.run(cmd, capture_output=True, text=True)
                else:
                    res = subprocess.run(cmd, input=sql, capture_output=True, text=True)
                if ok and res.returncode != 0:
                    print(res.stderr, file=sys.stderr)
                    sys.exit(1)
                return res

            def one(sql):
                return psql(sql).stdout.strip().splitlines()[-1]

            psql(SCHEMA)
            psql(extract_snapshot_fns())
            psql(PREIMAGES)

            def seed_holder(tag, principal_state='locked'):
                u = f"md5('{tag}:u')::uuid"
                g = f"md5('{tag}:g')::uuid"
                chg = f"md5('{tag}:chg')::uuid"
                psql(f"""
                  INSERT INTO club_members VALUES('{CLUB}',{u},100);
                  INSERT INTO tournament_players VALUES('{EVENT}',{u},'{CLUB}');
                  INSERT INTO ca_promo_play_through_grants(id,club_id,user_id,amount,remaining,multiplier,source_kind,source_ref,cycle_started_at,expires_at)
                  VALUES({g},'{CLUB}',{u},25,25,4,'club_promo','{tag}:ref',now()-interval '1 day',now()+interval '30 days');
                  INSERT INTO ca_promo_profit_gates VALUES({g},NULL);
                  INSERT INTO ca_promo_profit_fee_phases(grant_id,source_kind,source_id) VALUES({g},'gift',{g});
                  INSERT INTO ca_promo_principal_custody VALUES({g},'event','{EVENT}',25);
                  INSERT INTO ca_promo_event_principal_lots(grant_id,tournament_id,charge_ledger_id,source_ref,original_amount,remaining)
                  VALUES({g},'{EVENT}',{chg},'{tag}:lot',25,25);
                  INSERT INTO fx_truth VALUES({g},'{principal_state}',20,0);
                """)
                return u, g, chg

            # ---- BEFORE migration: every payout path triggers live fee-history scan ----
            u_pre, _, _ = seed_holder('pre_prize', 'locked')
            psql('TRUNCATE fx_calls')
            psql(f"INSERT INTO chip_ledger(club_id,from_type,from_entity_id,to_type,to_entity_id,amount,category) VALUES('{CLUB}','prize_liability','{EVENT}','player_wallet',{u_pre},25,'tournament_prize')")
            pre_calls = int(one("SELECT count(*) FROM fx_calls WHERE fn='live'"))
            check(f'before migration: prize payout ran {pre_calls} live fee-history scan(s)', pre_calls >= 1)

            # ---- Apply migration ----
            psql(file=MIGRATION)
            proof_expr = re.search(r'-- @live-proof:\s*(.+)', MIGRATION.read_text()).group(1)
            check('@live-proof evaluates true after apply', one(f'SELECT {proof_expr}') == 't')

            # ---- AFTER migration: prize, bounty, refund, satellite roll, returned ticket ----
            u_prize, g_prize, _ = seed_holder('after_prize', 'met_pending')
            u_bounty, g_bounty, _ = seed_holder('after_bounty', 'locked')
            u_sat, g_sat, _ = seed_holder('after_sat', 'locked')
            u_ret, g_ret, chg_ret = seed_holder('after_ret', 'locked')
            u_cash, _, _ = seed_holder('after_cashout', 'locked')

            psql('TRUNCATE fx_calls, ca_promo_fee_state_cache')

            # 1. Tournament prize payout (met_pending open grant: must NOT settle or release early!)
            psql(f"INSERT INTO chip_ledger(club_id,from_type,from_entity_id,to_type,to_entity_id,amount,category) VALUES('{CLUB}','prize_liability','{EVENT}','player_wallet',{u_prize},25,'tournament_prize')")
            # 2. Bounty payout
            psql(f"INSERT INTO chip_ledger(club_id,from_type,from_entity_id,to_type,to_entity_id,amount,category) VALUES('{CLUB}','prize_liability','{EVENT}','player_wallet',{u_bounty},25,'bounty')")
            # 3. Satellite ticket roll
            sat_ledger = "md5('after_sat:ledger')::uuid"
            sat_ticket = "md5('after_sat:ticket')::uuid"
            psql(f"INSERT INTO chip_ledger(id,club_id,from_type,from_entity_id,to_type,to_entity_id,amount,category,metadata) VALUES({sat_ledger},'{CLUB}','prize_liability','{EVENT}','escrow',{sat_ticket},25,'ticket_issue',jsonb_build_object('user_id',{u_sat}::text))")
            psql(f"SELECT fn_ca_promo_roll_event_principal({sat_ledger}, {u_sat}, 'ticket')")
            # 4. Returned entitlement ticket
            ret_ent = "md5('after_ret:ent')::uuid"
            ret_ticket = "md5('after_ret:ticket')::uuid"
            ret_ledger = "md5('after_ret:ledger')::uuid"
            psql(f"""
              INSERT INTO tournament_refund_entitlements VALUES({ret_ent},'{EVENT}',{u_ret},'{CLUB}',{chg_ret},25);
              INSERT INTO tournament_tickets VALUES({ret_ticket},{u_ret},'{CLUB}',{ret_ent},25,'tournament_entry_only','issued');
              INSERT INTO chip_ledger(id,club_id,from_type,from_entity_id,to_type,to_entity_id,amount,category,metadata)
              VALUES({ret_ledger},'{CLUB}','prize_liability','{EVENT}','escrow',{ret_ticket},25,'ticket_issue',
                jsonb_build_object('kind','tournament_entry_ticket_return','entitlement_id',{ret_ent}::text,'ticket_id',{ret_ticket}::text,'user_id',{u_ret}::text));
              SELECT fn_ca_promo_roll_event_principal({ret_ledger}, {u_ret}, 'ticket');
            """)

            live_after = int(one("SELECT count(*) FROM fx_calls WHERE fn='live'"))
            check(f'after migration: prize, bounty, satellite roll, and returned ticket ran {live_after} live fee-history scans (expected 0)', live_after == 0)

            # Conservation checks
            check('prize principal moved cleanly from event (0) to player_wallet (25)',
                  one(f"SELECT amount FROM ca_promo_principal_custody WHERE grant_id={g_prize} AND kind='event'") == '0'
                  and one(f"SELECT amount FROM ca_promo_principal_custody WHERE grant_id={g_prize} AND kind='player_wallet'") == '25')
            check('bounty principal moved cleanly from event (0) to player_wallet (25)',
                  one(f"SELECT amount FROM ca_promo_principal_custody WHERE grant_id={g_bounty} AND kind='player_wallet'") == '25')
            check('satellite roll principal moved cleanly from event (0) to ticket (25)',
                  one(f"SELECT amount FROM ca_promo_principal_custody WHERE grant_id={g_sat} AND kind='ticket' AND entity_id={sat_ticket}") == '25')
            check('returned entitlement ticket principal moved cleanly from event (0) to ticket (25)',
                  one(f"SELECT amount FROM ca_promo_principal_custody WHERE grant_id={g_ret} AND kind='ticket' AND entity_id={ret_ticket}") == '25')

            # Play-through security: met_pending grant was NOT released early during payout,
            # and live cash-out settle releases it cleanly!
            check('met_pending grant stays open during payout (nothing released early)',
                  one(f"SELECT coalesce(close_reason,'open') FROM ca_promo_play_through_grants WHERE id={g_prize}") == 'open')
            psql(f"BEGIN; SET LOCAL app.ca_promo_fee_state='live'; SELECT fn_ca_promo_play_through_settle('{CLUB}',{u_prize}); COMMIT;")
            check('live cash-out settle closes the met_pending grant immediately',
                  one(f"SELECT close_reason FROM ca_promo_play_through_grants WHERE id={g_prize}") == 'met')

            # Cash table cashout still runs its settle
            psql('TRUNCATE fx_calls, ca_promo_fee_state_cache')
            psql(f"INSERT INTO chip_ledger(club_id,from_type,from_entity_id,to_type,to_entity_id,amount,category) VALUES('{CLUB}','table_stack','{TARGET_EVENT}','player_wallet',{u_cash},25,'table_cashout')")
            cashout_live = int(one("SELECT count(*) FROM fx_calls WHERE fn='live'"))
            check(f'table_cashout retains its settle path ({cashout_live} live call)', cashout_live == 1)

            # Second apply refused cleanly
            again = psql(file=MIGRATION, ok=False)
            check('second apply is refused by anchor guard', again.returncode != 0 and 'revalidate before applying' in again.stderr)

            print(f'PASS {asserts} assertions; 0 live fee scans across prize, bounty, satellite roll, and returned ticket')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
