#!/usr/bin/env python3
"""Exact readiness source and authorized input body on disposable PostgreSQL.
Surrounding read surfaces use the maintained template fixture. No money door runs.
"""
import hashlib, os, pathlib, re, subprocess, tempfile, shutil
ROOT=pathlib.Path(__file__).resolve().parents[2]
pg=pathlib.Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
tmp=os.environ.get('TMPDIR')
if os.uname().sysname=='Darwin' and not str(tmp).startswith('/Volumes/SmarterWork/agent-work/'):
    raise SystemExit('SSD TMPDIR required')
work=pathlib.Path(tempfile.mkdtemp(prefix='lrr-',dir=tmp))
def run(args,**kw):
    p=subprocess.run(list(map(str,args)),text=True,capture_output=True,**kw)
    if p.returncode: raise RuntimeError(p.stderr)
    return p.stdout.strip()
def sql(s):return run([pg/'psql','-XAtq','-h',work,'-p','55627','-d','postgres','-v','ON_ERROR_STOP=1'],input=s)
def load(p):return sql(p.read_text())
sig="'public.fn_lightning_rollout_readiness(uuid)'::regprocedure"
rebuy="'public.fn_lightning_auto_rebuy(uuid,uuid,timestamp with time zone)'::regprocedure"
call="public.fn_lightning_rollout_readiness('00000000-0000-4000-a000-000000000002')"
def check(expr,name):
    sql("DO $check$ BEGIN IF ("+expr+") IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL "+name+"'; END IF; END $check$;")
    print('PASS '+name)
try:
    run([pg/'initdb','-D',work/'db','-A','trust','--no-locale'])
    run([pg/'pg_ctl','-D',work/'db','-l',work/'pg.log','-o',f"-k {work} -p 55627 -c listen_addresses=''",'start'])
    load(ROOT/'scripts/dev/fixtures/lightning-template-boundary.sql')
    # Only catalog/read dependencies, explicitly not gameplay implementations.
    sql("""ALTER TABLE cash_games ADD COLUMN variant text;
CREATE FUNCTION fn_lightning_template_allowed(text,jsonb) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION fn_lightning_table_size_allowed(integer) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION fn_lightning_variant_allowed(text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION fn_lightning_form_hand(uuid,uuid[],smallint,smallint,uuid,interval,interval,timestamptz,text,uuid,jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;
""")
    load(ROOT/'scripts/dev/fixtures/lightning-readiness-rebuy-preimage.sql')
    sql('ALTER FUNCTION fn_lightning_rollout_readiness(uuid) OWNER TO postgres; REVOKE ALL ON FUNCTION fn_lightning_rollout_readiness(uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION fn_lightning_rollout_readiness(uuid) TO authenticated,service_role; GRANT SELECT ON ALL TABLES IN SCHEMA public TO postgres;')
    # Load the actual maintained rebuy body without running its unrelated migration guard.
    source=(ROOT/'supabase/migrations/20261101062933_lightning_one_two_horse_maximum_rebuy_input.sql').read_text()
    body=re.search(r'CREATE OR REPLACE FUNCTION public.fn_lightning_auto_rebuy\(.*?\n\$fn\$;',source,re.S).group()
    sql(body)
    sql('ALTER FUNCTION fn_lightning_auto_rebuy(uuid,uuid,timestamptz) OWNER TO postgres; REVOKE ALL ON FUNCTION fn_lightning_auto_rebuy(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION fn_lightning_auto_rebuy(uuid,uuid,timestamptz) TO service_role;')
    check(f"md5(pg_get_functiondef({sig}))='5ec4a89512b6f8b3b1315c55f7f56ce4'",'exact installed readiness preimage')
    check(f"md5(pg_get_functiondef({rebuy}))='b3f9e246f51c90f4ead065cae3c51c3c'",'exact authorized rebuy definition')
    check(f"({call}#>>'{{evidence,invariants,law_10_5}}')::boolean=false",'before false readiness reproduced')
    before=sql(f'SELECT {call}')
    metadata=sql(f"SELECT proowner::text||proacl::text||proconfig::text||prosecdef::text||provolatile::text FROM pg_proc WHERE oid={sig}")
    migration=next((ROOT/'supabase/migrations').glob('*_lightning_readiness_recognizes_exact_authorized_rebuy_input.sql'))
    load(migration)
    check(f"({call}#>>'{{evidence,invariants,law_10_5}}')::boolean",'authorized input accepted by actual readiness RPC')
    assert metadata==sql(f"SELECT proowner::text||proacl::text||proconfig::text||prosecdef::text||provolatile::text FROM pg_proc WHERE oid={sig}")
    check(f"{call}->>'verdict'<>'go'",'unrelated missing evidence still refuses GO')
    # Broad scan remains active, including overloads bearing the same name.
    for name,args in [('fn_lightning_unreviewed',''),('fn_lightning_auto_rebuy','integer')]:
        sql(f'CREATE FUNCTION {name}({args}) RETURNS text LANGUAGE sql AS $$SELECT \'is_horse\'::text$$;')
        check(f"({call}#>>'{{evidence,invariants,law_10_5}}')::boolean=false",'unreviewed function or overload refused '+name)
        sql(f'DROP FUNCTION {name}({args});')
    for role in ['authenticated','anon','PUBLIC']:
        sql(f'GRANT EXECUTE ON FUNCTION fn_lightning_auto_rebuy(uuid,uuid,timestamptz) TO {role};')
        check(f"({call}#>>'{{evidence,invariants,law_10_5}}')::boolean=false",'unsafe execute grant refused '+role)
        sql(f'REVOKE EXECUTE ON FUNCTION fn_lightning_auto_rebuy(uuid,uuid,timestamptz) FROM {role};')
    sql('REVOKE EXECUTE ON FUNCTION fn_lightning_auto_rebuy(uuid,uuid,timestamptz) FROM service_role;')
    check(f"({call}#>>'{{evidence,invariants,law_10_5}}')::boolean=false",'missing service permission refused')
    sql('GRANT EXECUTE ON FUNCTION fn_lightning_auto_rebuy(uuid,uuid,timestamptz) TO service_role;')
    # Changing any body byte or security mode invalidates recognition.
    sql(body.replace('v_mandatory boolean := false;', 'v_mandatory boolean := true;'))
    check(f"({call}#>>'{{evidence,invariants,law_10_5}}')::boolean=false",'changed rebuy logic refused')
    sql(body)
    sql('ALTER FUNCTION fn_lightning_auto_rebuy(uuid,uuid,timestamptz) SECURITY DEFINER;')
    check(f"({call}#>>'{{evidence,invariants,law_10_5}}')::boolean=false",'security mode drift refused')
    sql('ALTER FUNCTION fn_lightning_auto_rebuy(uuid,uuid,timestamptz) SECURITY INVOKER;')
    check(f"({call}#>>'{{evidence,invariants,law_10_5}}')::boolean",'exact input restored')
    try:load(migration)
    except RuntimeError as e:assert 'predecessor mismatch' in str(e)
    else:raise AssertionError('unexpected predecessor admitted')
    print('PASS source drift refuses migration; readiness metadata and other guards preserved')
finally:
    subprocess.run([str(pg/'pg_ctl'),'-D',str(work/'db'),'-m','immediate','stop'],capture_output=True)
    shutil.rmtree(work)
