#!/usr/bin/env python3
"""Qualify agent/downline Ledger Window totals against the installed preimage in isolated PostgreSQL."""
import os, re, shutil, socket, subprocess, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PG=Path(os.environ.get('PG_BIN',next((p for p in ['/usr/lib/postgresql/17/bin','/opt/homebrew/opt/postgresql@17/bin'] if (Path(p)/'initdb').exists()),'/usr/lib/postgresql/17/bin')))
BASE=ROOT/'supabase/migrations/20261101061213_member_statistics_use_chicago_calendar_boundaries.sql'
MIG=next((ROOT/'supabase/migrations').glob('*_member_ledger_activity_separates_agent_and_complete_downline.sql'))
scratch=Path(tempfile.mkdtemp(prefix='mh-',dir=os.environ.get('TMPDIR')))
with socket.socket() as port_socket:
 port_socket.bind(('127.0.0.1',0));port=port_socket.getsockname()[1]
started=False
def run(args,sql=None):
 p=subprocess.run([str(x) for x in args],input=sql,text=True,capture_output=True,timeout=90)
 if p.returncode: raise RuntimeError(p.stdout+p.stderr)
 return p.stdout.strip()
def q(sql):
 return run([PG/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',str(port),'-U','postgres','-d','postgres'],sql)
try:
 run([PG/'initdb','-D',scratch/'data','-U','postgres','--auth-local=trust','--auth-host=trust','--no-locale','--encoding=UTF8'])
 with (scratch/'data/postgresql.conf').open('a') as f: f.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nunix_socket_directories=''\n")
 run([PG/'pg_ctl','-D',scratch/'data','-l',scratch/'log','-w','start']);started=True
 q((ROOT/'scripts/ci/fixtures/member-stats-chicago/bootstrap.sql').read_text())
 import json
 q('\n'.join(x+';' for x in json.loads((ROOT/'scripts/ci/fixtures/member-stats-chicago/functions-before.json').read_text()).values()))
 q("ALTER TABLE chip_transactions ADD COLUMN id uuid DEFAULT gen_random_uuid(), ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb; ALTER TABLE chip_ledger ADD COLUMN id uuid DEFAULT gen_random_uuid();")
 def function(path,name,tag='$function$;'):
  text=path.read_text();start=text.index(name);delimiter=tag.rstrip(';');opening=text.index(delimiter,start);closing=text.index(delimiter,opening+len(delimiter));return text[start:closing+len(delimiter)]+';'
 q(function(BASE,'CREATE FUNCTION public.ca_member_record_chicago_facts(', '$chicago$;'))
 q(function(ROOT/'supabase/migrations/20261101173211_member_chicago_fees_use_daily_core_and_timestamp_edges.sql','CREATE OR REPLACE FUNCTION public.ca_club_member_chicago_fee_totals('))
 q(function(ROOT/'supabase/migrations/20261114172156_member_figures_carry_exact_decimal_text.sql','CREATE OR REPLACE FUNCTION public.ca_jsonb_figure_text('))
 q((ROOT/'tests/fixtures/member-activity-detail-before.sql').read_text())
 assert q("SELECT md5(pg_get_functiondef('ca_club_member_detail(uuid,uuid,date,date)'::regprocedure))")=='7f927eddf28d7d3054fcf24a240a31b0'
 # This predicate fails against the actual installed preimage, then passes.
 setup,checks=(ROOT/'tests/fixtures/member-activity-breakdown.sql').read_text().split('-- BREAKDOWN ASSERTIONS',1)
 q(setup)
 assert q("SELECT ca_club_member_detail(md5('club')::uuid,md5('agent')::uuid,'2026-11-16','2026-11-16') ? 'activity_breakdown'")=='f'
 print('PASS before: actual installed member record omits downline activity',flush=True)
 q(MIG.read_text())
 print(q(checks),flush=True)
finally:
 if started: run([PG/'pg_ctl','-D',scratch/'data','-m','immediate','-w','stop'])
 shutil.rmtree(scratch)
