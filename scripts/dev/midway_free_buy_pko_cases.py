"""Promo-funded admission through the existing registration transaction fixture."""
from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[2]
MIG=ROOT/'supabase/migrations/20261102154336_midway_promo_funded_bounty_only_free_buys.sql'
MIDWAY='fade0000-0000-0000-0000-000000000001'
EVENT='c3000000-0000-4000-8000-000000000001'

def definition(name):
 found=list(re.finditer(r'CREATE OR REPLACE FUNCTION public\.'+re.escape(name)+r'\b.*?\bAS\s+(\$[A-Za-z_0-9]*\$).*?\1\s*;',MIG.read_text(),re.S|re.I))
 assert len(found)==1,name
 return found[0].group(0)

def verify(q,fresh,overlap,register,check):
 fresh('midway_free_buy')
 from tournament_accounting_provenance_cases import install
 install(q)
 for dependency in json.loads((ROOT/'scripts/ci/fixtures/midway-free-buy-pko/registration-dependencies.json').read_text()).values(): q(dependency)
 schema=(ROOT/'scripts/ci/fixtures/midway-free-buy-pko/schema.sql').read_text()
 alterations=[]
 for table,columns in re.findall(r'CREATE TABLE public\.(\w+) \((.*?)\n\);',schema,re.S):
  if q("SELECT to_regclass('public."+table+"') IS NULL")=='t':
   q('CREATE TABLE public.'+table+' ('+columns+');')
  else:
   for column in columns.strip().split(',\n'):
    alterations.append('ALTER TABLE public.'+table+' ADD COLUMN IF NOT EXISTS '+column+';')
 q("\n".join(alterations))
 q("INSERT INTO unions(id) VALUES('"+MIDWAY+"'); INSERT INTO clubs(id,asset,is_platform) VALUES('"+MIDWAY+"','chips',true); INSERT INTO union_clubs(union_id,club_id) VALUES('"+MIDWAY+"','c2000000-0000-4000-8000-000000000001'); UPDATE clubs SET union_id='"+MIDWAY+"' WHERE id='c2000000-0000-4000-8000-000000000001'; INSERT INTO union_wallets(union_id,promo_wallet) VALUES('"+MIDWAY+"',100);")
 for name in ['fn_ca_midway_free_buy_pko','fn_ca_midway_free_buy_promo_head',
   'fn_ca_tournament_escrow_chips','fn_ca_tournament_charge_split',
   'fn_register_for_tournament_before_atomic_capacity_20260907',
   'fn_register_horse_for_tournament_before_maintenance_gate']:
  q(definition(name))
 # The inherited September fixture predates the chip/Diamond dispatcher.
 # This chip-only adapter routes first-sight initialization to the candidate
 # chip shadow; Diamond custody is outside this fixture and remains untouched.
 q("CREATE OR REPLACE FUNCTION public.fn_ca_tournament_escrow(p_tournament_id uuid) RETURNS TABLE(prize_in numeric,bounty_in numeric,fee_in numeric,overlay_in numeric,satellite_in numeric,prize_out numeric,bounty_out numeric,fee_out numeric,refund_out numeric,prize_balance numeric,bounty_balance numeric,fee_balance numeric) LANGUAGE sql STABLE AS $$SELECT * FROM public.fn_ca_tournament_escrow_chips(p_tournament_id)$$;")
 q("UPDATE tournaments SET club_id='"+MIDWAY+"',union_id='"+MIDWAY+"',tournament_type='MTT',free_buy=true,is_pko=true,is_bounty=true,is_mystery_bounty=false,buy_in_amount=0,buy_in_fee=0,bounty_amount=1,guaranteed_prize=0,add_on_available=false,rebuy_cost=1 WHERE id='"+EVENT+"';")
 def state():
  return json.loads(q("""SELECT jsonb_build_object('promo',(SELECT promo_wallet FROM union_wallets WHERE union_id='"""+MIDWAY+"""'),
    'heads',(SELECT sum(current_bounty) FROM tournament_players),
    'pool',(SELECT bounty_pool FROM tournaments),'prize',(SELECT prize_pool FROM tournaments),
    'wallets',(SELECT sum(chip_balance) FROM club_members),
    'promo_legs',(SELECT count(*) FROM chip_ledger WHERE metadata->>'kind'='midway_free_buy_promo_head'));"""))
 result=json.loads(q(register(1,1)));assert result.get('ok') is True,result
 assert state()==dict(promo=99,heads=1,pool=1,prize=0,wallets=2000,promo_legs=1),state()
 check('free registration funds exactly one head from Midway promo, no player charge or prize')
 result=json.loads(q(register(1,1)));assert result.get('ok') is True,result
 assert state()==dict(promo=99,heads=1,pool=1,prize=0,wallets=2000,promo_legs=1),state()
 check('same registration request replay never funds twice')
 overlap(register(2,2),register(2,2))
 assert state()==dict(promo=98,heads=2,pool=2,prize=0,wallets=2000,promo_legs=2),state()
 check('overlapping same registration funds one promo head')

 for dependency in json.loads((ROOT/'tests/fixtures/tournament-accounting-provenance/captured-horse-dependencies.json').read_text()):
  if dependency['signature']=='fn_tournament_entry_cap_reached(uuid)': q(dependency['definition']+';')
 q("UPDATE profiles SET is_horse=true WHERE id='c1000000-0000-4000-8000-000000000003';")
 result=json.loads(q("SELECT fn_register_horse_for_tournament_before_maintenance_gate('"+EVENT+"','c1000000-0000-4000-8000-000000000003');"))
 assert result.get('ok') is True,result
 assert state()==dict(promo=97,heads=3,pool=3,prize=0,wallets=2000,promo_legs=3),state()
 check('horse registration funding core uses the identical free promo-funded head')
 before=state()
 q("BEGIN; "+register(4,4)+" ROLLBACK;")
 assert state()==before,state()
 check('interrupted registration rolls back promo debit, head, roster and receipts')
 assert q("SELECT prize_balance=0 AND bounty_balance=3 AND fee_balance=0 FROM fn_ca_tournament_escrow_chips('"+EVENT+"');")=='t'
 assert q("SELECT prize_balance=0 AND bounty_balance=3 AND fee_balance=0 FROM tournament_escrow WHERE tournament_id='"+EVENT+"';")=='t',q("SELECT row_to_json(e) FROM tournament_escrow e WHERE tournament_id='"+EVENT+"';")
 check('independent journal shadow and stored escrow agree on bounty-only promo custody')
 assert q("SELECT refund_prize=0 AND refund_bounty=1 AND refund_fee=0 FROM fn_ca_tournament_charge_split('"+EVENT+"','rebuy',1);")=='t'
 check('one-chip rebuy entitlement allocates zero rake and zero place prize')
 q("CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;")
 q(definition('fn_ca_process_tournament_chip_purchase_money_v1'))
 q("UPDATE tournaments SET is_rebuy=true,is_reentry=true,rebuy_chips=3000,max_rebuys=NULL,rebuy_levels=12,late_reg_levels=12,current_level=0; UPDATE tournament_players SET chips=0 WHERE user_id='c1000000-0000-4000-8000-000000000001';")
 purchase="SET test.actor='c1000000-0000-4000-8000-000000000001'; SELECT fn_ca_process_tournament_chip_purchase_money_v1('"+EVENT+"','c1000000-0000-4000-8000-000000000001','rebuy',1,3000,0,'midway-rebuy-one');"
 result=json.loads(q(purchase));assert result.get('success') is True,result
 assert state()==dict(promo=97,heads=4,pool=4,prize=0,wallets=1999,promo_legs=3),state()
 assert q("SELECT prize_balance=0 AND bounty_balance=4 AND fee_balance=0 FROM tournament_escrow WHERE tournament_id='"+EVENT+"';")=='t'
 assert q("SELECT refund_prize=0 AND refund_bounty=1 AND refund_fee=0 FROM tournament_refund_entitlements WHERE charge_category='rebuy';")=='t'
 before=state();result=json.loads(q(purchase));assert result.get('idempotent') is True,result
 assert state()==before,state()
 check('actual paid rebuy core moves one player chip entirely to bounty custody, with replay protection')

 q("ALTER TABLE tournament_unregistration_receipts ADD COLUMN IF NOT EXISTS start_authority text NOT NULL DEFAULT 'scheduled_clock'; CREATE TABLE IF NOT EXISTS hand_history(id uuid,tournament_id uuid,table_id uuid); CREATE TABLE IF NOT EXISTS tournament_launch_receipts(tournament_id uuid,completed_at timestamptz,launch_id uuid); UPDATE tournaments SET format_contract='mtt-v1';")
 q(json.loads((ROOT/'scripts/ci/fixtures/midway-free-buy-pko/accounting-functions.json').read_text())['fn_ca_lock_settlement_lane_for_tournament'])
 q(definition('fn_ca_unregister_tournament_player_exact'))
 leave="SET test.actor='c1000000-0000-4000-8000-000000000002'; SELECT fn_ca_unregister_tournament_player_exact('"+EVENT+"','c1000000-0000-4000-8000-000000000002',NULL,NULL,'c9000000-0000-4000-8000-000000000002');"
 result=json.loads(q(leave));assert result.get('ok') is True,result
 assert state()==dict(promo=98,heads=3,pool=3,prize=0,wallets=1999,promo_legs=4),state()
 assert q("SELECT prize_balance=0 AND bounty_balance=3 AND fee_balance=0 FROM tournament_escrow WHERE tournament_id='"+EVENT+"';")=='t'
 before=state();result=json.loads(q(leave));assert result.get('replayed') is True,result
 assert state()==before,state()
 check('actual unregistration returns the promo head only to Midway and replays without another credit')

 # Restore the tracked platform source seed from migration20260905203123.
 q("INSERT INTO ca_settle_sources(source,note) VALUES('fn_unregister_from_tournament','DB caller') ON CONFLICT(source) DO NOTHING;")
 paid_leave=leave.replace('c1000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001').replace('c9000000-0000-4000-8000-000000000002','c9000000-0000-4000-8000-000000000001')
 result=json.loads(q(paid_leave));assert result.get('ok') is True,result
 assert state()==dict(promo=99,heads=1,pool=1,prize=0,wallets=2000,promo_legs=5),state()
 assert q("SELECT prize_balance=0 AND bounty_balance=1 AND fee_balance=0 FROM tournament_escrow WHERE tournament_id='"+EVENT+"';")=='t'
 check('withdrawal after a paid rebuy returns sponsor chip to Midway and purchased chip to its original player wallet')
