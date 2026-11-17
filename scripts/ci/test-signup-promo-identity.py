#!/usr/bin/env python3
"""Signup identity constraints and the actual patched credit block in isolated PG.

Uses real migration functions, constraints and profile trigger. The signup
owner snapshot is byte-bound to production's definition. Its patched credit
subtransaction is exercised directly; unrelated email/digest queries are not
fixtures. fn_promo_disburse is an idempotent native fixture credit door, not a
production wallet. This test never reaches production or a real chip balance.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('promo_native',ROOT/'scripts/ci/test-promo-play-through.py')
native=importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
MIGRATION=next((ROOT/'supabase/migrations').glob('*_signup_promo_is_granted_once_per_verified_phone_and_known_de.sql'))
OWNER=ROOT/'tests/fixtures/signup-promo-identity/signup-owner.sql'
WEEKLY_OWNER=ROOT/'tests/fixtures/signup-promo-identity/weekly-owner.json'

def uid(n): return f'00000000-0000-0000-0000-{n:012d}'

def main():
    args=argparse.ArgumentParser()
    args.add_argument('--output')
    output=args.parse_args().output
    binaries=native.pg_bin()
    scratch_root=Path(os.environ.get('TMPDIR',tempfile.gettempdir())).resolve()
    if os.uname().sysname=='Darwin' and scratch_root.stat().st_dev==Path('/').stat().st_dev:
        raise RuntimeError('Set TMPDIR to the verified task-owned external SSD directory')
    scratch=Path(tempfile.mkdtemp(prefix='si-',dir=scratch_root))
    socket=scratch/'s';socket.mkdir()
    data=scratch/'d'
    subprocess.run([str(Path(binaries)/'initdb'),'-D',str(data),'-U','postgres','-A','trust'],check=True,capture_output=True)
    subprocess.run([str(Path(binaries)/'pg_ctl'),'-D',str(data),'-w','-o',f"-p 54419 -k {socket} -c listen_addresses=''",'-l',str(scratch/'log'),'start'],check=True,capture_output=True)
    db=native.Db(str(socket),54419,'postgres')
    checks=[]
    def check(name,condition):
        checks.append({'check':name,'ok':bool(condition)})
        print(('PASS ' if condition else 'FAIL ')+name)
    def query(sql): return db.one(sql)
    def j(sql): return db.json(sql)
    def capture(user,phone,role='service_role'):
        query(f"SET request.jwt.claim.role='{role}'; INSERT INTO profiles(id,phone,phone_verified) VALUES('{user}','{phone}',true) ON CONFLICT(id) DO UPDATE SET phone=excluded.phone,phone_verified=true;")
    def device(user,value): query(f"INSERT INTO anti_cheat_device_sightings VALUES('{user}','{value}')")
    try:
        query("""
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE SCHEMA smarter_private;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.role',true),'')$$;
CREATE FUNCTION fn_caller_is_engine() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(auth.role(),'service_role')='service_role' $$;
CREATE FUNCTION fn_is_service_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(auth.role(),'service_role')='service_role' $$;
CREATE TABLE profiles(id uuid PRIMARY KEY,phone text,phone_verified boolean);
CREATE TABLE anti_cheat_device_sightings(user_id uuid,device_id text);
CREATE TABLE ca_promo_play_through_settings(id boolean PRIMARY KEY,enforced_from timestamptz);
INSERT INTO ca_promo_play_through_settings VALUES(true,NULL);
CREATE TABLE fixture_credits(user_id uuid,operation_id uuid PRIMARY KEY,amount numeric);
CREATE TABLE chip_transactions(id uuid PRIMARY KEY,to_user_id uuid,club_id uuid,transaction_type text,amount numeric,metadata jsonb);
CREATE TABLE sp_signup_welcome_back_awards(user_id uuid PRIMARY KEY,phone text,status text);
CREATE FUNCTION fn_promo_disburse(text,uuid,text,uuid,numeric,text,uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('test.credit_fails',true)='on' THEN RETURN jsonb_build_object('success',false,'error','Native Credit Refused'); END IF;
 INSERT INTO fixture_credits VALUES($4,$8,$5) ON CONFLICT(operation_id) DO NOTHING;
 INSERT INTO chip_transactions VALUES($8,$4,$7,'promo_disbursement',$5,jsonb_build_object('op_id',$8)) ON CONFLICT(id) DO NOTHING;
 RETURN jsonb_build_object('success',true,'replayed',false,'transaction_id',$8);
END $$;
""")
        query(OWNER.read_text())
        query(json.loads(WEEKLY_OWNER.read_text())['definition'])
        query("REVOKE ALL ON FUNCTION smarter_private.weekly_kings_welcome_due() FROM PUBLIC,anon,authenticated,service_role")
        weekly_original=query("SELECT pg_get_functiondef('smarter_private.weekly_kings_welcome_due()'::regprocedure)")
        weekly_acl=query("SELECT proacl::text FROM pg_proc WHERE oid='smarter_private.weekly_kings_welcome_due()'::regprocedure")
        check('source snapshot is the measured current signup owner',query("SELECT md5(pg_get_functiondef('fn_sp_signup_welcome_back_run(integer,date)'::regprocedure))")=='51629e5f1ef59835c3719ec553356eb8')
        check('weekly source snapshot is the installed original campaign owner',query("SELECT md5(pg_get_functiondef('smarter_private.weekly_kings_welcome_due()'::regprocedure))")=='a5b39719461d6f6e9e81c46acb2301fd')
        # The current real owner remains a strict prerequisite; an unreviewed
        # change must roll back the earlier signup patch and all cold tables.
        query(weekly_original.replace('BEGIN\n','BEGIN\n  -- native unreviewed drift\n',1))
        refused=db.run(MIGRATION.read_text(),check=False)
        check('unreviewed current weekly owner drift is refused',refused.returncode!=0 and 'Weekly signup promo owner changed' in refused.stderr)
        check('weekly owner refusal rolls back all signup identity DDL and the hourly patch',query("SELECT to_regclass('ca_signup_promo_identity_claims') IS NULL AND to_regclass('ca_signup_promo_verified_phones') IS NULL AND md5(pg_get_functiondef('fn_sp_signup_welcome_back_run(integer,date)'::regprocedure))='51629e5f1ef59835c3719ec553356eb8'")=='t')
        query(weekly_original)
        query(MIGRATION.read_text())
        definition=query("SELECT pg_get_functiondef('fn_sp_signup_welcome_back_run(integer,date)'::regprocedure)")
        start=definition.index('    BEGIN\n      v_res := public.fn_ca_signup_promo_claim_identity')
        end=definition.index('\n    END;',start)+len('\n    END;')
        block=definition[start:end]
        check('the actual campaign owner calls identity and credit in one subtransaction','PPT02' in block and block.index('fn_ca_signup_promo_claim_identity')<block.index('fn_promo_disburse'))
        # This exact block is installed only in the throwaway database. The
        # fixture credit door is idempotent and its failure is controlled here.
        query("""CREATE FUNCTION public.fixture_signup_credit_probe(p_user uuid,p_operation uuid) RETURNS jsonb LANGUAGE plpgsql AS $probe$
DECLARE c record; v_op uuid:=p_operation; v_res jsonb; v_err text;
 v_union uuid:='fade0000-0000-0000-0000-000000000001'; v_amount numeric:=25; v_amount_txt text:='25';
BEGIN SELECT p_user id INTO c;
"""+block+"\nRETURN v_res; END $probe$;")
        weekly=query("SELECT pg_get_functiondef('smarter_private.weekly_kings_welcome_due()'::regprocedure)")
        injected="    DECLARE identity_result jsonb; BEGIN\n      identity_result:=public.fn_ca_signup_promo_claim_identity(member.user_id,op);\n      IF identity_result->>'success' IS DISTINCT FROM 'true' THEN CONTINUE; END IF;\n    END;\n"
        check('current document selection receipt eligibility locks and payment body are preserved byte for byte',weekly.count(injected)==1 and weekly.replace(injected,'',1)==weekly_original)
        check('the current weekly postgres-only ACL is unchanged',weekly_acl=='{postgres=X/postgres}' and query("SELECT proacl::text FROM pg_proc WHERE oid='smarter_private.weekly_kings_welcome_due()'::regprocedure")==weekly_acl)
        start=weekly.index("    op:=md5('signup-welcome-back:'")
        end=weekly.index('    INSERT INTO public.sp_signup_welcome_back_awards',start)
        weekly_block=weekly[start:end]
        check('the original weekly credit validates the same identity before its payment',weekly_block.index('fn_ca_signup_promo_claim_identity')<weekly_block.index('fn_promo_disburse'))
        query("""CREATE FUNCTION public.fixture_weekly_signup_probe(p_users uuid[]) RETURNS jsonb LANGUAGE plpgsql AS $probe$
DECLARE member record;op uuid;payment jsonb;result jsonb:='[]';
 midway constant uuid:='fade0000-0000-0000-0000-000000000001';kings constant uuid:='a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
BEGIN FOR member IN SELECT unnest(p_users) user_id LOOP
"""+weekly_block+"\nresult:=result||jsonb_build_array(payment); END LOOP;RETURN result;END $probe$;")
        # Calls below use the same actual owner block in its isolated wrapper.
        def call(user,op=None,fail=False):
            return j(f"SET request.jwt.claim.role='service_role'; SET test.credit_fails='{'on' if fail else 'off'}'; SELECT fixture_signup_credit_probe('{user}','{op or user}');")
        pre=uid(1)
        check('before go-live the existing promo route is unchanged',call(pre)['success'])
        check('before go-live no identity reservation is written',query('SELECT count(*) FROM ca_signup_promo_identity_claims')=='0')
        query('UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp()')
        missing=uid(2)
        check('missing verified phone withholds only the gift',not call(missing)['success'])
        check('a refusal writes no credit',query(f"SELECT count(*) FROM fixture_credits WHERE user_id='{missing}'")=='0')
        capture(missing,'+15555550002')
        check('a known phone without a device withholds the gift',not call(missing)['success'])
        device(missing,uid(200))
        check('known verified phone and device admit the original gift',call(missing)['success'])
        check('the canonical operation replays without a second credit',call(missing)['success'] and query(f"SELECT count(*) FROM fixture_credits WHERE user_id='{missing}'")=='1')
        shared_device=uid(3);capture(shared_device,'+15555550003');device(shared_device,uid(200))
        denied=call(shared_device)
        check('another account on a used device is refused',not denied['success'])
        check('a duplicate rolls back every new key reservation',query(f"SELECT count(*) FROM ca_signup_promo_identity_claims WHERE user_id='{shared_device}'")=='0')
        shared_phone=uid(4);capture(shared_phone,'+1 (555) 555-0002');device(shared_phone,uid(400))
        check('another device cannot reuse the same normalized phone',not call(shared_phone)['success'])
        check('phone duplication does not block profile verification',query(f"SELECT phone_verified FROM profiles WHERE id='{shared_phone}'")=='t')
        failure=uid(5);capture(failure,'+15555550005');device(failure,uid(500))
        refused=call(failure,fail=True)
        check('a refused payment is returned as failure',not refused['success'])
        check('a refused payment releases all of its identity reservations',query(f"SELECT count(*) FROM ca_signup_promo_identity_claims WHERE user_id='{failure}'")=='0')
        check('the same operation may succeed once its payment is admitted',call(failure)['success'])
        old=query(f"SELECT phone_hash FROM ca_signup_promo_verified_phones WHERE user_id='{failure}'")
        capture(failure,'+15555559999',role='authenticated')
        check('a browser phone edit cannot replace the verified promo identity',query(f"SELECT phone_hash FROM ca_signup_promo_verified_phones WHERE user_id='{failure}'")==old)
        forged=uid(6);capture(forged,'+15555550006',role='authenticated');device(forged,uid(600))
        check('a browser cannot create a verified phone binding',query(f"SELECT count(*) FROM ca_signup_promo_verified_phones WHERE user_id='{forged}'")=='0')
        check('a browser cannot call the identity reservation RPC',db.run(f"SET request.jwt.claim.role='authenticated'; SET ROLE authenticated; SELECT fn_ca_signup_promo_claim_identity('{missing}','{missing}')",check=False).returncode!=0)
        check('a browser cannot read phone hashes',db.run('SET ROLE authenticated; SELECT * FROM ca_signup_promo_verified_phones',check=False).returncode!=0)
        check('a browser cannot read identity claims',db.run('SET ROLE authenticated; SELECT * FROM ca_signup_promo_identity_claims',check=False).returncode!=0)
        a,b=uid(7),uid(8)
        for user in (a,b): capture(user,'+15555550007');device(user,uid(700 if user==a else 800))
        commands=[]
        for user in (a,b):
            commands.append(subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',str(socket),'-p','54419','-U','postgres','-d','postgres'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True))
        for proc,user in zip(commands,(a,b)):
            proc.stdin.write(f"SET request.jwt.claim.role='service_role'; SELECT fixture_signup_credit_probe('{user}','{user}');\n");proc.stdin.close()
        results=[]
        for proc in commands:
            text=proc.stdout.read().strip();err=proc.stderr.read();proc.wait(timeout=20)
            if proc.returncode: raise RuntimeError(err)
            results.append(json.loads(text))
        check('concurrent accounts cannot both reserve the same phone',sum(bool(r['success']) for r in results)==1)
        check('the concurrent race credits exactly one original operation',query(f"SELECT count(*) FROM fixture_credits WHERE user_id IN ('{a}','{b}')")=='1')
        legacy=uid(10);capture(legacy,'+15555550010');device(legacy,uid(1010))
        query(f"INSERT INTO sp_signup_welcome_back_awards VALUES('{legacy}','+15555550010','awarded')")
        legacy_device=uid(11);capture(legacy_device,'+15555550011');device(legacy_device,uid(1010))
        check('a device already paid before go-live cannot receive another signup gift',not call(legacy_device)['success'])
        legacy_phone=uid(12);capture(legacy_phone,'+15555550010');device(legacy_phone,uid(1212))
        check('an earlier gift on the same verified phone still counts',not call(legacy_phone)['success'])
        crowded=uid(9);capture(crowded,'+15555550009')
        query(f"INSERT INTO anti_cheat_device_sightings SELECT '{crowded}',('00000000-0000-0000-0000-'||lpad(n::text,12,'0')) FROM generate_series(1000,1100) n")
        check('oversized device history is refused without dropping identities',not call(crowded)['success'])
        check('oversized history reserves no key',query(f"SELECT count(*) FROM ca_signup_promo_identity_claims WHERE user_id='{crowded}'")=='0')
        check('the definer owner does not override browser request authorization',db.run(f"SET request.jwt.claim.role='authenticated'; SELECT fn_ca_signup_promo_claim_identity('{missing}','{missing}')",check=False).returncode!=0)
        check('no raw phone number is stored in identity claims',query("SELECT count(*) FROM information_schema.columns WHERE table_name='ca_signup_promo_identity_claims' AND column_name='phone'")=='0')
        weekly_duplicate,weekly_ok,weekly_fail=uid(31),uid(32),uid(33)
        capture(weekly_duplicate,'+15555550002');device(weekly_duplicate,uid(3100))
        capture(weekly_ok,'+15555550032');device(weekly_ok,uid(3200))
        paid=j(f"SET request.jwt.claim.role='service_role';SET test.credit_fails='off';SELECT fixture_weekly_signup_probe(ARRAY['{weekly_duplicate}'::uuid,'{weekly_ok}'::uuid]);")
        check('a used signup phone is refused across hourly and weekly campaign paths',query(f"SELECT count(*) FROM fixture_credits WHERE user_id='{weekly_duplicate}'")=='0')
        check('one refused weekly gift does not block the next eligible recipient',len(paid)==1 and query(f"SELECT count(*) FROM fixture_credits WHERE user_id='{weekly_ok}'")=='1')
        capture(weekly_fail,'+15555550033');device(weekly_fail,uid(3300))
        rejected=db.run(f"SET request.jwt.claim.role='service_role';SET test.credit_fails='on';SELECT fixture_weekly_signup_probe(ARRAY['{weekly_fail}'::uuid]);",check=False)
        check('a failed original weekly credit rolls back its new identity claim',rejected.returncode!=0 and query(f"SELECT count(*) FROM ca_signup_promo_identity_claims WHERE user_id='{weekly_fail}'")=='0')
        check('the failed weekly credit leaves no gift receipt',query(f"SELECT count(*) FROM fixture_credits WHERE user_id='{weekly_fail}'")=='0')
    finally:
        subprocess.run([str(Path(binaries)/'pg_ctl'),'-D',str(data),'-m','fast','stop'],capture_output=True)
        shutil.rmtree(scratch,ignore_errors=True)
    if output:
        Path(output).mkdir(parents=True,exist_ok=True)
        (Path(output)/'RESULTS.json').write_text(json.dumps({'checks':checks,'passed':sum(c['ok'] for c in checks),'failed':sum(not c['ok'] for c in checks)},indent=2))
    print(f"{sum(c['ok'] for c in checks)} passed, {sum(not c['ok'] for c in checks)} failed")
    return 0 if all(c['ok'] for c in checks) else 1

if __name__=='__main__': raise SystemExit(main())
