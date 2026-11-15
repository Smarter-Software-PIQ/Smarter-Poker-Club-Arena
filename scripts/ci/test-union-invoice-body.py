"""Qualify the union weekly invoice Messenger body in an isolated PostgreSQL.

Installs only the helper and body functions from migration
20261115011424_union_invoice_views_show_the_week_and_who_pays.sql (byte for
byte, with its grants) over a minimal settlement_invoices / clubs / unions
fixture, then reads the body of a club-pays square-up, a square row, the
union's own house row, a credited invoice and its credit note, a week that
crosses the daylight-saving change and an invoice carrying the cash and
tournament split. The installed-function patches (board, delivery, issue
note) are anchor patches of production bodies; they are rehearsed read-only
against production with pg_temp copies, not here. No production access.
"""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261115011424_union_invoice_views_show_the_week_and_who_pays.sql'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, required=True)
out = parser.parse_args().output.resolve()
out.mkdir(parents=True, exist_ok=True)
PG = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
env['TZ'] = 'UTC'
cluster = pathlib.Path(tempfile.mkdtemp(prefix='union-invoice-body-'))
socket = cluster / 's'
socket.mkdir(mode=0o700)
owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
if owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(socket, 'postgres')
PSQL = [PG / 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '55831', '-U', 'postgres', '-d', 'postgres']
results = {'checks': [], 'production_mutations': False}


def command(args, sql=None, allow_error=False):
    r = subprocess.run([str(x) for x in args], input=sql, text=True, capture_output=True, env=env, timeout=60)
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
DS = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'
SV = '946747c6-b991-4220-b0cb-effbea46ecd2'
FS = 'a0000000-0000-0000-0000-000000000001'
KC = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
WEEK = {'period_start': '2026-11-02T08:00:00+00:00', 'period_end': '2026-11-09T08:00:00+00:00'}


def eco(cash, cash_base, tournament, tournament_base):
    return [
        {'activity': 'cash', 'amount': cash, 'base': cash_base, 'rate': 0.10, 'enabled': True, 'status': 'recorded',
         'base_mode': 'club_profit', 'terms_id': '6c88eae7-d370-474a-aa6d-3bb8c26e3b1f', 'record_id': '071d0a46-c7a9-4a70-9b68-812206c68e60'},
        {'activity': 'tournament', 'amount': tournament, 'base': tournament_base, 'rate': 0.10, 'enabled': True, 'status': 'recorded',
         'base_mode': 'club_profit', 'terms_id': '6c88eae7-d370-474a-aa6d-3bb8c26e3b1f', 'record_id': 'e17242f8-6948-4a6b-bc6c-bf93c2da6521'},
    ]


def squareup(club, direction, rake, fee, rakeback, players, pnl, eco_amount, settled, outstanding, components, week=WEEK, extra=None):
    b = {'union_id': U, 'union_name': 'Midway Union', 'club_id': club, 'direction': direction,
         'rake_generated': rake, 'union_fee_kept': fee, 'rakeback_due': rakeback, 'players_won': players,
         'player_pnl_net': pnl, 'eco_amount': eco_amount, 'presettled': 0, 'settled_in_chips': settled,
         'outstanding': outstanding, 'eco_version': 2, 'eco_components': components, **week}
    b.update(extra or {})
    return b


ROWS = [
    # id, club, type, number, from, from_id, to, to_id, net, status, due, breakdown, adjusts
    ('10000000-0000-4000-8000-000000000038', DS, 'union_weekly_squareup', 'MIDWAY-2026-000038', 'club', DS, 'union', U, '96919.54', 'generated', '2026-11-12 08:00Z',
     squareup(DS, 'club owes union', 452206.43, 45220.65, 406985.78, -562209.57, -110003.14, -96919.54, 296982.64, -96919.54,
              eco(-64290.55, 642905.48, -32628.99, 326289.87)), None),
    ('10000000-0000-4000-8000-000000000037', SV, 'union_weekly_squareup', 'MIDWAY-2026-000037', 'union', U, 'club', SV, '0.00', 'generated', '2026-11-12 08:00Z',
     squareup(SV, 'square', 0, 0, 0, 0, 0, 0, 0, 0, eco(0, 0, 0, 0)), None),
    ('10000000-0000-4000-8000-000000000040', U, 'union_weekly_squareup', 'MIDWAY-2026-000040', 'union', U, 'club', U, '21.25', 'generated', '2026-11-12 08:00Z',
     squareup(U, 'union owes club', 0, 0, 0, 212.51, 212.51, 21.25, 212.51, 21.25, eco(21.25, -212.51, 0, 0)), None),
    ('10000000-0000-4000-8000-000000000015', FS, 'union_weekly_squareup', 'MIDWAY-2026-000015', 'club', FS, 'union', U, '126153.66', 'paid', '2026-10-08 07:00Z',
     squareup(FS, 'club owes union', 1, 0.1, 0.9, -1, 0, -126153.66, 0.9, -126153.66, eco(-126153.66, 1261536.6, 0, 0),
              {'period_start': '2026-09-28T07:00:00+00:00', 'period_end': '2026-10-05T07:00:00+00:00'}), None),
    ('10000000-0000-4000-8000-000000000018', FS, 'union_weekly_credit_note', 'MIDWAY-2026-000018', 'union', U, 'club', FS, '126153.66', 'paid', None,
     {'union_id': U, 'union_name': 'Midway Union', 'club_id': FS, 'original_invoice_id': '10000000-0000-4000-8000-000000000015',
      'credit_note_for': 'MIDWAY-2026-000015', 'reason': 'House settlement waived in full.',
      'period_start': '2026-09-28T07:00:00+00:00', 'period_end': '2026-10-05T07:00:00+00:00'}, '10000000-0000-4000-8000-000000000015'),
    ('10000000-0000-4000-8000-000000000033', KC, 'union_weekly_squareup', 'MIDWAY-2026-000034', 'club', KC, 'union', U, '6042.96', 'generated', '2026-11-05 08:00Z',
     squareup(KC, 'club owes union', 25854.24, 2585.44, 23268.80, -37160.83, -11306.59, -6042.96, 11962.21, -6042.96,
              eco(-3397.16, 33971.59, -2645.80, 26458.04),
              {'period_start': '2026-10-26T07:00:00+00:00', 'period_end': '2026-11-02T08:00:00+00:00'},
              {'weekly_player_results': {'version': 1, 'cash_net_loss': 19148.89, 'tournament_net_loss': 18011.94,
                                         'total_net_loss': 37160.83, 'rakeback_credit': 23268.80, 'eco_charge': 6042.96,
                                         'weekly_net_due_to_union': 19934.99, 'sign_convention': 'positive_club_owes_union'}}), None),
    ('10000000-0000-4000-8000-000000000099', DS, 'club_weekly_accounting', 'CA-1', 'club', DS, 'union', U, '1.00', 'generated', None, {}, None),
]


def literal(x):
    if x is None:
        return 'NULL'
    if isinstance(x, (dict, list)):
        x = json.dumps(x)
    return "'" + str(x).replace("'", "''") + "'"


try:
    command(owner + [PG / 'initdb', '-D', cluster / 'data', '-U', 'postgres', '--auth=trust', '-E', 'UTF8'])
    command(owner + [PG / 'pg_ctl', '-D', cluster / 'data', '-l', cluster / 'log', '-w', '-o',
                     f'-c listen_addresses= -c unix_socket_directories={socket} -c port=55831', 'start'])
    run("""
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA smarter_private;
GRANT USAGE ON SCHEMA smarter_private TO anon, authenticated, service_role;
CREATE TABLE public.unions(id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.clubs(id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.settlement_invoices(
  id uuid PRIMARY KEY, club_id uuid, invoice_type text, invoice_number text,
  from_entity_type text, from_entity_id text, to_entity_type text, to_entity_id text,
  net_amount numeric, status text, due_at timestamptz, breakdown jsonb, adjusts_invoice_id uuid,
  created_at timestamptz NOT NULL DEFAULT now());
""")
    run(f"INSERT INTO public.unions VALUES ('{U}','Midway Union');"
        f"INSERT INTO public.clubs VALUES ('{U}','Midway Union'),('{DS}','Deep Stack Society'),('{SV}','Club Savage'),"
        f"('{FS}','The Felt Society'),('{KC}','KINGS CLUB');")
    for r in ROWS:
        run('INSERT INTO public.settlement_invoices(id,club_id,invoice_type,invoice_number,from_entity_type,from_entity_id,'
            'to_entity_type,to_entity_id,net_amount,status,due_at,breakdown,adjusts_invoice_id) VALUES ('
            + ','.join(literal(v) for v in r) + ');')

    source = MIGRATION.read_text()
    start = source.index('CREATE OR REPLACE FUNCTION smarter_private.union_statement_figure(')
    end = source.index('CREATE FUNCTION pg_temp.ca_patch(')
    run('BEGIN;\n' + source[start:end] + '\nCOMMIT;')

    def body(n):
        return run(f"SELECT smarter_private.union_weekly_invoice_body(id) FROM public.settlement_invoices WHERE invoice_number='{n}';")

    week = 'Week: Mon Nov 2, 2026 2:00 AM to Mon Nov 9, 2026 2:00 AM Chicago Time'
    ds = body('MIDWAY-2026-000038')
    for line in [week, 'The Week Includes Its Start And Excludes Its End.', 'Issued By: Midway Union',
                 'Issued To: Deep Stack Society', 'Amount Due: Deep Stack Society Pays Midway Union 96,919.54 Chips',
                 'Due: Thu Nov 12, 2026 2:00 AM Chicago Time', 'Rake Generated: 452,206.43', 'Union Fee Kept: 45,220.65',
                 'Rakeback Paid To The Club: 406,985.78', 'Player Result Excluding Fees: -110,003.14',
                 'Cash And Tournament Player Split: Not Recorded On This Invoice',
                 'Cash ECO: -64,290.55 (Base 642,905.48 At 10%)', 'Tournament ECO: -32,628.99 (Base 326,289.87 At 10%)',
                 'Settled In Chips: 296,982.64', '(The Only Union To Club Transfer In It)',
                 'Amount Due Is What Remains: Combined ECO -96,919.54 Plus Recorded Presettlements 0.00 Equals -96,919.54']:
        check(f'club pays: {line}', line in ds, ds)
    check('club pays: no transfer claim for the whole figure', 'already moved during the week' not in ds, ds)

    sv = body('MIDWAY-2026-000037')
    check('square says nothing is due', 'Amount Due: Square, Nothing Due' in sv and '\nDue: ' not in sv, sv)
    check('square says no rakeback was paid', 'No Rakeback Was Paid To The Club For This Week' in sv, sv)

    house = body('MIDWAY-2026-000040')
    for line in ['Midway Union House Club Statement MIDWAY-2026-000040',
                 "Issued To: Midway Union (The Union's Own House Club)",
                 'Amount Due: Midway Union Pays Midway Union (House Club) 21.25 Chips', 'Cash ECO: 21.25 (Base -212.51 At 10%)']:
        check(f'house row: {line}', line in house, house)

    credited = body('MIDWAY-2026-000015')
    for line in ['Amount Due: Credited In Full, Nothing Due', 'Original Amount: 126,153.66',
                 'Credited By: MIDWAY-2026-000018 (126,153.66)', 'Less Credit Notes 126,153.66 Leaves 0.00 Due',
                 'Week: Mon Sep 28, 2026 2:00 AM to Mon Oct 5, 2026 2:00 AM Chicago Time']:
        check(f'credited invoice: {line}', line in credited, credited)
    check('credited invoice never reads as owing its full amount',
          'Pays Midway Union 126,153.66' not in credited and '\nDue: ' not in credited, credited)

    note = body('MIDWAY-2026-000018')
    for line in ['Midway Union Credit Note MIDWAY-2026-000018', 'Against Invoice: MIDWAY-2026-000015',
                 'Credit: Midway Union Credits The Felt Society 126,153.66 Chips', 'No Chips Move.']:
        check(f'credit note: {line}', line in note, note)

    dst = body('MIDWAY-2026-000034')
    for line in ['Week: Mon Oct 26, 2026 2:00 AM to Mon Nov 2, 2026 2:00 AM Chicago Time',
                 'Positive Means Players Lost Or The Club Pays.', 'Cash Player Net Loss: 19,148.89',
                 'ECO Charge Or Credit (Positive Means The Club Pays): 6,042.96',
                 'Full Weekly Net (Positive Club Owes Union): 19,934.99']:
        check(f'daylight-saving week with split: {line}', line in dst, dst)

    figures = run("SELECT string_agg(smarter_private.union_statement_figure(x), '|' ORDER BY o) FROM (VALUES "
                  "(1, 1.005::numeric), (2, 0), (3, -0.07), (4, 1234567890123456789.12), (5, 452206.43000000000000000000), (6, NULL)) v(o, x);")
    check('figures are copied digit for digit', figures == '1.005|0.00|-0.07|1,234,567,890,123,456,789.12|452,206.43|Unavailable', figures)

    wrong = command(PSQL, "SELECT smarter_private.union_weekly_invoice_body('10000000-0000-4000-8000-000000000099');", allow_error=True)
    check('another document type is refused', wrong.returncode != 0 and 'union_weekly_invoice_body_wrong_document' in wrong.stderr, wrong.stderr)

    grants = run("SELECT string_agg(r || ':' || has_function_privilege(r, 'smarter_private.union_weekly_invoice_body(uuid)', 'EXECUTE'), ',' ORDER BY r) "
                 "FROM unnest(ARRAY['anon','authenticated','service_role']) r;")
    check('a browser role cannot read an invoice body', grants == 'anon:false,authenticated:false,service_role:true', grants)
    results['passed'] = True
finally:
    command(owner + [PG / 'pg_ctl', '-D', cluster / 'data', '-m', 'immediate', 'stop'], allow_error=True)
    (out / 'RESULTS.json').write_text(json.dumps(results, indent=2) + '\n')
    shutil.rmtree(cluster, ignore_errors=True)
print(f"union invoice body: {len(results['checks'])} checks passed")
