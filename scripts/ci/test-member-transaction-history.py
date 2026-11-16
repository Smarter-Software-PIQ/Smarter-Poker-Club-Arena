#!/usr/bin/env python3
"""Run the maintained member-history reader in isolated PostgreSQL, never production."""
import os, re, shutil, socket, subprocess, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PG=Path(os.environ.get('PG_BIN',next((p for p in ['/usr/lib/postgresql/17/bin','/opt/homebrew/opt/postgresql@17/bin'] if (Path(p)/'initdb').exists()),'/usr/lib/postgresql/17/bin')))
BASE=ROOT/'supabase/migrations/20261025025659_cashier_history_feed_search_cursor_person_and_club_totals.sql'
MIG=next((ROOT/'supabase/migrations').glob('*_member_transaction_history_reads_every_recorded_wallet_movem.sql'))
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
 q('''CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE club_members(club_id uuid,user_id uuid);
 CREATE TABLE profiles(id uuid,alias text,username text,display_name text,first_name text,last_name text,full_name text);
 CREATE TABLE roles(club_id uuid,user_id uuid,role text);
 CREATE TABLE edges(parent uuid,child uuid);
 CREATE FUNCTION fn_club_bank_role(uuid,uuid) RETURNS text LANGUAGE sql AS $$SELECT role FROM roles WHERE club_id=$1 AND user_id=$2$$;
 CREATE FUNCTION fn_club_active_cashier_edges(uuid) RETURNS TABLE(parent uuid,child uuid) LANGUAGE sql AS $$SELECT * FROM edges$$;
 CREATE TABLE chip_transactions(id uuid,club_id uuid,created_at timestamptz,transaction_type text,amount numeric,from_user_id uuid,to_user_id uuid,notes text,metadata jsonb);
 CREATE TABLE chip_ledger(id uuid,club_id uuid,created_at timestamptz,category text,amount numeric,from_entity_id uuid,to_entity_id uuid,from_type text,to_type text,notes text,metadata jsonb,status text,idempotency_key text,correlation_id uuid,from_label text);
 CREATE INDEX ON chip_transactions(club_id,from_user_id,created_at); CREATE INDEX ON chip_transactions(club_id,to_user_id,created_at);
 CREATE INDEX ON chip_ledger(club_id,from_entity_id,created_at); CREATE INDEX ON chip_ledger(club_id,to_entity_id,created_at);
 CREATE FUNCTION fn_ca_transaction_party_name(text,text,jsonb,uuid,text) RETURNS text LANGUAGE sql AS $$SELECT NULL::text$$;
 CREATE FUNCTION fn_cashier_history_funding_wallet(text,jsonb) RETURNS text LANGUAGE sql AS $$SELECT $2->>'source'$$;
 ''')
 text=BASE.read_text();start=text.index('CREATE OR REPLACE FUNCTION public.fn_cashier_history_book(');end=text.index('$function$;',start)+len('$function$;');q(text[start:end])
 text=(ROOT/'tests/fixtures/cashier-statements/db-production-shape.sql').read_text();start=text.index('CREATE OR REPLACE FUNCTION public.fn_arena_name(');end=text.index('$function$;',start)+len('$function$;');q(text[start:end])
 assert q("SELECT to_regprocedure('fn_member_transaction_history(uuid,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid,integer,text)') IS NULL")=='t'
 print('PASS before: complete member feed absent',flush=True)
 q(MIG.read_text())
 print(q((ROOT/'tests/fixtures/member-transaction-history.sql').read_text()),flush=True)
finally:
 if started: run([PG/'pg_ctl','-D',scratch/'data','-m','immediate','-w','stop'])
 shutil.rmtree(scratch)
