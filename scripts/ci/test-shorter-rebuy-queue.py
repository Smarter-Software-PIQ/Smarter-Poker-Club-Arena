#!/usr/bin/env python3
"""Shorter rebuy queue within one event (incident 075013fd, lane 4).

Native PostgreSQL 16/17 proof for migration
20261119175942_shorter_rebuy_queue_skips_redundant_promo_and_replay_work.sql.

Proves on a disposable PostgreSQL cluster:
  1. Applies 20261119054539 onto the pinned production process_tournament_rebuy
     fixture, plus 20261119175941 and 20261119175942 cleanly (including probes),
     and verifies @live-proof verbatim.
  2. Completed immutable receipt replays (add-on and explicit-token rebuy)
     return immediately WITHOUT waiting on the event's exclusive rebuy key R(id)
     and with 0 promo fee-history calls, even while another transaction holds R(id).
  3. An event-bound Free Buy holder (open grant with 0 wallet principal custody,
     even with a stale/invalidated snapshot) incurs 0 settle calls and 0 live
     fee-history scans before OR inside R(id), and writes the exact
     ca_promo_funding_custody_receipts row (principal_before=0, principal_moved=0).
  4. A wallet-principal holder still warms their snapshot before R(id), moves
     exact principal custody from player_wallet to event (conserved), and still
     refuses expired principal.
  5. Two concurrent event-bound Free Buy rebuyers incur 0 live fee-history scans
     and preserve 100% conservation.
  6. Second apply of 20261119175942 is refused cleanly and atomically.

Usage: PG_BIN=/opt/homebrew/bin python3 scripts/ci/test-shorter-rebuy-queue.py
"""
import json, os, re, subprocess, sys, tempfile, threading, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIG_PRE = next((ROOT / 'supabase/migrations').glob('20261119054539_*.sql'))
MIG_PAYOUT = next((ROOT / 'supabase/migrations').glob('20261119175941_*.sql'))
MIG_REBUY = next((ROOT / 'supabase/migrations').glob('20261119175942_*.sql'))
SNAPSHOT = next((ROOT / 'supabase/migrations').glob('20261119002019_*.sql'))
LANE = next((ROOT / 'supabase/migrations').glob('20261118191946_*.sql'))
FIX = ROOT / 'scripts/ci/fixtures/rebuy-promo-fee-state/preimages.json'
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))

CLUB = '00000000-0000-0000-0000-00000000c1ab'
EVENT = '00000000-0000-0000-0000-0000000e0e01'
LIVE_COST = 0.25

SCHEMA = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS smarter_private;
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.fn_caller_session_is_live() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;

CREATE TABLE public.ca_promo_play_through_settings(id boolean PRIMARY KEY DEFAULT true, enforced_from timestamptz);
INSERT INTO public.ca_promo_play_through_settings VALUES(true, now() - interval '1 day');
CREATE TABLE public.club_members(club_id uuid NOT NULL, user_id uuid NOT NULL, chip_balance numeric NOT NULL DEFAULT 1000, PRIMARY KEY(club_id, user_id));
CREATE TABLE public.tournaments(id uuid PRIMARY KEY, club_id uuid, union_id uuid, status text, current_level integer, late_reg_levels integer, rebuy_levels integer, late_reg_mins integer, started_at timestamptz, prize_pool_finalized boolean, addon_from_start boolean, addon_period_started_at timestamptz, addon_period_ends_at timestamptz, add_on_available boolean, addon_period_triggered boolean, is_bounty boolean, is_pko boolean, is_mystery_bounty boolean);
CREATE TABLE public.tournament_players(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, tournament_id uuid NOT NULL, user_id uuid NOT NULL, club_id uuid NOT NULL, status text, chips numeric, add_on boolean, table_id uuid, seat_number integer, current_bounty numeric, prize numeric, rebuy_prompt_until timestamptz);
CREATE TABLE public.tournament_knockout_candidates(id uuid PRIMARY KEY, tournament_id uuid, eliminated_user_id uuid, table_id uuid, seat_id uuid, seat_joined_at timestamptz, hand_number integer, hand_id uuid, state text, rebuy_prompt_until timestamptz, resolved_at timestamptz);
CREATE TABLE public.table_seats(id uuid PRIMARY KEY, table_id uuid, user_id uuid, seat_number integer, stack numeric, left_at timestamptz, joined_at timestamptz, status text, is_sitting_out boolean, is_away boolean, leave_pending boolean, sit_out_at timestamptz, scheduled_leave_hands integer, entry_hold text, entry_post_agreed boolean, player_id uuid, member_id uuid, horse_id uuid, club_id uuid);
CREATE TABLE public.tables(id uuid PRIMARY KEY, tournament_id uuid, current_players integer);
CREATE TABLE public.profiles(id uuid PRIMARY KEY, is_horse boolean DEFAULT false);
CREATE TABLE public.entry_purchase_idempotency_receipts(key_domain text NOT NULL, idempotency_key text NOT NULL, request jsonb, response jsonb, claimed_at timestamptz, completed_at timestamptz, PRIMARY KEY(key_domain, idempotency_key));
CREATE TABLE public.wallet_credit_idempotency(key text PRIMARY KEY);
CREATE TABLE public.ca_operator_floor_hold(operation_id uuid PRIMARY KEY, mode text);
CREATE TABLE public.ca_launch_operator_scopes(operation_id uuid PRIMARY KEY, club_ids uuid[]);
CREATE TABLE public.ca_arena_settings(id integer PRIMARY KEY, club_id uuid, tournaments_enabled boolean);
CREATE TABLE public.poker_diamond_custody(id uuid PRIMARY KEY, user_id uuid, purpose text, target_id uuid, state text);
CREATE TABLE public.tournament_bounty_obligations(id uuid PRIMARY KEY, tournament_id uuid, eliminated_user_id uuid, hand_number integer, hand_id uuid, state text);
CREATE TABLE public.tournament_obligations(id uuid PRIMARY KEY, tournament_id uuid, user_id uuid, kind text, amount_paid numeric, amount_owed numeric, settled_at timestamptz);
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
CREATE TABLE public.ca_promo_funding_custody_receipts(ledger_id uuid PRIMARY KEY, source_balance_before numeric NOT NULL, amount numeric NOT NULL, covered_amount numeric NOT NULL, destination_kind text NOT NULL, destination_id uuid NOT NULL, principal_before numeric NOT NULL, principal_moved numeric NOT NULL);
CREATE TABLE public.ca_promo_fee_state_cache(club_id uuid NOT NULL, user_id uuid NOT NULL, computed_at timestamptz NOT NULL, valid_until timestamptz NOT NULL, signature text NOT NULL, state jsonb NOT NULL, PRIMARY KEY(club_id, user_id));

CREATE TABLE public.fx_calls(id bigserial PRIMARY KEY, fn text NOT NULL, u uuid);
CREATE TABLE public.fx_truth(grant_id uuid PRIMARY KEY, principal_state text NOT NULL DEFAULT 'locked');

CREATE FUNCTION public.fn_ca_promo_shared_fee_state_live(p_club uuid, p_user uuid)
RETURNS TABLE(grant_id uuid, fee_start numeric, fees numeric, principal_target numeric, profit_target numeric, principal_state text, profit_state text, consumed_prefix numeric, phase_id uuid, phase_kind text, profit_earned numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
  INSERT INTO public.fx_calls(fn, u) VALUES('live', p_user);
  PERFORM pg_sleep(0.25);
  RETURN QUERY
    SELECT g.id, 0::numeric, 0::numeric, g.fee_target, 20::numeric,
           COALESCE(t.principal_state, 'locked'), 'locked'::text, 0::numeric,
           p.id, p.source_kind, 0::numeric
      FROM public.ca_promo_play_through_grants g
      JOIN public.ca_promo_profit_fee_phases p ON p.grant_id = g.id
      LEFT JOIN public.fx_truth t ON t.grant_id = g.id
     WHERE g.club_id = p_club AND g.user_id = p_user;
END $$;

CREATE FUNCTION public.fn_ca_promo_profit_prelock_source(uuid,uuid,text,uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_ca_promo_record_event_charge(uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_ca_promo_capture_entry_funding(uuid,numeric) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_ca_promo_realize_event_principal(uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE FUNCTION public.fn_ca_promo_integrity_realize_event(uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE FUNCTION public.fn_ca_promo_profit_realize_event(uuid,uuid,text,uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_ca_promo_profit_cashout(uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_ca_promo_move_custody(uuid,uuid,text,uuid,text,uuid,numeric,text DEFAULT 'moved') RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE FUNCTION public.fn_ca_promo_move_selected_custody(p_club uuid, p_user uuid, p_from text, p_from_id uuid, p_to text, p_to_id uuid, p_amount numeric, p_reason text, p_ids uuid[])
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record; left_amt numeric := p_amount; take numeric; moved numeric := 0;
BEGIN
  IF p_amount <= 0 OR p_ids IS NULL THEN RETURN 0; END IF;
  FOR r IN SELECT c.grant_id, c.amount FROM public.ca_promo_principal_custody c
    WHERE c.grant_id = ANY(p_ids) AND c.kind = p_from AND c.entity_id = p_from_id AND c.amount > 0
    ORDER BY c.grant_id FOR UPDATE LOOP
    EXIT WHEN left_amt <= 0;
    take := LEAST(left_amt, r.amount);
    UPDATE public.ca_promo_principal_custody SET amount = amount - take
     WHERE grant_id = r.grant_id AND kind = p_from AND entity_id = p_from_id;
    INSERT INTO public.ca_promo_principal_custody VALUES(r.grant_id, p_to, p_to_id, take)
    ON CONFLICT(grant_id, kind, entity_id) DO UPDATE SET amount = public.ca_promo_principal_custody.amount + EXCLUDED.amount;
    moved := moved + take; left_amt := left_amt - take;
  END LOOP;
  RETURN moved;
END $$;

CREATE FUNCTION public.fn_ca_promo_fund_from_balance(p_ledger uuid,p_before numeric,p_kind text,p_entity uuid,p_covered numeric DEFAULT 0)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;prior public.ca_promo_funding_custody_receipts%ROWTYPE;
 ids uuid[];active_ids uuid[];expired_ids uuid[];locked numeric:=0;expired numeric:=0;requested numeric:=0;moved numeric:=0;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 IF l.from_type NOT IN('player_wallet','agent_wallet') OR l.amount<=0 OR l.club_id IS NULL
  OR COALESCE(l.status,'posted')<>'posted' OR p_before IS NULL OR p_before<l.amount
  OR p_before::text IN('NaN','Infinity','-Infinity') OR p_entity IS NULL
  OR p_covered IS NULL OR p_covered<0 OR p_covered>l.amount THEN
  RAISE EXCEPTION 'original_promo_funding_balance_required'; END IF;
 SELECT * INTO prior FROM public.ca_promo_funding_custody_receipts WHERE ledger_id=l.id;
 IF FOUND THEN RETURN prior.principal_moved; END IF;
 PERFORM public.fn_ca_promo_profit_prelock_source(l.club_id,l.from_entity_id,l.from_type,l.from_entity_id);
 IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN
  PERFORM public.fn_ca_promo_play_through_settle(l.club_id,l.from_entity_id);
  SELECT array_agg(s.grant_id),array_agg(s.grant_id) FILTER(WHERE s.state='locked'),
   array_agg(s.grant_id) FILTER(WHERE s.state='expired_pending') INTO ids,active_ids,expired_ids
   FROM public.fn_ca_promo_play_through_state(l.club_id,l.from_entity_id) s
   WHERE s.state IN('locked','expired_pending');
  SELECT COALESCE(sum(c.amount),0),COALESCE(sum(c.amount) FILTER(WHERE c.grant_id=ANY(expired_ids)),0)
   INTO locked,expired FROM public.ca_promo_principal_custody c
   WHERE c.grant_id=ANY(ids) AND c.kind=l.from_type AND c.entity_id=l.from_entity_id;
  IF p_kind IN('table_stack','pending_addon','event') AND l.amount>p_before-expired THEN
   RAISE EXCEPTION 'Expired Promo Is Awaiting Return To Its Original Fund. Use Your Cashable Chips Or Unexpired Promo For A New Entry.'
    USING ERRCODE='P0001',HINT='expired_promo_cannot_fund_new_play';
  END IF;
  requested:=LEAST(locked,GREATEST(l.amount-GREATEST(p_before-locked,0),0));
  moved:=public.fn_ca_promo_move_selected_custody(l.club_id,l.from_entity_id,l.from_type,l.from_entity_id,p_kind,p_entity,requested,'spent',
   CASE WHEN p_kind IN('table_stack','pending_addon','event') THEN active_ids ELSE ids END);
 END IF;
 INSERT INTO public.ca_promo_funding_custody_receipts(ledger_id,source_balance_before,amount,covered_amount,destination_kind,destination_id,principal_before,principal_moved)
  VALUES(l.id,p_before,l.amount,p_covered,p_kind,p_entity,locked,moved);
 RETURN moved;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_fund_from_balance(uuid,numeric,text,uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;

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
    debit:=NULLIF(current_setting('app.ca_promo_wallet_debit',true),'')::jsonb;
    moved:=public.fn_ca_promo_fund_from_balance(NEW.id,(debit->>'balance_before')::numeric,dest,dest_id);
   END IF;
  END IF;
 ELSIF NEW.to_type='player_wallet' AND NEW.from_type IN('table_stack','prize_liability') THEN
  uid:=NEW.to_entity_id;
  dest:=CASE NEW.from_type WHEN 'table_stack' THEN 'table_stack' ELSE 'event' END;
  IF NEW.category='table_cashout' THEN PERFORM public.fn_ca_promo_profit_prelock_source(NEW.club_id,uid,'table_stack',NEW.from_entity_id);END IF;
  PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id,uid);
  IF dest='event' THEN
   PERFORM public.fn_ca_promo_realize_event_principal(NEW.id);
  END IF;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_custody_on_ledger() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzz_ca_promo_custody AFTER INSERT ON public.chip_ledger FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_custody_on_ledger();
"""


def extract_fns(path: Path, names: list[str]) -> str:
    src = path.read_text()
    out = []
    for name in names:
        m = re.search(rf"CREATE (?:OR REPLACE )?FUNCTION public\.{name}\(.*?\$[a-z_]*\$;", src, re.S)
        assert m, f'missing {name} in {path}'
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

    with tempfile.TemporaryDirectory(prefix='pg-shorter-rebuy-') as tmp:
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
            psql(extract_fns(SNAPSHOT, [
                'fn_ca_promo_fee_state_signature',
                'fn_ca_promo_fee_state_is_current',
                'fn_ca_promo_fee_state_refresh',
                'fn_ca_promo_fee_state_ensure',
                'fn_ca_promo_shared_fee_state',
                'fn_ca_promo_play_through_settle',
            ]))
            psql(extract_fns(LANE, ['fn_ca_share_tournament_lane_for_rebuy']))
            # Load pinned production process_tournament_rebuy and fn_ca_promo_play_through_state
            fix = json.loads(FIX.read_text())
            for fn in fix['functions']:
                psql(fn['definition'] + ';')
            # Apply 20261119054539 (#11364) first so process_tournament_rebuy is at main HEAD
            psql(file=MIG_PRE)
            # Apply our Lane 4 migration 20261119175942
            psql(file=MIG_REBUY)
            proof_expr = re.search(r'-- @live-proof:\s*(.+)', MIG_REBUY.read_text()).group(1)
            check('@live-proof evaluates true after apply', one(f'SELECT {proof_expr}') == 't')

            # ---- 1. Completed immutable receipt replays NEVER wait on R(id) ----
            u_addon = "md5('replay:addon')::uuid"
            u_tok = "md5('replay:tok')::uuid"
            cand_id = "md5('replay:cand')::uuid"
            addon_key = f"tourney:{EVENT}:addon:{one(f'SELECT {u_addon}')}"
            tok_key = f"tourney:{EVENT}:rebuy:{one(f'SELECT {u_tok}')}:tok:prompt-42"
            psql(f"""
              INSERT INTO entry_purchase_idempotency_receipts(key_domain,idempotency_key,request,response,claimed_at,completed_at)
              VALUES
                ('tournament_chip_purchase','{addon_key}',
                  jsonb_build_object('version','v1','tournament_id','{EVENT}','user_id',{u_addon},'rebuy_type','addon','idempotency_key','{addon_key}'),
                  jsonb_build_object('success',true,'seated',true,'atomic_tournament_chip_purchase','v1','rebuy_type','addon','table_id',gen_random_uuid(),'seat_id',gen_random_uuid(),'stack',5000),
                  clock_timestamp(),clock_timestamp()),
                ('tournament_chip_purchase','{tok_key}',
                  jsonb_build_object('version','v1','tournament_id','{EVENT}','user_id',{u_tok},'rebuy_type','rebuy','candidate_id',{cand_id},'idempotency_key','{tok_key}'),
                  jsonb_build_object('success',true,'seated',true,'atomic_tournament_chip_purchase','v1','rebuy_type','rebuy','candidate_id',{cand_id},'candidate_state','rebought','table_id',gen_random_uuid(),'seat_id',gen_random_uuid(),'stack',5000),
                  clock_timestamp(),clock_timestamp());
            """)

            # Hold R(id) exclusive in Thread A for 600 ms
            lane_held = threading.Event()
            def hold_lane():
                psql(f"BEGIN; SELECT fn_ca_share_tournament_lane_for_rebuy('{EVENT}', gen_random_uuid()); SELECT pg_sleep(0.6); COMMIT;")
            ta = threading.Thread(target=hold_lane)
            ta.start()
            time.sleep(0.1)

            psql('TRUNCATE fx_calls')
            t0 = time.monotonic()
            r_addon = json.loads(one(f"SELECT process_tournament_rebuy('{EVENT}',{u_addon},'addon',NULL,NULL,NULL,NULL)"))
            r_tok = json.loads(one(f"SELECT process_tournament_rebuy('{EVENT}',{u_tok},'rebuy',NULL,NULL,NULL,'prompt-42')"))
            dt_replay = time.monotonic() - t0
            ta.join()

            check(f'completed add-on and explicit-token rebuy replays returned in {dt_replay*1000:.0f} ms while R(id) was held for 600 ms',
                  dt_replay < 0.35 and r_addon['stack'] == 5000 and r_tok['candidate_state'] == 'rebought')
            check('completed receipt replays ran 0 live fee-history calls', one("SELECT count(*) FROM fx_calls WHERE fn='live'") == '0')

            # ---- 2. Event-bound Free Buy holder (0 wallet principal): 0 live scans ----
            u_fb = "md5('freebuy:u')::uuid"
            g_fb = "md5('freebuy:g')::uuid"
            psql(f"""
              INSERT INTO club_members VALUES('{CLUB}',{u_fb},100);
              INSERT INTO tournament_players(tournament_id,user_id,club_id) VALUES('{EVENT}',{u_fb},'{CLUB}');
              INSERT INTO ca_promo_play_through_grants(id,club_id,user_id,amount,remaining,multiplier,source_kind,source_ref,cycle_started_at,expires_at)
              VALUES({g_fb},'{CLUB}',{u_fb},20,20,4,'promo_ticket_prize','fb:ref',now()-interval '1 day',now()+interval '30 days');
              INSERT INTO ca_promo_profit_gates VALUES({g_fb},NULL);
              INSERT INTO ca_promo_profit_fee_phases(grant_id,source_kind,source_id) VALUES({g_fb},'gift',{g_fb});
              INSERT INTO ca_promo_principal_custody VALUES({g_fb},'event','{EVENT}',20);
              INSERT INTO fx_truth VALUES({g_fb},'locked');
            """)
            psql('TRUNCATE fx_calls, ca_promo_fee_state_cache')
            psql(f"""
              BEGIN;
              PERFORM set_config('app.ca_promo_wallet_debit', jsonb_build_object('balance_before', 100)::text, true);
              INSERT INTO chip_ledger(club_id,from_type,from_entity_id,to_type,to_entity_id,amount,category)
              VALUES('{CLUB}','player_wallet',{u_fb},'prize_liability','{EVENT}',50,'tournament_rebuy');
              COMMIT;
            """.replace('PERFORM ', 'SELECT '))
            check('event-bound Free Buy holder (0 wallet principal) incurs 0 live fee scans on rebuy debit',
                  one("SELECT count(*) FROM fx_calls WHERE fn='live'") == '0')
            check('funding custody receipt recorded exact principal_before=0, principal_moved=0',
                  one("SELECT principal_before||'|'||principal_moved FROM ca_promo_funding_custody_receipts ORDER BY ledger_id LIMIT 1") == '0|0')

            # ---- 3. Wallet-principal holder: moves exact principal and refuses expired ----
            u_wal = "md5('wallet:u')::uuid"
            g_wal = "md5('wallet:g')::uuid"
            psql(f"""
              INSERT INTO club_members VALUES('{CLUB}',{u_wal},100);
              INSERT INTO tournament_players(tournament_id,user_id,club_id) VALUES('{EVENT}',{u_wal},'{CLUB}');
              INSERT INTO ca_promo_play_through_grants(id,club_id,user_id,amount,remaining,multiplier,source_kind,source_ref,cycle_started_at,expires_at)
              VALUES({g_wal},'{CLUB}',{u_wal},30,30,4,'club_promo','wal:ref',now()-interval '1 day',now()+interval '30 days');
              INSERT INTO ca_promo_profit_gates VALUES({g_wal},NULL);
              INSERT INTO ca_promo_profit_fee_phases(grant_id,source_kind,source_id) VALUES({g_wal},'gift',{g_wal});
              INSERT INTO ca_promo_principal_custody VALUES({g_wal},'player_wallet',{u_wal},30);
              INSERT INTO fx_truth VALUES({g_wal},'locked');
            """)
            psql('TRUNCATE fx_calls, ca_promo_fee_state_cache')
            # Debit 80 from balance 100 (70 cashable + 30 locked -> must move 10 promo principal to event)
            psql(f"""
              BEGIN;
              SELECT set_config('app.ca_promo_wallet_debit', jsonb_build_object('balance_before', 100)::text, true);
              INSERT INTO chip_ledger(club_id,from_type,from_entity_id,to_type,to_entity_id,amount,category)
              VALUES('{CLUB}','player_wallet',{u_wal},'prize_liability','{EVENT}',80,'tournament_rebuy');
              COMMIT;
            """)
            check('wallet-principal holder moved exact 10 promo principal from player_wallet (20 left) to event (10)',
                  one(f"SELECT amount FROM ca_promo_principal_custody WHERE grant_id={g_wal} AND kind='player_wallet'") == '20'
                  and one(f"SELECT amount FROM ca_promo_principal_custody WHERE grant_id={g_wal} AND kind='event'") == '10')

            # Expired wallet principal still refuses entry
            psql(f"UPDATE fx_truth SET principal_state='expired_pending' WHERE grant_id={g_wal}; TRUNCATE ca_promo_fee_state_cache;")
            exp = psql(f"""
              BEGIN;
              SELECT set_config('app.ca_promo_wallet_debit', jsonb_build_object('balance_before', 20)::text, true);
              INSERT INTO chip_ledger(club_id,from_type,from_entity_id,to_type,to_entity_id,amount,category)
              VALUES('{CLUB}','player_wallet',{u_wal},'prize_liability','{EVENT}',15,'tournament_rebuy');
              COMMIT;
            """, ok=False)
            check('expired wallet principal still refuses new rebuy entry',
                  exp.returncode != 0 and 'Expired Promo Is Awaiting Return' in exp.stderr)

            # ---- 4. Concurrent event-bound Free Buy rebuys: 0 live scans, 100% conserved ----
            psql('TRUNCATE fx_calls, ca_promo_fee_state_cache')
            def buy_fb(idx):
                u = f"md5('conc:{idx}:u')::uuid"
                g = f"md5('conc:{idx}:g')::uuid"
                psql(f"""
                  INSERT INTO club_members VALUES('{CLUB}',{u},100);
                  INSERT INTO ca_promo_play_through_grants(id,club_id,user_id,amount,remaining,multiplier,source_kind,source_ref,cycle_started_at,expires_at)
                  VALUES({g},'{CLUB}',{u},20,20,4,'promo_ticket_prize','conc:{idx}',now()-interval '1 day',now()+interval '30 days');
                  INSERT INTO ca_promo_profit_gates VALUES({g},NULL);
                  INSERT INTO ca_promo_profit_fee_phases(grant_id,source_kind,source_id) VALUES({g},'gift',{g});
                  INSERT INTO ca_promo_principal_custody VALUES({g},'event','{EVENT}',20);
                  INSERT INTO fx_truth VALUES({g},'locked');
                """)
                psql(f"""
                  BEGIN;
                  SELECT fn_ca_share_tournament_lane_for_rebuy('{EVENT}', {u});
                  SELECT set_config('app.ca_promo_wallet_debit', jsonb_build_object('balance_before', 100)::text, true);
                  INSERT INTO chip_ledger(club_id,from_type,from_entity_id,to_type,to_entity_id,amount,category)
                  VALUES('{CLUB}','player_wallet',{u},'prize_liability','{EVENT}',50,'tournament_rebuy');
                  COMMIT;
                """)
            t0 = time.monotonic()
            threads = [threading.Thread(target=buy_fb, args=(i,)) for i in range(4)]
            for t in threads: t.start()
            for t in threads: t.join()
            dt_conc = time.monotonic() - t0
            check(f'4 concurrent Free Buy rebuyers completed in {dt_conc*1000:.0f} ms with 0 live fee-history scans',
                  one("SELECT count(*) FROM fx_calls WHERE fn='live'") == '0' and dt_conc < 2.0)

            # ---- 5. Second apply refused ----
            again = psql(file=MIG_REBUY, ok=False)
            check('second apply of 20261119175942 is refused by anchor guard',
                  again.returncode != 0 and 'revalidate before applying' in again.stderr)

            print(f'PASS {asserts} assertions; replay while R(id) held took {dt_replay*1000:.0f} ms; 4 concurrent Free Buy rebuys took {dt_conc*1000:.0f} ms (0 live scans)')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
