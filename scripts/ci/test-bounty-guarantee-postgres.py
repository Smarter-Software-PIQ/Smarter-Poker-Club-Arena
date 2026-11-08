#!/usr/bin/env python3
"""Run the exact migration and actual funding writers in an owned empty PG17."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[2]
pg = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
parent = os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP')
if not parent:
    raise SystemExit('Set TMPDIR to owned external scratch (RUNNER_TEMP in CI)')
work = Path(tempfile.mkdtemp(prefix='bounty-guarantee-', dir=parent))
sock = Path(tempfile.mkdtemp(prefix='',dir=root.parent))
def run(args, **kwargs):
    return subprocess.run([str(x) for x in args], check=True, text=True, **kwargs)
def sql_file(path):
    run([pg/'psql','-X','-h',sock,'-p','55489','-U','fixture','-d','postgres','-v','ON_ERROR_STOP=1','-f',path], stdout=subprocess.DEVNULL,cwd=sock)
started=False
try:
    run([pg/'initdb','-D',work/'data','-U','fixture','-A','trust','--no-locale'],stdout=subprocess.DEVNULL)
    run([pg/'pg_ctl','-D',work/'data','-l',work/'pg.log','-o',f"-h '' -k '{sock}' -p 55489",'-w','start'],stdout=subprocess.DEVNULL,cwd=sock)
    started=True
    sql_file(root/'tests/sql/fixtures/bounty-guarantee-before.sql')
    # The old writer reproduces the defect before the exact candidate is applied.
    sql_file(root/'tests/sql/bounty-guarantee-before-check.sql')
    sql_file(root/'supabase/migrations/20261102051957_tournament_guarantees_include_funded_bounties.sql')
    sql_file(root/'tests/sql/bounty-guarantee-after-check.sql')
    sql_file(root/'tests/sql/fixtures/bounty-owner-correction.sql')
    sql_file(root/'supabase/migrations/20261102052012_receipt_bound_owner_bounty_correction_admission.sql')
    sql_file(root/'tests/sql/bounty-owner-correction-check.sql')
    print('PASS: before regression, exact migration, funded guarantee, late entry overlay return, replay, journal rollback and funding access, paid-preserving owner correction and guard refusals')
finally:
    if started:
        run([pg/'pg_ctl','-D',work/'data','-m','immediate','stop'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    shutil.rmtree(work)
    shutil.rmtree(sock)

# Current net-coverage and promo-custody regression shares this required accounting route.
run([sys.executable, root/'scripts/ci/test-net-guarantee-promo.py'])

# Completed-event guarantee debt uses the established house-settlement door.
run([sys.executable, root/'scripts/ci/test-net-guarantee-completed.py'])
