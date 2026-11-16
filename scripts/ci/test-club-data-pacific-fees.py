#!/usr/bin/env python3
"""Qualify the new Pacific report fee adapter on private PostgreSQL.

Uses exact maintained Chicago preimage and actual new migration bytes. Fixtures
independently pin Pacific day edges, existing UTC per-rule share rounding,
redemption effective instants, incoming-share filtering, private access and DST.
No production connection or financial write is used.
"""
import os, shutil, socket, subprocess, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
MIG=ROOT/'supabase/migrations/20261116163311_legacy_club_data_reads_pacific_calendar_days.sql'
PG=Path(os.environ.get('PG_BIN') or next((p for p in ('/usr/lib/postgresql/17/bin','/usr/lib/postgresql/16/bin','/opt/homebrew/opt/postgresql@17/bin') if (Path(p)/'initdb').exists()),'/usr/lib/postgresql/17/bin'))
ENV={**os.environ,'PATH':str(PG)+':/usr/bin:/bin','LANG':'C','LC_ALL':'C','PGTZ':'UTC'}
cluster=Path(tempfile.mkdtemp(prefix='pacific-fee-',dir=os.environ.get('TMPDIR')))
with socket.socket() as sock:
 sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
started=False

def run(args,sql=None):
 p=subprocess.run([str(x) for x in args],input=sql,text=True,capture_output=True,env=ENV,timeout=60)
 if p.returncode: raise RuntimeError(p.stdout+p.stderr)
 return p.stdout.strip()
def q(sql):return run([PG/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',str(port),'-U','postgres','-d','postgres'],sql)
def function(path,name):
 s=(ROOT/path).read_text(); a=s.index('CREATE OR REPLACE FUNCTION public.'+name+'('); b=s.index('$function$;',a)+len('$function$;'); return s[a:b]
def check(actual,expected,label):
 assert actual==expected,(label,actual,expected)
 print('PASS: '+label,flush=True)
try:
 run([PG/'initdb','-D',cluster/'data','-U','postgres','--auth=trust','--no-locale','-E','UTF8'])
 with (cluster/'data/postgresql.conf').open('a') as f:f.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nunix_socket_directories=''\nfsync=off\ntimezone='UTC'\n")
 run([PG/'pg_ctl','-D',cluster/'data','-l',cluster/'server.log','-w','start']); started=True
 q('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA smarter_private;
 CREATE TABLE public.rake_records(id uuid PRIMARY KEY,created_at timestamptz);
 CREATE TABLE public.rake_attributions(id uuid PRIMARY KEY,club_id uuid,player_id uuid,created_at timestamptz,rake_amount numeric,rake_record_id uuid);
 CREATE TABLE public.ca_club_rake_daily_user(club_id uuid,user_id uuid,day date,rake_cents bigint);
 CREATE TABLE smarter_private.player_fee_redemptions(club_id uuid,user_id uuid,effective_on date,amount_cents bigint);
 CREATE TABLE smarter_private.player_rake_share_rules(rule_key text,club_id uuid,from_user uuid,to_user uuid,share_bps integer,effective_from timestamptz,effective_until timestamptz,tournament_effective_from date);
 CREATE TABLE public.accounting_tournament_fee_sources(id uuid,club_id uuid,player_id uuid,charged_at timestamptz,rake_credit numeric);
 CREATE TABLE public.ca_club_member_tournament_fee_daily(club_id uuid,user_id uuid,day date,fees numeric);
 CREATE FUNCTION public.fn_ca_fee_counting_start() RETURNS date LANGUAGE sql IMMUTABLE AS $$SELECT '2026-09-16'::date$$;
 CREATE FUNCTION public.fn_ca_launch_accounting_cutoff(text,uuid) RETURNS timestamptz LANGUAGE sql STABLE AS $$SELECT NULL::timestamptz$$;
 CREATE FUNCTION public.fn_ca_launch_accounting_accepts(uuid,timestamptz) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;
 ''')
 q(function(Path('supabase/migrations/20261106180446_roster_fee_shares_read_the_launch_cutoff_once.sql'),'ca_club_member_fee_totals'))
 q(function(Path('supabase/migrations/20261106055718_all_earned_rake_includes_tournament_shares.sql'),'ca_club_member_chicago_fee_totals'))
 check(q("select md5(pg_get_functiondef('public.ca_club_member_chicago_fee_totals(uuid,date,date,uuid)'::regprocedure))"),'5a1333750b1b61a32a2ec4a22b884699','fixture installs exact production preimage')
 source=MIG.read_text()
 a=source.index('DO $fee_preimage$')
 end='REVOKE ALL ON FUNCTION public.fn_ca_club_pacific_member_fee_totals(uuid,date,date,uuid) FROM PUBLIC,anon,authenticated,service_role;'
 b=source.index(end,a)+len(end)
 q(source[a:b])
 q('''INSERT INTO smarter_private.player_rake_share_rules VALUES('half','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',5000,'2026-09-16',NULL,'2026-09-16');
 INSERT INTO rake_attributions SELECT gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',t::timestamptz,a,gen_random_uuid() FROM (VALUES ('2026-11-09T07:59:59Z',1.01),('2026-11-09T08:00:00Z',2.01),('2026-11-09T23:00:00Z',0.01),('2026-11-10T00:00:00Z',3.01),('2026-11-10T07:59:59Z',4.01),('2026-11-10T08:00:00Z',5.01))x(t,a);
 INSERT INTO rake_records SELECT rake_record_id,created_at FROM rake_attributions;
 INSERT INTO ca_club_rake_daily_user SELECT club_id,player_id,(created_at AT TIME ZONE 'UTC')::date,sum(round(rake_amount*100)) FROM rake_attributions GROUP BY 1,2,3;
 INSERT INTO accounting_tournament_fee_sources SELECT gen_random_uuid(),club_id,player_id,created_at,rake_amount+0.02 FROM rake_attributions WHERE rake_amount<>0.01;
 INSERT INTO accounting_tournament_fee_sources VALUES(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','2026-11-09T23:00:00Z',0.01);
 INSERT INTO ca_club_member_tournament_fee_daily SELECT club_id,player_id,(charged_at AT TIME ZONE 'UTC')::date,sum(rake_credit) FROM accounting_tournament_fee_sources GROUP BY 1,2,3;
 INSERT INTO smarter_private.player_fee_redemptions VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','2026-11-09',50),('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','2026-11-10',25);
 ''')
 args="'00000000-0000-0000-0000-000000000001','2026-11-09','2026-11-09',NULL"
 check(q(f"select string_agg(right(user_id::text,1)||':'||cash_fees||':'||tournament_fees||':'||total_fees,',' order by user_id) from fn_ca_club_pacific_member_fee_totals({args})"),'2:4.27:4.55:8.82,3:4.52:4.55:9.07','Pacific day selects timestamp edges; UTC share rounding and effective redemption instant conserved')
 check(q(f"select sum(total_fees)=17.89 from ca_club_member_chicago_fee_totals({args})"),'f','Chicago preimage fails independently derived Pacific total')
 check(q(f"select cash_fees||':'||tournament_fees from fn_ca_club_pacific_member_fee_totals('00000000-0000-0000-0000-000000000001','2026-11-09','2026-11-09','00000000-0000-0000-0000-000000000003')"),'4.52:4.55','recipient-only query includes both incoming share sources')
 check(q("select md5(pg_get_functiondef('public.ca_club_member_chicago_fee_totals(uuid,date,date,uuid)'::regprocedure))"),'5a1333750b1b61a32a2ec4a22b884699','existing Chicago helper remains byte-identical')
 check(q("select not has_function_privilege('authenticated','public.fn_ca_club_pacific_member_fee_totals(uuid,date,date,uuid)','EXECUTE') and not has_function_privilege('anon','public.fn_ca_club_pacific_member_fee_totals(uuid,date,date,uuid)','EXECUTE')"),'t','private adapter cannot bypass reader scope from browser roles')
 q('''TRUNCATE rake_attributions,ca_club_rake_daily_user;
 INSERT INTO rake_attributions SELECT gen_random_uuid(),'00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005',t::timestamptz,a,gen_random_uuid() FROM (VALUES ('2026-11-01T06:59:59Z',10),('2026-11-01T07:00:00Z',1),('2026-11-01T07:30:00Z',2),('2026-11-02T07:59:59Z',3),('2026-11-02T08:00:00Z',20))x(t,a);
 INSERT INTO rake_records SELECT rake_record_id,created_at FROM rake_attributions;
 INSERT INTO ca_club_rake_daily_user SELECT club_id,player_id,(created_at AT TIME ZONE 'UTC')::date,sum(round(rake_amount*100)) FROM rake_attributions GROUP BY 1,2,3;
 ''')
 check(q("select cash_fees from fn_ca_club_pacific_member_fee_totals('00000000-0000-0000-0000-000000000004','2026-11-01','2026-11-01',NULL)"),'6.00','fall-back Pacific day includes full 25 hours exactly once')
 print('PASS: Pacific fee adapter native PostgreSQL qualification')
finally:
 if started:run([PG/'pg_ctl','-D',cluster/'data','-m','fast','-w','stop'])
 shutil.rmtree(cluster,ignore_errors=True)
