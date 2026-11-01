#!/usr/bin/env python3
"""Spin owner commands against retained actual financial owners, socket-only PG."""
import argparse, hashlib, json, sys
from pathlib import Path
sys.dont_write_bytecode = True
from satellite_qualifier_fixture import module
from tournament_abort_fixture import install_financial_foundation
from tournament_abort_native import sql_file
ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT/'supabase/migrations/20261101024022_spin_owner_commands_retain_their_original_request_receipt.sql'

def main():
    p=argparse.ArgumentParser()
    for name in ('evidence','work-root','socket-root','pg-bin'): p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args(); a.evidence.mkdir(parents=True,exist_ok=False)
    a.work_root.mkdir(parents=True,exist_ok=True); a.socket_root.mkdir(parents=True,exist_ok=True)
    native=module(ROOT/'scripts/ci/test-mtt-unlimited.py','spin_native')
    e=native.Execution(ROOT,a.evidence,a.pg_bin,a.work_root,600,socket_parent=a.socket_root)
    try:
        e.start(); db=e.database(); install_financial_foundation(e,db,ROOT,a.evidence)
        for filename in ('current-financial-owners.json','current-ledger-helpers.json'):
            path=ROOT/'scripts/ci/fixtures/spin-owner-command'/filename
            ddl='SET check_function_bodies=off;'
            for row in json.loads(path.read_text()):
                assert hashlib.md5(row['definition'].encode()).hexdigest()==row['definition_md5']
                ddl+=row['definition']+';'
            sql_file(e,db,filename.removesuffix('.json'),ddl)
            e.report['source_sha256'][str(path.relative_to(ROOT))]=hashlib.sha256(path.read_bytes()).hexdigest()
        # First exercise the real nested declaration helper, before attributing
        # any refusal to request identity. No substitute ledger implementation.
        e.sql(db,"BEGIN;SELECT public.fn_ca_ledger_declaration_restore(public.fn_ca_ledger_declaration_save(ARRAY['spin_bonus_pools']));ROLLBACK;",label='current-actual-ledger-save-restore')
        e.sql(db,file=MIGRATION,label='exact-command-migration')
        coverage=ROOT/'supabase/migrations/20260911161027_the_supply_meter_counts_the_tickets_it_issued.sql'
        assert "('spin_reserve',        'counted', 'spin_pools + union spin_reserve_wallet', 'spin_bonus_pools balance')" in coverage.read_text()
        assert "('union_bank',          'counted', 'union_wallets',                 'union_wallets chip_balance')" in coverage.read_text()
        e.report['source_sha256'][str(coverage.relative_to(ROOT))]=hashlib.sha256(coverage.read_bytes()).hexdigest()
        sql_file(e,db,'retained-spin-coverage',"INSERT INTO public.ca_chip_store_coverage(store,treatment,counted_by,notes) VALUES ('spin_reserve','counted','spin_pools + union spin_reserve_wallet','spin_bonus_pools balance') ON CONFLICT(store) DO NOTHING;")
        sql_file(e,db,'retained-union-coverage',"INSERT INTO public.ca_chip_store_coverage(store,treatment,counted_by,notes) VALUES ('union_bank','counted','union_wallets','union_wallets chip_balance') ON CONFLICT(store) DO NOTHING;")
        sql_file(e,db,'synthetic-owner-opening',"""BEGIN;
SET LOCAL session_replication_role=replica;
INSERT INTO auth.users(id) VALUES ('a1000000-0000-4000-8000-000000000001');
INSERT INTO auth.users(id) VALUES ('2d1cd6c3-5700-4af9-a271-d4863fdab20d');
INSERT INTO public.users(id,username) VALUES ('2d1cd6c3-5700-4af9-a271-d4863fdab20d','smarterpoker');
INSERT INTO public.users(id,username) VALUES ('a1000000-0000-4000-8000-000000000001','spin_owner_native');
INSERT INTO public.profiles(id,username,display_name) VALUES ('a1000000-0000-4000-8000-000000000001','spin_owner_native','Spin Native Owner');
INSERT INTO public.clubs(id,club_id,name,owner_id,chip_treasury) VALUES ('a2000000-0000-4000-8000-000000000001',998181,'Spin Native Club','a1000000-0000-4000-8000-000000000001',10000);
COMMIT;""")
        service="SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',false),set_config('request.jwt.claim.role','service_role',false);SET ROLE service_role;SET statement_timeout='8s';"
        activate="public.fn_spin_owner_command('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','activate',200,1,'chip_treasury')"
        deactivate="public.fn_spin_owner_command('a3000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','deactivate')"
        e.sql(db,'BEGIN;'+service+"SELECT public.fn_spin_activate('a2000000-0000-4000-8000-000000000001',200,1,'chip_treasury','a1000000-0000-4000-8000-000000000001');SELECT public.fn_spin_deactivate('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001');SELECT public.fn_spin_activate('a2000000-0000-4000-8000-000000000001',200,1,'chip_treasury','a1000000-0000-4000-8000-000000000001');RESET ROLE;DO $$BEGIN IF (SELECT chip_treasury FROM clubs WHERE id='a2000000-0000-4000-8000-000000000001')<>9800 OR (SELECT count(*) FROM spin_reserve_ledger WHERE kind='seed')<>2 THEN RAISE EXCEPTION 'baseline duplicate debit not reproduced';END IF;END$$;ROLLBACK;",label='unkeyed-original-reproduces-second-debit-then-rolls-back')
        _,first,_=e.sql(db,service+'SELECT '+activate+';',label='actual-first-activation')
        _,off,_=e.sql(db,service+'SELECT '+deactivate+';',label='actual-intervening-deactivation')
        _,replay,_=e.sql(db,service+'SELECT '+activate+';',label='original-activation-replayed')
        assert first==replay
        assert json.loads(first.strip().splitlines()[-1])['ok'] is True
        assert json.loads(off.strip().splitlines()[-1])['ok'] is True
        _,state,_=e.sql(db,"SELECT jsonb_build_object('wallet',c.chip_treasury,'active',p.is_active,'seed',p.seeded_amount,'receipts',(SELECT count(*) FROM smarter_private.spin_owner_command_receipts)) FROM clubs c JOIN spin_bonus_pools p ON p.club_id=c.id WHERE c.id='a2000000-0000-4000-8000-000000000001';",label='replay-preserves-wallet-and-off-state')
        assert json.loads(state)=={'wallet':10000,'active':False,'seed':0,'receipts':2},state
        from spin_owner_command_cases import exercise
        exercise(e,db,ROOT,service,activate,deactivate)
        _,postimages,_=e.sql(db,"SELECT jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) FROM pg_proc p WHERE p.oid IN ('public.fn_spin_owner_command(uuid,uuid,uuid,uuid,text,numeric,numeric,text)'::regprocedure,'smarter_private.spin_owner_command_receipt_is_immutable()'::regprocedure);",label='qualified-command-postimages')
        e.report['postimages']=json.loads(postimages)
        proof=next(line.removeprefix('-- @live-proof: ') for line in MIGRATION.read_text().splitlines() if line.startswith('-- @live-proof: '))
        assert e.sql(db,'SELECT '+proof+';',label='exact-installed-live-proof')[1].strip()=='t'
        for path in (MIGRATION,Path(__file__),ROOT/'scripts/ci/spin_owner_command_cases.py'):
            e.report['source_sha256'][str(path.relative_to(ROOT))]=hashlib.sha256(path.read_bytes()).hexdigest()
        e.report['status']='passed';e.report['passed']=True
    finally:
        e.close();(a.evidence/'spin-owner-command-report.json').write_text(json.dumps(e.report,indent=2)+'\n')
if __name__=='__main__':main()
