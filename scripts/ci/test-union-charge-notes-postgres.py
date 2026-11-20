"""Qualify union charge notes (debit notes) in an isolated PostgreSQL 17.

Installs the production bodies captured read-only in
scripts/ci/fixtures/union-charge-notes/production-preimages.json (and the
invoice-type CHECK) over a minimal union / club / settlement_invoices fixture,
then runs SECTION 1 of migration
20261115205250_a_union_statement_can_carry_a_charge_note.sql byte for byte:
its md5 guards must accept the captured bodies and every anchor must apply.
Then it issues charge notes and credit notes and checks: numbering from the
union counter, direction, delivery on insert, the Charge Note body, the owed
amount (statement - credit notes + charge notes) in
fn_union_invoice_outstanding, ca_union_set_statement_paid and the square-up
body, the credit-note cap, a refused second identical charge, refused
unauthorised callers and refused wrong documents, the statement of account,
and grants equal to the credit note's. SECTION 2 (the one production charge
note) reads production rows and is rehearsed read-only on production, not
here. No production access.
"""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261115205250_a_union_statement_can_carry_a_charge_note.sql'
VIEWS = ROOT / 'supabase/migrations/20261115011424_union_invoice_views_show_the_week_and_who_pays.sql'
PREIMAGES = ROOT / 'scripts/ci/fixtures/union-charge-notes/production-preimages.json'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, required=True)
out = parser.parse_args().output.resolve()
out.mkdir(parents=True, exist_ok=True)
PG = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
env['TZ'] = 'UTC'
cluster = pathlib.Path(tempfile.mkdtemp(prefix='union-charge-notes-'))
socket = cluster / 's'
socket.mkdir(mode=0o700)
owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
if owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(socket, 'postgres')
PSQL = [PG / 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '55847', '-U', 'postgres', '-d', 'postgres']
results = {'checks': [], 'production_mutations': False}


def command(args, sql=None, allow_error=False):
    r = subprocess.run([str(x) for x in args], input=sql, text=True, capture_output=True, env=env, timeout=120)
    if r.returncode and not allow_error:
        raise RuntimeError(r.stderr)
    return r


def run(sql):
    return command(PSQL, sql).stdout.strip()


def check(name, passed, detail=None):
    results['checks'].append({'name': name, 'passed': bool(passed)})
    if not passed:
        raise AssertionError(f'{name}: {detail}')


U = 'fade0000-0000-0000-0000-000000000001'
KC = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
FS = 'a0000000-0000-0000-0000-000000000001'
OWNER = '47965354-0e56-43ef-931c-ddaab82af765'
ADMIN = '11111111-1111-4111-8111-111111111111'
STRANGER = '22222222-2222-4222-8222-222222222222'
S34 = '10000000-0000-4000-8000-000000000034'
S50 = '10000000-0000-4000-8000-000000000050'
S60 = '10000000-0000-4000-8000-000000000060'
S40 = '10000000-0000-4000-8000-000000000040'
WEEK = {'period_start': '2026-10-26T07:00:00+00:00', 'period_end': '2026-11-02T08:00:00+00:00'}


def as_user(uid, sql):
    claim = '' if uid is None else uid
    return run(f"SELECT set_config('request.jwt.claim.sub', '{claim}', false);\n{sql}").splitlines()[-1]


def as_user_err(uid, sql):
    claim = '' if uid is None else uid
    return command(PSQL, f"SELECT set_config('request.jwt.claim.sub', '{claim}', false);\n{sql}", allow_error=True)


def squareup(iid, number, club, frm, frm_id, to, to_id, net, direction, status='generated', extra=None):
    b = {'union_id': U, 'union_name': 'Midway Union', 'club_id': club, 'direction': direction,
         'rake_generated': 0, 'union_fee_kept': 0, 'rakeback_due': 0, 'players_won': 0,
         'eco_amount': -float(net), 'presettled': 0, 'outstanding': -float(net), **WEEK}
    b.update(extra or {})
    return (f"INSERT INTO public.settlement_invoices(id,club_id,invoice_type,invoice_number,from_entity_type,from_entity_id,"
            f"to_entity_type,to_entity_id,gross_amount,net_amount,deductions,breakdown,status,due_at) VALUES ('{iid}','{club}',"
            f"'union_weekly_squareup','{number}','{frm}','{frm_id}','{to}','{to_id}',{net},{net},0,"
            f"'{json.dumps(b)}'::jsonb,'{status}','2026-11-05 08:00Z');")


try:
    pre = json.loads(PREIMAGES.read_text())
    command(owner + [PG / 'initdb', '-D', cluster / 'data', '-U', 'postgres', '--auth=trust', '-E', 'UTF8'])
    command(owner + [PG / 'pg_ctl', '-D', cluster / 'data', '-l', cluster / 'log', '-w', '-o',
                     f'-c listen_addresses= -c unix_socket_directories={socket} -c port=55847', 'start'])
    run("""
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth; CREATE SCHEMA smarter_private;
GRANT USAGE ON SCHEMA smarter_private TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.unions(id uuid PRIMARY KEY, name text NOT NULL, slug text, owner_id uuid);
CREATE TABLE public.union_admins(union_id uuid, user_id uuid);
CREATE TABLE public.clubs(id uuid PRIMARY KEY, name text NOT NULL, owner_id uuid);
CREATE TABLE public.union_invoice_counters(union_id uuid, year int, next_seq bigint NOT NULL,
  updated_at timestamptz DEFAULT now(), PRIMARY KEY (union_id, year));
CREATE TABLE public.settlement_invoices(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid, period_id uuid, invoice_type text NOT NULL,
  invoice_number text UNIQUE, adjusts_invoice_id uuid REFERENCES public.settlement_invoices(id),
  from_entity_type text, from_entity_id text, to_entity_type text, to_entity_id text,
  gross_amount numeric, net_amount numeric, deductions numeric, breakdown jsonb, status text DEFAULT 'generated',
  chips_transferred boolean DEFAULT false, due_at timestamptz, notes text, message_sent boolean DEFAULT false,
  message_sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz,
  source_union_presettlement_id uuid, source_ledger_id uuid, source_credit_invoice_id uuid, source_credit_payment_id uuid,
  transferred_at timestamptz, chip_transfer_id uuid, overdue_at timestamptz, reminders_sent int, last_reminder_at timestamptz);
CREATE TABLE public.accounting_invoice_deliveries(invoice_id uuid, recipient_id uuid, message_id uuid, notification_id uuid);
CREATE TABLE public.union_presettlements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), union_id uuid, club_id uuid,
  received_at timestamptz, reference text, method text, applied_settlement_id uuid, amount numeric);
CREATE TABLE public.harness_bodies(invoice_id uuid, body text);
CREATE FUNCTION public.fn_ca_launch_accounting_invoice_transition(jsonb, jsonb) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.fn_is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.ca_can_view_club_finances(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.ca_can_oversee_union(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.unions u WHERE u.id = p AND u.owner_id = auth.uid())
         OR EXISTS (SELECT 1 FROM public.union_admins a WHERE a.union_id = p AND a.user_id = auth.uid()) $$;
""")
    run(f"ALTER TABLE public.settlement_invoices ADD CONSTRAINT settlement_invoices_invoice_type_check "
        f"{pre['invoice_type_check']['definition']};")
    views = VIEWS.read_text()
    run('BEGIN;\n' + views[views.index('CREATE OR REPLACE FUNCTION smarter_private.union_statement_figure('):
                           views.index('-- The Messenger body of a union square-up or credit note.')] + '\nCOMMIT;')
    # Every production body, installed as captured (bodies not checked: the
    # unexercised ones reference production tables this fixture does not have).
    sql = ['SET check_function_bodies = off;']
    for sig, f in pre['functions'].items():
        sql.append(f['definition'].rstrip() + ';')
        sql.append(f'REVOKE ALL ON FUNCTION {sig} FROM PUBLIC, anon, authenticated, service_role;')
        grantees = [g.split('=')[0] for g in f['acl'].strip('{}').split(',') if g.split('=')[0] not in ('postgres', '')]
        if grantees:
            sql.append(f'GRANT EXECUTE ON FUNCTION {sig} TO {", ".join(grantees)};')
    run('\n'.join(sql))
    for sig, f in pre['functions'].items():
        got = run(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure));")
        check(f'captured body reproduces its production md5: {sig}', got == f['md5'], got)
    check('captured invoice-type check reproduces its production md5',
          run("SELECT md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conname='settlement_invoices_invoice_type_check';")
          == pre['invoice_type_check']['md5'])

    run(f"INSERT INTO public.unions VALUES ('{U}','Midway Union','midway-union','{OWNER}');"
        f"INSERT INTO public.union_admins VALUES ('{U}','{ADMIN}');"
        f"INSERT INTO public.clubs VALUES ('{U}','Midway Union','{OWNER}'),('{KC}','KINGS CLUB','{OWNER}'),('{FS}','The Felt Society',NULL);"
        f"INSERT INTO public.union_invoice_counters VALUES ('{U}', 2026, 42);")
    run(squareup(S34, 'MIDWAY-2026-000034', KC, 'club', KC, 'union', U, '110114.30', 'club owes union'))
    run(squareup(S50, 'MIDWAY-2026-000050', FS, 'club', FS, 'union', U, '1000.00', 'club owes union'))
    run(squareup(S60, 'MIDWAY-2026-000060', FS, 'club', FS, 'union', U, '100.00', 'club owes union'))
    run(squareup(S40, 'MIDWAY-2026-000040', U, 'union', U, 'club', U, '21.25', 'union owes club'))

    # SECTION 1 of the migration, byte for byte.
    mig = MIGRATION.read_text()
    section = mig[mig.index('-- ==== SECTION 1: THE CAPABILITY ===='):mig.index('-- ==== SECTION 2:')]
    run("BEGIN;\nSET LOCAL check_function_bodies = off;\n" + section + "\nCOMMIT;")
    check('the migration accepted every captured body and anchor', True)
    for sig in pre['functions']:
        if sig in ('public.fn_next_invoice_number(uuid,timestamptz)', 'public.fn_accounting_invoice_deliver_on_insert()'):
            continue
        body = run(f"SELECT position('union_weekly_debit_note' IN pg_get_functiondef('{sig}'::regprocedure)) > 0"
                   f" OR position('union_debit_note' IN pg_get_functiondef('{sig}'::regprocedure)) > 0;")
        check(f'every reader of credit notes now names charge notes: {sig}', body == 't', sig)
    check('the deliverer lists the charge note in all five places',
          run("SELECT (length(d) - length(replace(d, 'union_weekly_debit_note', ''))) / length('union_weekly_debit_note') "
              "FROM (SELECT pg_get_functiondef('public.fn_deliver_accounting_invoice(uuid)'::regprocedure) d) x;") == '5')
    acl = run("SELECT p.proacl::text = c.proacl::text AND p.prosecdef = c.prosecdef AND p.proconfig::text = c.proconfig::text "
              "FROM pg_proc p, pg_proc c WHERE p.oid = 'public.fn_union_issue_debit_note(uuid,numeric,text,boolean)'::regprocedure "
              "AND c.oid = 'public.fn_union_issue_credit_note(uuid,numeric,text,boolean)'::regprocedure;")
    check('the charge note has the credit note grants, security and search path', acl == 't', acl)
    grants = run("SELECT string_agg(r || ':' || has_function_privilege(r, 'public.fn_union_issue_debit_note(uuid,numeric,text,boolean)', 'EXECUTE'), ',' ORDER BY r) "
                 "FROM unnest(ARRAY['anon','authenticated','service_role']) r;")
    check('anon cannot issue a charge note', grants == 'anon:false,authenticated:true,service_role:true', grants)

    # The production deliverer needs the Messenger; this stand-in records a
    # delivery and renders the patched body, as the real one does for union notes.
    run("""
CREATE OR REPLACE FUNCTION public.fn_deliver_accounting_invoice(p_invoice_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t text;
BEGIN
  SELECT invoice_type INTO t FROM settlement_invoices WHERE id = p_invoice_id;
  UPDATE settlement_invoices SET message_sent = true, message_sent_at = now() WHERE id = p_invoice_id;
  IF t IN ('union_weekly_squareup','union_weekly_credit_note','union_weekly_debit_note') THEN
    INSERT INTO harness_bodies VALUES (p_invoice_id, smarter_private.union_weekly_invoice_body(p_invoice_id));
  END IF;
  INSERT INTO accounting_invoice_deliveries(invoice_id, recipient_id) VALUES (p_invoice_id, gen_random_uuid());
  RETURN jsonb_build_object('success', true, 'delivered', 1);
END $$;
CREATE TRIGGER accounting_invoice_deliver AFTER INSERT ON public.settlement_invoices
  FOR EACH ROW EXECUTE FUNCTION fn_accounting_invoice_deliver_on_insert();
-- Every fixture statement is delivered, as every Midway statement is on production.
SELECT public.fn_deliver_accounting_invoice(id) FROM public.settlement_invoices;
CREATE TRIGGER accounting_invoice_immutable BEFORE DELETE OR UPDATE ON public.settlement_invoices
  FOR EACH ROW EXECUTE FUNCTION fn_accounting_document_immutable();
""")

    # 1. The union owner issues the 000034 charge note.
    r = json.loads(as_user(OWNER, f"SELECT public.fn_union_issue_debit_note('{S34}', 43.86, 'Jackpot shares on the wrong club', false);"))
    check('a charge note is issued', r['success'] and r['amount'] == 43.86, r)
    check('a charge note is numbered from the union counter', r['debit_note_number'] == 'MIDWAY-2026-000042', r)
    check('the issue reports what is owed after it', float(r['owed_after']) == 110158.16, r)
    row = run(f"SELECT invoice_type||'|'||adjusts_invoice_id||'|'||from_entity_type||'>'||to_entity_type||'|'||net_amount||'|'||status||'|'||"
              f"(breakdown->>'debit_note_for')||'|'||(breakdown->>'reason')||'|'||(due_at > now()) FROM settlement_invoices WHERE id='{r['debit_note_id']}';")
    check('the charge note is a first-class document against the statement',
          row == f"union_weekly_debit_note|{S34}|club>union|43.86|generated|MIDWAY-2026-000034|Jackpot shares on the wrong club|true", row)
    check('the charge note was delivered on insert',
          run(f"SELECT count(*) FROM accounting_invoice_deliveries WHERE invoice_id='{r['debit_note_id']}';") == '1')
    note = run(f"SELECT body FROM harness_bodies WHERE invoice_id='{r['debit_note_id']}';")
    for line in ['Midway Union Charge Note MIDWAY-2026-000042', 'Against Invoice: MIDWAY-2026-000034',
                 'Week: Mon Oct 26, 2026 2:00 AM to Mon Nov 2, 2026 2:00 AM Chicago Time',
                 'Charge: KINGS CLUB Pays Midway Union 43.86 Chips More',
                 'A Charge Note Adds To The Original Invoice. No Chips Move.', 'Reason: Jackpot shares on the wrong club']:
        check(f'charge note body: {line}', line in note, note)
    check('outstanding = statement + charge note', run(f"SELECT public.fn_union_invoice_outstanding('{S34}');") == '110158.16')
    stmt = run(f"SELECT smarter_private.union_weekly_invoice_body('{S34}');")
    for line in ['Amount Due: KINGS CLUB Pays Midway Union 110,158.16 Chips After Charge', 'Original Amount: 110,114.30',
                 'Charged By: MIDWAY-2026-000042 (43.86)', 'Plus Charge Notes 43.86 Leaves 110,158.16 Due',
                 'Remaining Unpaid Balance: 110,158.16']:
        check(f'charged statement body: {line}', line in stmt, stmt)
    check('a charged statement never claims a credit', 'Credited By' not in stmt and 'Less Credit Notes' not in stmt, stmt)

    # 2. Issuing the same charge twice is refused.
    e = as_user_err(OWNER, f"SELECT public.fn_union_issue_debit_note('{S34}', 43.86, 'Jackpot shares on the wrong club', false);")
    check('the same charge note twice is refused', e.returncode != 0 and 'charge note already issued' in e.stderr, e.stderr)
    # 3. Callers and documents the credit note refuses are refused.
    e = as_user_err(STRANGER, f"SELECT public.fn_union_issue_debit_note('{S50}', 1, 'x', false);")
    check('a caller who is not the union is refused', e.returncode != 0 and 'not_authorised' in e.stderr, e.stderr)
    for amount, reason, want in [('0', "'x'", 'positive amount'), ('-5', "'x'", 'positive amount'),
                                 ('1.005', "'x'", 'whole cents'), ('5', "'  '", 'must carry a reason')]:
        e = as_user_err(OWNER, f"SELECT public.fn_union_issue_debit_note('{S50}', {amount}, {reason}, false);")
        check(f'a charge of {amount} / reason {reason} is refused', e.returncode != 0 and want in e.stderr, e.stderr)
    e = as_user_err(OWNER, f"SELECT public.fn_union_issue_debit_note('{r['debit_note_id']}', 1, 'x', false);")
    check('a charge note cannot be charged', e.returncode != 0 and 'only a weekly square-up can be charged' in e.stderr, e.stderr)
    e = as_user_err(OWNER, f"SELECT public.fn_union_issue_debit_note('{S40}', 1, 'x', false);")
    check('a statement the union owes cannot be charged', e.returncode != 0 and 'club owes the union' in e.stderr, e.stderr)

    # 4. Credit and charge together, numbering, and paid in full.
    c = json.loads(as_user(ADMIN, f"SELECT public.fn_union_issue_credit_note('{S50}', 200, 'credit', false);"))
    d = json.loads(as_user(ADMIN, f"SELECT public.fn_union_issue_debit_note('{S50}', 50, 'charge', false);"))
    check('credit and charge notes share one counter',
          (c['credit_note_number'], d['debit_note_number']) == ('MIDWAY-2026-000043', 'MIDWAY-2026-000044'), (c, d))
    check('a charge note after a credit owes statement - credit + charge', float(d['owed_after']) == 850.0, d)
    check('outstanding = 1000 - 200 + 50', run(f"SELECT public.fn_union_invoice_outstanding('{S50}');") == '850.00')
    both = run(f"SELECT smarter_private.union_weekly_invoice_body('{S50}');")
    for line in ['Amount Due: The Felt Society Pays Midway Union 850.00 Chips After Credit And Charge',
                 'Credited By: MIDWAY-2026-000043 (200.00)', 'Charged By: MIDWAY-2026-000044 (50.00)']:
        check(f'credited and charged statement body: {line}', line in both, both)
    p = json.loads(as_user(OWNER, f"SELECT public.ca_union_set_statement_paid('{S50}', true, 800, NULL);"))
    check('paying 800 of 850 leaves it open', p['owed'] == 850 and p['status'] == 'generated' and not p['fully_settled'], p)
    p = json.loads(as_user(OWNER, f"SELECT public.ca_union_set_statement_paid('{S50}', true, NULL, NULL);"))
    check('paid in full owes exactly statement - credit + charge', p['owed'] == 850 and p['paid_total'] == 850 and p['fully_settled'], p)
    p = json.loads(as_user(OWNER, f"SELECT public.ca_union_set_statement_paid('{S34}', true, NULL, NULL);"))
    check('000034 is paid at 110,158.16', p['owed'] == 110158.16 and p['paid_total'] == 110158.16, p)
    check('the paid statements are delivered statements',
          run(f"SELECT count(*) FROM settlement_invoices s WHERE s.id IN ('{S34}','{S50}') AND s.message_sent "
              f"AND EXISTS (SELECT 1 FROM accounting_invoice_deliveries d WHERE d.invoice_id = s.id);") == '2')
    rec = run(f"SELECT status||'|'||(breakdown->>'paid_total')||'|'||jsonb_array_length(breakdown->'payments')||'|'||"
              f"(breakdown->'payments'->0->>'amount')||'|'||(breakdown->'payments'->1->>'amount') FROM settlement_invoices WHERE id='{S50}';")
    check('a delivered statement records the partial and the full payment', rec == 'paid|850.00|2|800.00|50.00', rec)

    # 7. The guard still freezes everything but the four payment keys.
    for label, sql in [
        ('another breakdown key', f"UPDATE settlement_invoices SET breakdown = breakdown || '{{\"eco_amount\": 1}}' WHERE id='{S34}';"),
        ('a payment key together with another key', f"UPDATE settlement_invoices SET breakdown = breakdown || '{{\"paid_total\": 1, \"presettled\": 5}}' WHERE id='{S34}';"),
        ('net_amount', f"UPDATE settlement_invoices SET net_amount = net_amount + 1 WHERE id='{S34}';"),
        ('notes', f"UPDATE settlement_invoices SET notes = 'edited' WHERE id='{S34}';"),
        ('due_at', f"UPDATE settlement_invoices SET due_at = due_at + interval '1 day' WHERE id='{S34}';"),
        ('a charge note amount', f"UPDATE settlement_invoices SET net_amount = 1 WHERE id='{r['debit_note_id']}';"),
        ('deleting a delivered statement', f"DELETE FROM settlement_invoices WHERE id='{S40}';"),
    ]:
        e = command(PSQL, sql, allow_error=True)
        check(f'a delivered union statement still refuses {label}',
              e.returncode != 0 and 'issued_accounting_invoice_is_immutable' in e.stderr, e.stderr)
    run(f"INSERT INTO settlement_invoices(id,club_id,invoice_type,invoice_number,from_entity_type,from_entity_id,to_entity_type,"
        f"to_entity_id,net_amount,breakdown) VALUES ('10000000-0000-4000-8000-000000000099','{KC}','club_weekly_accounting','CA-9',"
        f"'club','{KC}','union','{U}',5,'{{}}'::jsonb);")
    e = command(PSQL, "UPDATE settlement_invoices SET breakdown = breakdown || '{\"paid_total\": 5}' "
                      "WHERE id='10000000-0000-4000-8000-000000000099';", allow_error=True)
    check('another issued document type still refuses even a payment key',
          e.returncode != 0 and 'issued_accounting_invoice_is_immutable' in e.stderr, e.stderr)
    u = json.loads(as_user(OWNER, f"SELECT public.ca_union_set_statement_paid('{S50}', false, NULL, 'reopened');"))
    check('a delivered statement can be reopened', u['status'] == 'generated' and u['paid_total'] == 0, u)
    rec = run(f"SELECT status||'|'||(breakdown->>'paid_total')||'|'||jsonb_array_length(breakdown->'payments')||'|'||"
              f"(breakdown->'payments'->2->>'reversal') FROM settlement_invoices WHERE id='{S50}';")
    check('reopening keeps the payment history and appends the reversal', rec == 'generated|0|3|true', rec)

    # 5. The credit-note cap counts charges.
    as_user(None, f"SELECT public.fn_union_issue_debit_note('{S60}', 20, 'server charge', false);")
    c = json.loads(as_user(OWNER, f"SELECT public.fn_union_issue_credit_note('{S60}', 120, 'credit all', false);"))
    check('a credit may reduce a charged statement to zero', float(c['remaining_after']) == 0, c)
    e = as_user_err(OWNER, f"SELECT public.fn_union_issue_credit_note('{S60}', 0.01, 'more', false);")
    check('a credit beyond statement + charges is refused', e.returncode != 0 and 'exceeds what is left' in e.stderr, e.stderr)
    check('cancelled notes are not owed',
          run(f"UPDATE settlement_invoices SET status='cancelled' WHERE adjusts_invoice_id='{S60}' AND invoice_type='union_weekly_debit_note';"
              f"SELECT public.fn_union_invoice_outstanding('{S60}');") == '-20.00')

    # 6. The statement of account carries the charge with the statement's sign.
    run("CREATE OR REPLACE FUNCTION public.ca_can_view_club_finances(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;")
    soa = run(f"SELECT string_agg(entry_type||'|'||amount||'|'||running_balance||'|'||reference||'|'||description, ';' ORDER BY entry_at) "
              f"FROM public.fn_union_club_statement_of_account('{U}','{KC}');")
    check('statement of account: the charge note adds with the statement sign',
          soa == 'statement|110114.30|110114.30|MIDWAY-2026-000034|Weekly statement 2026-10-26 to 2026-11-02;'
                 'debit_note|43.86|110158.16|MIDWAY-2026-000042|Charge note against MIDWAY-2026-000034 - Jackpot shares on the wrong club', soa)
    results['passed'] = True
finally:
    command(owner + [PG / 'pg_ctl', '-D', cluster / 'data', '-m', 'immediate', 'stop'], allow_error=True)
    (out / 'RESULTS.json').write_text(json.dumps(results, indent=2) + '\n')
    shutil.rmtree(cluster, ignore_errors=True)
print(f"union charge notes: {len(results['checks'])} checks passed")
