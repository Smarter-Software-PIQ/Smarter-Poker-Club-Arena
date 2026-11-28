"""Qualify the union statement document reader in an isolated PostgreSQL 17.

Installs the production bodies captured read-only in
scripts/ci/fixtures/union-statement-document/production-preimages.json over a
minimal union / club / membership / settlement_invoices fixture holding the
four real Midway statements of the week 2026-11-02 (MIDWAY-2026-000037, 38,
39, 41) and credit note MIDWAY-2026-000045, from
tests/fixtures/union-statement-document/production-2026-11-09.json. Then it
runs migration 20261116034302_a_club_owner_can_download_its_union_statement
byte for byte (its md5 guards must accept the captured bodies and refuse a
changed one) and checks, calling as PostgREST does (an `authenticator` login
switched to role `authenticated`, the user in request.jwt.claims):

  * the reader returns each statement exactly as production's board row;
  * who may read which statement (union owner/admin, platform admin, club
    owner, co-owner and admin of THAT club; never another club's owner, an
    agent, a player, a banned admin, a stranger, a signed-out caller or anon);
  * a missing statement and a credit note id get the same refusal;
  * ca_club_union_invoices now owes what the statement owes after notes;
  * once charge notes exist (fn_union_invoice_outstanding as draft PR #11015
    installs it), the same reader lists them, dated, and counts them, and a
    cancelled note is never listed or counted.

No production access.
"""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261116034302_a_club_owner_can_download_its_union_statement.sql'
PREIMAGES = ROOT / 'scripts/ci/fixtures/union-statement-document/production-preimages.json'
STATEMENTS = ROOT / 'tests/fixtures/union-statement-document/production-2026-11-09.json'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, required=True)
out = parser.parse_args().output.resolve()
out.mkdir(parents=True, exist_ok=True)
PG = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
env['TZ'] = 'UTC'
PORT = '55871'
cluster = pathlib.Path(tempfile.mkdtemp(prefix='union-statement-document-'))
socket = cluster / 's'
socket.mkdir(mode=0o700)
owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
if owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(socket, 'postgres')


def psql(user):
    return [PG / 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', PORT, '-U', user, '-d', 'postgres']


results = {'checks': [], 'production_mutations': False}


def command(args, sql=None, allow_error=False):
    r = subprocess.run([str(x) for x in args], input=sql, text=True, capture_output=True, env=env, timeout=120)
    if r.returncode and not allow_error:
        raise RuntimeError(r.stderr)
    return r


def run(sql):
    return command(psql('postgres'), sql).stdout.strip()


def check(name, passed, detail=None):
    results['checks'].append({'name': name, 'passed': bool(passed)})
    if not passed:
        raise AssertionError(f'{name}: {detail}')


def api(uid, sql, role='authenticated'):
    """One request as PostgREST makes it: authenticator, SET ROLE, JWT claims."""
    claims = json.dumps({'role': role, **({'sub': uid} if uid else {})})
    r = command(psql('authenticator'),
                f"SET ROLE {role};\nSELECT set_config('request.jwt.claims', '{claims}', false);\n{sql}",
                allow_error=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [''])[-1], r.stderr


U = 'fade0000-0000-0000-0000-000000000001'
KINGS = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
FELT = 'a0000000-0000-0000-0000-000000000001'
DEEP = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'
SAVAGE = '946747c6-b991-4220-b0cb-effbea46ecd2'
UNION_OWNER = '47965354-0e56-43ef-931c-ddaab82af765'
P = {name: f'00000000-0000-4000-8000-0000000000{n:02d}' for n, name in enumerate([
    'union_admin', 'platform_admin', 'kings_owner', 'kings_co_owner', 'kings_admin', 'kings_agent',
    'kings_player', 'kings_banned_admin', 'felt_owner', 'stranger'], start=1)}
CREDIT_NOTE = '20000000-0000-4000-8000-000000000045'

try:
    pre = json.loads(PREIMAGES.read_text())
    fx = json.loads(STATEMENTS.read_text())
    command(owner + [PG / 'initdb', '-D', cluster / 'data', '-U', 'postgres', '--auth=trust', '-E', 'UTF8'])
    command(owner + [PG / 'pg_ctl', '-D', cluster / 'data', '-l', cluster / 'log', '-w', '-o',
                     f'-c listen_addresses= -c unix_socket_directories={socket} -c port={PORT}', 'start'])
    run("""
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE ROLE authenticator LOGIN NOINHERIT; GRANT anon, authenticated, service_role TO authenticator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role' $$;
CREATE TABLE public.unions(id uuid PRIMARY KEY, name text NOT NULL, slug text, owner_id uuid);
CREATE TABLE public.union_admins(union_id uuid, user_id uuid);
CREATE TABLE public.clubs(id uuid PRIMARY KEY, name text NOT NULL, code text, slug text, owner_id uuid, is_union boolean);
CREATE TABLE public.club_members(club_id uuid, user_id uuid, role text, status text);
CREATE TABLE public.profiles(id uuid PRIMARY KEY, is_admin boolean, status text);
CREATE TABLE public.agents(club_id uuid, user_id uuid, status text);
CREATE TABLE public.settlement_invoices(
  id uuid PRIMARY KEY, club_id uuid, invoice_type text, invoice_number text, adjusts_invoice_id uuid,
  from_entity_type text, from_entity_id text, to_entity_type text, to_entity_id text,
  gross_amount numeric, net_amount numeric, deductions numeric, breakdown jsonb, status text,
  message_sent boolean, due_at timestamptz, created_at timestamptz DEFAULT now(), notes text);
CREATE TABLE public.accounting_invoice_deliveries(invoice_id uuid, recipient_id uuid);
""")
    for f in pre['functions']:
        run(f['definition'])
        got = run(f"SELECT md5(pg_get_functiondef('{f['sig']}'::regprocedure));")
        check(f"captured body reproduces its production md5: {f['sig']}", got == f['md5'], got)

    # People, clubs and the four real statements.
    rows = [
        f"INSERT INTO unions VALUES ('{U}','Midway Union','midway','{UNION_OWNER}');",
        f"INSERT INTO union_admins VALUES ('{U}','{P['union_admin']}');",
        f"INSERT INTO clubs VALUES ('{KINGS}','KINGS CLUB','2CC19F','kings-club','{P['kings_owner']}',false),"
        f"('{FELT}','The Felt Society','57C5F9','the-felt-society','{P['felt_owner']}',false),"
        f"('{DEEP}','Deep Stack Society',NULL,'deep-stack-society-11192',NULL,false),"
        f"('{SAVAGE}','Club Savage',NULL,'club-savage-84109',NULL,false);",
        "INSERT INTO profiles SELECT id::uuid, id = '" + P['platform_admin'] + "', 'active' FROM (VALUES "
        + ','.join(f"('{v}')" for v in [UNION_OWNER, *P.values()]) + ") x(id);",
        f"INSERT INTO club_members VALUES ('{KINGS}','{P['kings_co_owner']}','co_owner','active'),"
        f"('{KINGS}','{P['kings_admin']}','admin','active'),('{KINGS}','{P['kings_agent']}','agent','active'),"
        f"('{KINGS}','{P['kings_player']}','player','active'),('{KINGS}','{P['kings_banned_admin']}','admin','banned'),"
        f"('{FELT}','{P['kings_player']}','player','active');",
        f"INSERT INTO agents VALUES ('{KINGS}','{P['kings_agent']}','active');",
    ]
    ids = {}
    for r in fx['rows']:
        number = r['invoice_number']
        ids[number] = r['invoice_id']
        s = fx['stored'][number]
        b = {'union_id': U, 'union_name': 'Midway Union', 'club_id': r['club_id'], 'club_name': r['club_name'],
             'direction': r['direction'], 'period_start': s['period_start'], 'period_end': s['period_end'],
             'rake_generated': r['rake_generated'], 'rakeback_due': r['rakeback_due'],
             'union_fee_kept': r['union_fee_kept'], 'players_won': r['players_won'], 'eco_amount': r['eco_amount'],
             'presettled': r['presettled'], 'eco_version': 2, 'eco_components': r['eco_components'],
             'settled_in_chips': r['settled_in_chips'], 'player_pnl_net': r['player_pnl_net'],
             'outstanding': r['stored_outstanding']}
        frm_id = U if s['from'] == 'union' else r['club_id']
        to_id = U if s['to'] == 'union' else r['club_id']
        rows.append(
            "INSERT INTO settlement_invoices(id,club_id,invoice_type,invoice_number,from_entity_type,from_entity_id,"
            "to_entity_type,to_entity_id,gross_amount,net_amount,deductions,breakdown,status,message_sent,due_at,created_at) "
            f"VALUES ('{r['invoice_id']}','{r['club_id']}','union_weekly_squareup','{number}','{s['from']}','{frm_id}',"
            f"'{s['to']}','{to_id}',{s['net_amount']},{s['net_amount']},0,$j${json.dumps(b)}$j$::jsonb,'generated',true,"
            f"'{s['due_at']}','{s['created_at']}');")
        rows.append(f"INSERT INTO accounting_invoice_deliveries VALUES ('{r['invoice_id']}','{UNION_OWNER}');")
        for n in s.get('credit_notes', []):
            rows.append(
                "INSERT INTO settlement_invoices(id,club_id,invoice_type,invoice_number,adjusts_invoice_id,from_entity_type,"
                "from_entity_id,to_entity_type,to_entity_id,gross_amount,net_amount,deductions,breakdown,status,created_at) "
                f"VALUES ('{CREDIT_NOTE}','{r['club_id']}','union_weekly_credit_note','{n['invoice_number']}','{r['invoice_id']}',"
                f"'union','{U}','club','{r['club_id']}',{n['net_amount']},{n['net_amount']},0,"
                f"'{{\"union_id\":\"{U}\"}}'::jsonb,'{n['status']}','{n['created_at']}');")
    run('\n'.join(rows))

    # The md5 guard refuses a rule it was not qualified against.
    oversee = next(f for f in pre['functions'] if f['sig'] == 'public.ca_can_oversee_union(uuid)')
    run(oversee['definition'].replace('DECLARE v_uid', '-- changed\nDECLARE v_uid'))
    r = command(psql('postgres'), MIGRATION.read_text(), allow_error=True)
    check('the migration refuses a changed authorization rule',
          r.returncode != 0 and 'STATEMENT_DOCUMENT_PREIMAGE_CHANGED: public.ca_can_oversee_union(uuid)' in r.stderr, r.stderr)
    check('and leaves nothing behind', run("SELECT to_regprocedure('public.ca_union_statement_document(uuid)') IS NULL;") == 't')
    run(oversee['definition'])

    command(psql('postgres'), MIGRATION.read_text())
    check('the migration installs over the captured production bodies',
          run("SELECT to_regprocedure('public.ca_union_statement_document(uuid)') IS NOT NULL;") == 't')
    grants = run("SELECT string_agg(r || ':' || has_function_privilege(r, 'public.ca_union_statement_document(uuid)', 'EXECUTE'), ',' ORDER BY r)"
                 " FROM unnest(ARRAY['anon','authenticated','service_role']) r;")
    check('EXECUTE: authenticated and service_role, never anon', grants == 'anon:false,authenticated:true,service_role:true', grants)
    unchanged = run("SELECT prosecdef::text || provolatile::text || array_to_string(proconfig, ';') FROM pg_proc"
                    " WHERE oid = 'public.ca_club_union_invoices(uuid,integer)'::regprocedure;")
    check('ca_club_union_invoices keeps definer, volatility and search_path', unchanged == 'trues' + 'search_path=public', unchanged)

    def doc(uid, number=None, raw_id=None):
        iid = raw_id or ids[number]
        return api(uid, f"SELECT public.ca_union_statement_document('{iid}');")

    # 1. The reader returns each statement exactly as production's board row.
    for r in fx['rows']:
        ok, body, err = doc(UNION_OWNER, r['invoice_number'])
        check(f"union owner reads {r['invoice_number']}", ok, err)
        got = json.loads(body)
        st = got['statement']
        for key, want in r.items():
            if key in ('eco_components_complete',):
                continue
            g = st.get(key)
            same = (abs(float(g) - float(want)) < 0.005) if isinstance(want, (int, float)) and not isinstance(want, bool) and g is not None else g == want
            if key in ('issued_at', 'due_at', 'period_start_at', 'period_end_at'):
                same = run(f"SELECT '{g}'::timestamptz = '{want}'::timestamptz;") == 't'
            check(f"{r['invoice_number']} {key} equals production's board", same, (g, want))
        check(f"{r['invoice_number']} union name", got['union_name'] == 'Midway Union', got['union_name'])
        if r['invoice_number'] == 'MIDWAY-2026-000039':
            check('MIDWAY-2026-000039 carries credit note 000045 with its issue time',
                  [(n['kind'], n['invoice_number'], n['amount'], n['status']) for n in got['notes']]
                  == [('credit', 'MIDWAY-2026-000045', 21.25, 'generated')]
                  and run(f"SELECT '{got['notes'][0]['issued_at']}'::timestamptz = '2026-11-15 16:32:08.610955+00';") == 't',
                  got['notes'])
            (out / 'MIDWAY-2026-000039.json').write_text(json.dumps(got, indent=2, sort_keys=True))
        else:
            check(f"{r['invoice_number']} has no notes", got['notes'] == [] and st['charge_notes'] is None, got['notes'])

    # 2. Who may read which statement.
    # Whole-club report readers of each statement's club (fn_ca_club_data_scope
    # = 'club'), and the issuing union's overseers (ca_can_oversee_union).
    club_of = {r['invoice_number']: r['club_id'] for r in fx['rows']}
    club_scope = {
        KINGS: {P['kings_owner'], P['kings_co_owner'], P['kings_admin'], P['platform_admin']},
        FELT: {P['felt_owner'], P['platform_admin']},
        DEEP: {P['platform_admin']},
        SAVAGE: {P['platform_admin']},
    }
    overseers = {UNION_OWNER, P['union_admin'], P['platform_admin']}
    names = {UNION_OWNER: 'union_owner', **{v: k for k, v in P.items()}}
    for uid in [UNION_OWNER, *P.values()]:
        for number in sorted(ids):
            club = club_of[number]
            may = uid in overseers or uid in club_scope[club]
            ok, body, err = doc(uid, number)
            if may:
                check(f"{names[uid]} reads {number}", ok and json.loads(body)['statement']['invoice_number'] == number, err)
            else:
                check(f"{names[uid]} is refused {number}", not ok and 'not authorized for this statement' in err, (body, err))
            ok2, body2, err2 = api(uid, f"SELECT public.ca_club_union_invoices('{club}', 8);")
            check(f"{names[uid]} club list of {number}'s club follows the club rule", ok2 == (uid in club_scope[club]), (ok2, err2))
    ok, body, err = doc(None, 'MIDWAY-2026-000039')
    check('a signed-in role without a user is refused', not ok and 'not authorized for this statement' in err, err)
    ok, body, err = api(None, f"SELECT public.ca_union_statement_document('{ids['MIDWAY-2026-000039']}');", role='anon')
    check('anon cannot execute the reader', not ok and 'permission denied for function ca_union_statement_document' in err, err)
    ok, _, err_missing = doc(UNION_OWNER, raw_id='99999999-9999-4999-8999-999999999999')
    ok2, _, err_note = doc(UNION_OWNER, raw_id=CREDIT_NOTE)
    check('a missing statement and a credit note get the same refusal as someone else\'s statement',
          not ok and not ok2 and 'not authorized for this statement' in err_missing and 'not authorized for this statement' in err_note,
          (err_missing, err_note))

    # 3. The club's own list owes what the statement owes after its credit note.
    ok, body, err = api(P['kings_owner'], f"SELECT public.ca_club_union_invoices('{KINGS}', 8);")
    lst = json.loads(body)
    check('KINGS owner club list: number, 6,021.71 outstanding after the credit note',
          ok and [(x['invoice_number'], x['outstanding'], x['remaining_after_credits'], x['amount']) for x in lst]
          == [('MIDWAY-2026-000039', 6021.71, 6021.71, 6042.96)], (ok, body, err))
    ok, body, err = api(P['felt_owner'], f"SELECT public.ca_club_union_invoices('{KINGS}', 8);")
    check("Felt's owner cannot list KINGS statements", not ok and 'not authorized for this club' in err, err)

    # 4. Charge notes once #11015 installs, a cancelled note never counted.
    run(pre['fn_union_invoice_outstanding_after_11015'])
    s39 = ids['MIDWAY-2026-000039']
    run("INSERT INTO settlement_invoices(id,club_id,invoice_type,invoice_number,adjusts_invoice_id,from_entity_type,from_entity_id,"
        "to_entity_type,to_entity_id,gross_amount,net_amount,deductions,breakdown,status,created_at) VALUES "
        f"('30000000-0000-4000-8000-000000000001','{KINGS}','union_weekly_debit_note','TEST-CHARGE-1','{s39}','club','{KINGS}','union','{U}',"
        "43.86,43.86,0,'{}','generated','2026-11-16 19:00:00+00'),"
        f"('30000000-0000-4000-8000-000000000002','{KINGS}','union_weekly_credit_note','TEST-CANCELLED-1','{s39}','union','{U}','club','{KINGS}',"
        "5,5,0,'{}','cancelled','2026-11-16 19:30:00+00');")
    ok, body, err = doc(P['kings_owner'], 'MIDWAY-2026-000039')
    got = json.loads(body)
    st = got['statement']
    check('a charge note is listed, dated, and counted; a cancelled note is neither',
          ok and [(n['kind'], n['invoice_number'], n['amount']) for n in got['notes']]
          == [('credit', 'MIDWAY-2026-000045', 21.25), ('charge', 'TEST-CHARGE-1', 43.86)]
          and st['credit_notes'] == [{'invoice_number': 'MIDWAY-2026-000045', 'amount': 21.25}]
          and st['charge_notes'] == [{'invoice_number': 'TEST-CHARGE-1', 'amount': 43.86}]
          and st['remaining_after_credits'] == 6065.57 and st['outstanding'] == 6065.57
          and run(f"SELECT '{got['notes'][1]['issued_at']}'::timestamptz = '2026-11-16 19:00:00+00';") == 't',
          body)
    (out / 'MIDWAY-2026-000039-with-charge-note.json').write_text(json.dumps(got, indent=2, sort_keys=True))
    ok, body, err = api(P['kings_owner'], f"SELECT public.ca_club_union_invoices('{KINGS}', 8);")
    check('the club list counts the charge note too', ok and json.loads(body)[0]['outstanding'] == 6065.57, body)
    ok, body, err = doc(P['felt_owner'], 'MIDWAY-2026-000039')
    check("another club's owner still gets nothing, notes included", not ok and 'TEST-CHARGE-1' not in body, body)
finally:
    command(owner + [PG / 'pg_ctl', '-D', cluster / 'data', '-m', 'immediate', 'stop'], allow_error=True)
    (out / 'results.json').write_text(json.dumps(results, indent=2))
    print(json.dumps({'checks': len(results['checks']), 'failed': [c['name'] for c in results['checks'] if not c['passed']]}))
