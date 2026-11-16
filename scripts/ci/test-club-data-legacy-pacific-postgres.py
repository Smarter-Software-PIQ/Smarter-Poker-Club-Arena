#!/usr/bin/env python3
"""Native legacy Data Pacific projection, history, access and reader contract.
Private PostgreSQL only; captured production preimages pin transformation inputs.
"""
import os,shutil,socket,subprocess,tempfile,json,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
MIG=ROOT/'supabase/migrations/20261116163311_legacy_club_data_reads_pacific_calendar_days.sql'
FIX=ROOT/'tests/fixtures/club-data-pacific'
PG=Path(os.environ.get('PG_BIN') or next((p for p in('/usr/lib/postgresql/17/bin','/usr/lib/postgresql/16/bin','/opt/homebrew/opt/postgresql@17/bin') if (Path(p)/'initdb').exists()),'/usr/lib/postgresql/17/bin'))
ENV={**os.environ,'PATH':str(PG)+':/usr/bin:/bin','LANG':'C','LC_ALL':'C','PGTZ':'UTC'}
cluster=Path(tempfile.mkdtemp(prefix='legacy-pacific-',dir=os.environ.get('TMPDIR')))
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
started=False

def run(args,sql=None,fail=None):
 p=subprocess.run([str(x) for x in args],input=sql,text=True,capture_output=True,env=ENV,timeout=260)
 if fail:
  assert p.returncode and fail in p.stderr,(p.stdout,p.stderr,fail)
 elif p.returncode:raise RuntimeError(p.stdout[-1500:]+p.stderr[:1500]+p.stderr[-1200:])
 return p.stdout.strip()
def command(user='postgres'):return [PG/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',str(port),'-U',user,'-d','postgres']
def q(sql,fail=None):return run(command(),"SET test.uid='10000000-0000-0000-0000-000000000001';"+sql,fail)
def check(actual,expected,label):
 assert actual==expected,(label,actual,expected)
 print('PASS: '+label,flush=True)
def fn(path,name):
 s=(ROOT/path).read_text();a=s.index('CREATE OR REPLACE FUNCTION public.'+name+'(');b=s.index('$function$;',a)+len('$function$;');return s[a:b]
C='00000000-0000-0000-0000-000000000001';U='00000000-0000-0000-0000-000000000002';G='00000000-0000-0000-0000-000000000003'
def seed(day,rebuild=False):return q(f"BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT fn_ca_club_data_pacific_seed('{day}',{str(rebuild).lower()}); COMMIT;")
try:
 run([PG/'initdb','-D',cluster/'data','-U','postgres','--auth=trust','--no-locale','-E','UTF8'])
 with (cluster/'data/postgresql.conf').open('a') as f:f.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nunix_socket_directories=''\nfsync=off\ntimezone='UTC'\n")
 run([PG/'pg_ctl','-D',cluster/'data','-l',cluster/'server.log','-w','start']);started=True
 q('CREATE ROLE anon; CREATE ROLE authenticated LOGIN; CREATE ROLE service_role; CREATE ROLE supabase_admin; SET check_function_bodies=false;'+(ROOT/'tests/fixtures/club-data-fact-db/fixture.sql').read_text())
 q('''SET check_function_bodies=false;
 CREATE TABLE ca_club_data_fact(club_id uuid,stat_date date,kind text,game_id uuid,user_id uuid,fee numeric,buyins numeric,cashouts numeric,winnings numeric,last_at timestamptz,PRIMARY KEY(club_id,stat_date,game_id,user_id));
 CREATE TABLE ca_club_data_fact_ct(LIKE ca_club_data_fact INCLUDING ALL,src smallint DEFAULT 0);
 ALTER TABLE ca_club_data_fact_ct DROP CONSTRAINT ca_club_data_fact_ct_pkey;
 ALTER TABLE ca_club_data_fact_ct ADD PRIMARY KEY(club_id,stat_date,game_id,user_id,src);
 CREATE TABLE ca_club_data_game_ct(club_id uuid,stat_date date,kind text,game_id uuid,fee numeric,buyins numeric,cashouts numeric,winnings numeric,last_at timestamptz,src smallint DEFAULT 0,PRIMARY KEY(club_id,stat_date,game_id,src));
 CREATE TABLE ca_club_data_hands_ct(club_id uuid,stat_date date,table_id uuid,hands bigint,src smallint DEFAULT 0,PRIMARY KEY(club_id,stat_date,table_id,src));
 CREATE VIEW ca_stats_club_data_fact_ct AS SELECT * FROM ca_club_data_fact_ct;
 ALTER TABLE rake_attributions ADD COLUMN rake_amount numeric,ADD COLUMN created_at timestamptz;
 CREATE FUNCTION fn_ca_ledger_leg_club(uuid,numeric,text,timestamptz,uuid) RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
 ALTER TABLE tables ADD COLUMN rake_percent numeric;
 CREATE TABLE accounting_tournament_fee_sources(id uuid DEFAULT gen_random_uuid(),rake_record_id uuid,club_id uuid,player_id uuid,rake_credit numeric,charged_at timestamptz);
 CREATE TABLE unions(id uuid,name text);
 CREATE TABLE ca_horse_club_assignments(horse_id uuid,club_id uuid);
 CREATE FUNCTION fn_ca_club_data_downline(uuid,uuid) RETURNS uuid[] LANGUAGE sql AS $$SELECT ARRAY['00000000-0000-0000-0000-000000000002'::uuid]$$;
 CREATE FUNCTION ca_can_view_whole_club_report(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION fn_can_see_horse_flag(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 ALTER TABLE profiles ADD COLUMN avatar_url text,ADD COLUMN is_horse boolean DEFAULT false,ADD COLUMN status text;
 CREATE FUNCTION fn_ca_chicago_day(timestamptz) RETURNS date LANGUAGE sql AS $$SELECT ($1 AT TIME ZONE 'America/Chicago')::date$$;
 CREATE FUNCTION fn_ca_club_data_ct_live_from() RETURNS timestamptz LANGUAGE sql AS $$SELECT '2026-01-01'::timestamptz$$;
 CREATE FUNCTION fn_ca_club_data_facts_from() RETURNS date LANGUAGE sql AS $$SELECT '2026-09-16'::date$$;
 CREATE FUNCTION fn_ca_club_data_clubs(uuid) RETURNS uuid[] LANGUAGE sql AS $$SELECT ARRAY[$1]$$;
 CREATE FUNCTION fn_ca_launch_accounting_cutoff(text,uuid) RETURNS timestamptz LANGUAGE sql AS $$SELECT NULL::timestamptz$$;
 CREATE FUNCTION fn_ca_club_data_scope(uuid) RETURNS text LANGUAGE sql AS $$SELECT CASE WHEN auth.uid()='10000000-0000-0000-0000-000000000001'::uuid AND current_setting('test.denied',true) IS DISTINCT FROM 'true' THEN 'club' WHEN auth.uid()='10000000-0000-0000-0000-000000000003'::uuid THEN 'downline' END$$;
 CREATE FUNCTION fn_ca_club_data_union_basis(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION fn_ca_club_data_reads_union_basis(uuid,date,date) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 ALTER TABLE profiles ADD COLUMN alias text,ADD COLUMN display_name text,ADD COLUMN first_name text,ADD COLUMN last_name text,ADD COLUMN full_name text;
 CREATE FUNCTION fn_arena_name(text,text,text,text,text,text) RETURNS text LANGUAGE sql AS $$SELECT coalesce($1,$2,$3,$4,$5,$6)$$;
 ''')
 q("""CREATE SCHEMA smarter_private;
CREATE TABLE ca_club_rake_daily_user(club_id uuid,user_id uuid,day date,rake_cents bigint,hands bigint);
CREATE TABLE smarter_private.player_rake_share_rules(rule_key text,club_id uuid,from_user uuid,to_user uuid,share_bps int,effective_from timestamptz,effective_until timestamptz,tournament_effective_from date);
CREATE TABLE smarter_private.player_fee_redemptions(club_id uuid,user_id uuid,effective_on date,amount_cents bigint);
CREATE TABLE ca_club_member_tournament_fee_daily(club_id uuid,user_id uuid,day date,fees numeric);
CREATE FUNCTION fn_ca_fee_counting_start() RETURNS date LANGUAGE sql AS $$SELECT '2026-09-16'::date$$;
CREATE FUNCTION ca_club_member_fee_totals(uuid,date,date,uuid) RETURNS TABLE(user_id uuid,cash_fees numeric,tournament_fees numeric,total_fees numeric) LANGUAGE sql AS $$SELECT $4,0::numeric,0::numeric,0::numeric WHERE false$$;
""")
 ds=json.loads((FIX/'preimages.json').read_text());routers=json.loads((FIX/'routers.json').read_text())
 q('SET check_function_bodies=false;'+''.join(x['definition']+';\n' for x in ds+routers))
 q('SET check_function_bodies=false;'+fn(Path('supabase/migrations/20261106055718_all_earned_rake_includes_tournament_shares.sql'),'ca_club_member_chicago_fee_totals'))
 # Establish a pre-install snapshot before attaching the new producer.
 old=subprocess.Popen([str(x) for x in command()],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV)
 old.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT count(*) FROM clubs;\n\\echo SNAPSHOT\nSELECT pg_sleep(2); COMMIT;\n");old.stdin.close()
 while old.stdout.readline().strip()!='SNAPSHOT':
  if old.poll() is not None:raise AssertionError('pre-install snapshot fixture failed')
 q(MIG.read_text())
 q("BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT fn_ca_club_data_pacific_seed('2026-11-09');",'PACIFIC_DATA_SEED_PREATTACHMENT_TRANSACTION_STILL_OPEN')
 old.wait(timeout=5)
 print('PASS: finite history refuses an original pre-attachment producer snapshot',flush=True)
 check(q("SELECT fn_ca_club_data_pacific_day('2026-11-01T07:30Z'),extract(epoch FROM(fn_ca_club_data_pacific_day_start('2026-11-02')-fn_ca_club_data_pacific_day_start('2026-11-01')))/3600"),'2026-11-01|25.0000000000000000','Pacific fall-back day is 25h, not Chicago minus two hours')
 check(q("SELECT extract(epoch FROM(fn_ca_club_data_pacific_day_start('2026-03-09')-fn_ca_club_data_pacific_day_start('2026-03-08')))/3600"),'23.0000000000000000','Pacific spring-forward day is 23h')
 q(f"INSERT INTO clubs VALUES('{C}','Legacy',NULL); INSERT INTO profiles(id,username) VALUES('{U}','Player'); INSERT INTO tables(id,club_id,name,game_variant,big_blind) VALUES('{G}','{C}','Cash','nlh',2);")
 q(f"SELECT fn_ca_club_data_pacific_require('{C}','2026-11-09','2026-11-09');",'CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE')
 print('PASS: unseeded history refuses instead of returning true zero',flush=True)
 # These original raw inputs predate projection attachment. Original UTC facts
 # are independent controls; two events on one UTC day belong to different
 # Pacific calendar days. Aggregate last_at cannot determine their split.
 q(f"INSERT INTO wallet_transactions(user_id,amount,type,category,table_id,created_at) VALUES('{U}',10,'debit','buyin','{G}','2026-11-09T07:59:59Z'),('{U}',20,'credit','cashout','{G}','2026-11-09T08:00:00Z'); INSERT INTO ca_club_data_fact VALUES('{C}','2026-11-09','CASH','{G}','{U}',0,10,20,10,'2026-11-09T08:00:00Z');")
 check(json.loads(seed('2026-11-09'))['complete'],True,'timestamp source fully reconciles UTC controls')
 check(q(f"SELECT string_agg(stat_date||':'||winnings,',' ORDER BY stat_date) FROM ca_club_data_pacific_fact_ct WHERE club_id='{C}'"),'2026-11-08:-10,2026-11-09:20','full source day split exactly at Pacific midnight')
 check(json.loads(seed('2026-11-09'))['already_loaded'],True,'finite load does not replay an installed day')
 seed('2026-11-10')
 check(q(f"SELECT ca_club_data_player_totals('{C}','2026-11-09','2026-11-09')->'players'->0->>'total_winnings'"),'20','actual public player reader consumes Pacific projection')
 screen=json.loads(q(f"SELECT ca_club_data_screen('{C}','2026-11-09','2026-11-09')"))
 check((screen['summary']['games'],screen['summary']['total_winnings'],screen['day_basis']),(1,20,'America/Los_Angeles 00:00'),'actual public screen reads Pacific totals and states basis')
 check(json.loads(q(f"SELECT ca_club_game_page_core_20261006('{C}','2026-11-09','2026-11-09')"))['rows'][0]['winnings'],20,'actual advanced game page reads same Pacific total')
 check(json.loads(q(f"SELECT ca_club_player_page_core_20261006('{C}','2026-11-09','2026-11-09')"))['rows'][0]['net'],20,'actual player page uses recorded-club Pacific events')

 snapshot=json.loads(q(f"SELECT ca_club_data_snapshot_v2('{C}','2026-11-09','2026-11-09')"))
 check(snapshot['previous_coverage']['complete'],False,'optional missing previous source window is explicit')
 check(snapshot['delta']['winnings_abs'],None,'unproven comparison window never fabricates a delta')
 # Live backdated writes after an already seeded day stay included exactly
 # once; a repeat snapshot rebuild subtracts captured live rows, not last_at.
 q(f"INSERT INTO wallet_transactions(user_id,amount,type,category,table_id,created_at) VALUES('{U}',3,'credit','cashout','{G}','2026-11-09T08:30Z'); SELECT fn_ca_club_data_fact_put('{C}','2026-11-09','CASH','{G}','{U}',0,0,3,3,'2026-11-09T08:30Z');")
 seed('2026-11-09',True)
 check(q(f"SELECT sum(winnings) FROM ca_club_data_pacific_fact_ct WHERE club_id='{C}' AND stat_date='2026-11-09'"),'23','backdated live contribution and historical rebuild count once')
 # Timestamp adapters are independently exercised at both Pacific edges.
 # The maintained downline reader itself has separate native qualification;
 # this fixture verifies the new public snapshot passes exact instants and
 # pins UTC for its whole-day/edge reader contract, including non-UTC callers.
 q("""CREATE TABLE adapter_events(at timestamptz,amount numeric);
 INSERT INTO adapter_events VALUES('2026-11-09T07:59:59Z',1),('2026-11-09T08:00Z',2),('2026-11-10T07:59:59Z',7),('2026-11-10T08:00Z',11);
 CREATE FUNCTION fn_union_week_start(timestamptz) RETURNS timestamptz LANGUAGE sql AS $$SELECT date_trunc('week',$1)$$;
 CREATE FUNCTION fn_like_escape(text) RETURNS text LANGUAGE sql AS $$SELECT $1$$;
 CREATE TABLE agents(id uuid DEFAULT gen_random_uuid(),user_id uuid,commission_rate numeric,status text,club_id uuid,parent_agent_id uuid,role text);
 CREATE FUNCTION fn_ca_authorized_agent_data_clubs(uuid,uuid) RETURNS uuid[] LANGUAGE sql AS $$SELECT ARRAY[$2]$$;
 CREATE FUNCTION fn_agent_downline_rake(uuid,uuid,timestamptz,timestamptz,text,integer)
 RETURNS TABLE(player_id uuid,username text,role text,depth int,upline_user_id uuid,upline_name text,hands bigint,rake_generated numeric,last_hand_at timestamptz,downline_players bigint,downline_rake numeric)
 LANGUAGE sql STABLE AS $$SELECT $1,'Player'::text,'member'::text,1,NULL::uuid,NULL::text,count(*),sum(amount),max(at),0::bigint,0::numeric FROM adapter_events WHERE at>=$3 AND at<$4 AND current_setting('TimeZone')='UTC'$$;
 """)
 agent=json.loads(q(f"SET TimeZone='Asia/Tokyo'; SELECT ca_rake_snapshot_pacific_v2('agent','{C}',NULL,'2026-11-09','2026-11-09','{U}')"))
 check((agent['summary']['fee'],agent['previous']['fee'],agent['day_basis']),(9,1,'America/Los_Angeles 00:00'),'actual Pacific agent snapshot passes exact boundary instants under non-UTC caller')
 check(q("SELECT pg_get_functiondef('ca_rake_export_start_pacific_v2(text,uuid,date,date,uuid,text,text,uuid)'::regprocedure) LIKE '%''day_basis'', ''America/Los_Angeles 00:00'', ''generated_at''%'"),'t','frozen Rake export metadata includes report day basis before fingerprint')
 check(q("SELECT pg_get_functiondef('ca_rake_export_start_pacific_v2(text,uuid,date,date,uuid,text,text,uuid)'::regprocedure) LIKE '%ca-data-pacific:%'"),'t','Pacific export request identity cannot replay a Chicago question')
 # Actual by-agent production is GROSS CASH, distinct from personal earned
 # fees. Standing 50% share, redemption and tournament receipts are present;
 # they change the net fee adapter but never this production headline.
 B='00000000-0000-0000-0000-00000000000b';BG='00000000-0000-0000-0000-00000000000c';A='10000000-0000-0000-0000-000000000003'
 q("""
 CREATE TABLE smarter_private.agent_commission_report_days(club_id uuid,day date,complete boolean);
 CREATE TABLE smarter_private.agent_commission_report_frontiers(club_id uuid,first_complete_day date);
 CREATE TABLE smarter_private.agent_commission_report_daily(club_id uuid,user_id uuid,day date,amount numeric);
 CREATE TABLE agent_commissions(club_id uuid,user_id uuid,amount numeric,created_at timestamptz,settled_at timestamptz);
 CREATE TABLE agent_commission_settlements(club_id uuid,user_id uuid,period_start timestamptz,period_end timestamptz);
 CREATE TABLE club_rake_rollup_complete(club_id uuid,day date);
 CREATE TABLE club_rake_daily_user(club_id uuid,user_id uuid,day date,rake_amount numeric,hands bigint);
 CREATE FUNCTION fn_ca_launch_accounting_start(text,uuid,timestamptz) RETURNS timestamptz LANGUAGE sql AS $$SELECT $3$$;
 CREATE FUNCTION fn_is_club_admin_uid(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION fn_is_union_overseer(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION fn_is_agent_ancestor(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION fn_agent_commission_paid_by_period(uuid,uuid,timestamptz) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 """)
 q(f"INSERT INTO clubs VALUES('{B}','Gross club',NULL); INSERT INTO tables(id,club_id,name,game_variant,big_blind) VALUES('{BG}','{B}','Gross cash','nlh',2); INSERT INTO agents(user_id,commission_rate,status,club_id,role) VALUES('{A}',0.1,'active','{B}','agent'); INSERT INTO club_members(club_id,user_id,role,agent_id) VALUES('{B}','{U}','member','{A}'); INSERT INTO rake_records(table_id,rake_amount,created_at,player_contributions) SELECT '{BG}',a,t::timestamptz,'{{\"{U}\":1}}' FROM(VALUES('2026-11-09T07:59:59Z',1.01),('2026-11-09T08:00Z',2.01),('2026-11-10T07:59:59Z',3.01),('2026-11-10T08:00Z',5.01),('2026-11-11T07:59:59Z',7.01),('2026-11-11T08:00Z',11.01))z(t,a); INSERT INTO rake_attributions(rake_record_id,player_id,club_id,rake_amount,created_at) SELECT id,'{U}','{B}',rake_amount,created_at FROM rake_records WHERE table_id='{BG}'; INSERT INTO ca_club_rake_daily_user SELECT club_id,player_id,(created_at AT TIME ZONE 'UTC')::date,sum(round(rake_amount*100)),count(*) FROM rake_attributions WHERE club_id='{B}' GROUP BY 1,2,3; INSERT INTO club_rake_rollup_complete VALUES('{B}','2026-11-10'); INSERT INTO club_rake_daily_user SELECT club_id,user_id,day,rake_cents::numeric/100,hands FROM ca_club_rake_daily_user WHERE club_id='{B}' AND day='2026-11-10'; INSERT INTO ca_club_data_fact SELECT '{B}',(created_at AT TIME ZONE 'UTC')::date,'CASH','{BG}','{U}',sum(rake_amount),0,0,0,max(created_at) FROM rake_records WHERE table_id='{BG}' GROUP BY (created_at AT TIME ZONE 'UTC')::date; INSERT INTO club_table_daily(club_id,table_id,stat_date,hands) SELECT '{B}','{BG}',(created_at AT TIME ZONE 'UTC')::date,count(*) FROM rake_records WHERE table_id='{BG}' GROUP BY (created_at AT TIME ZONE 'UTC')::date; INSERT INTO smarter_private.player_rake_share_rules VALUES('half','{B}','{U}','{A}',5000,'2026-09-16',NULL,NULL); INSERT INTO smarter_private.player_fee_redemptions VALUES('{B}','{U}','2026-11-10',25); INSERT INTO accounting_tournament_fee_sources(club_id,player_id,rake_credit,charged_at) VALUES('{B}','{U}',20,'2026-11-09T12:00Z'); INSERT INTO ca_club_member_tournament_fee_daily VALUES('{B}','{U}','2026-11-09',20);")
 check(q(f"SELECT total_fees FROM fn_ca_club_pacific_member_fee_totals('{B}','2026-11-09','2026-11-09','{U}')"),'22.25','personal net fee adapter includes 50% share, redemption and tournament credit')
 production=json.loads(q(f"SET TimeZone='Asia/Tokyo'; SELECT fn_ca_rake_by_agent_pacific('{B}','2026-11-09','2026-11-09',50)"))
 check((production['total_direct'],production['rows'][0]['direct_hands']),(5.02,2),'actual by-agent Pacific report keeps gross cash despite personal fee adjustments')
 check(q(f"SELECT rake||':'||hands FROM fn_ca_club_data_pacific_cash_gross('{B}','2026-11-09T08:00Z','2026-11-11T08:00Z')"),'17.0400000000000000:4','sealed UTC core plus both Pacific timestamp edges count gross cash once')
 seed('2026-11-09',True);seed('2026-11-10',True)
 personal=json.loads(q(f"SELECT ca_club_player_page_core_20261006('{B}','2026-11-09','2026-11-09')"))
 check(next(r['rake'] for r in personal['rows'] if r['user_id']==U),22.25,'actual player report preserves personal net earned-fee definition')
 # An existing report-only UTC/Chicago failure must not suppress the new
 # capture or block its source transaction. The captured flag tells history
 # exactly which live deltas were absent from the original UTC controls.
 original=next(x['definition'] for x in ds if x['proname']=='fn_ca_club_data_fact_put')
 preserved=original.replace('FUNCTION public.fn_ca_club_data_fact_put(','FUNCTION public.fn_ca_club_data_fact_put_pre_pacific(')
 broken=preserved.split('AS $function$')[0].replace('LANGUAGE sql','LANGUAGE plpgsql')+"AS $function$BEGIN RAISE EXCEPTION 'fixture old report unavailable'; END;$function$;"
 q(broken)
 q(f"INSERT INTO wallet_transactions(user_id,amount,type,category,table_id,created_at) VALUES('{U}',7,'credit','cashout','{G}','2026-11-13T08:00Z'); SELECT fn_ca_club_data_fact_put('{C}','2026-11-13','CASH','{G}','{U}',0,0,7,7,'2026-11-13T08:00Z');")
 check(q(f"SELECT cashouts||':'||legacy_recorded FROM ca_club_data_pacific_fact WHERE club_id='{C}' AND utc_day='2026-11-13'"),'7:false','original report failure retains independently captured Pacific source delta')
 q(preserved)
 check(json.loads(seed('2026-11-13'))['complete'],True,'original source rebuild accounts for absent UTC write without double subtraction')
 check(q(f"SELECT sum(winnings) FROM ca_club_data_pacific_fact_ct WHERE club_id='{C}' AND stat_date='2026-11-13'"),'7','captured source delta survives historical rebuild exactly once')
 # A shared rake record is one game and one club hand, with two participant
 # hands. Fee shares use original contributions; horse identity is irrelevant.
 V='00000000-0000-0000-0000-000000000004'
 q(f"INSERT INTO rake_records(table_id,rake_amount,created_at,player_contributions) VALUES('{G}',4,'2026-11-11T08:00Z','{{\"{U}\":1,\"{V}\":1}}'); INSERT INTO ca_club_data_fact VALUES('{C}','2026-11-11','CASH','{G}','{U}',2,0,0,0,'2026-11-11T08:00Z'),('{C}','2026-11-11','CASH','{G}','{V}',2,0,0,0,'2026-11-11T08:00Z'); INSERT INTO club_table_daily(club_id,table_id,stat_date,hands) VALUES('{C}','{G}','2026-11-11',1);")
 check(json.loads(seed('2026-11-11'))['complete'],True,'original contribution fees and hand controls reconcile')
 check(q(f"SELECT sum(fee)||':'||sum(hands)||':'||count(DISTINCT game_id) FROM ca_club_data_pacific_fact_ct WHERE club_id='{C}' AND stat_date='2026-11-11'"),'4.0000000000000000:2:1','shared cash game counts fee shares and participant hands exactly')
 check(q(f"SELECT sum(hands) FROM ca_club_data_pacific_hands_ct WHERE club_id='{C}' AND stat_date='2026-11-11'"),'1','club hand count is distinct original rake source')
 # Production-shaped unnamed tournament recognition: no rake attribution
 # rows, three directly linked immutable entry-fee receipts. Charged dates are
 # deliberately earlier; the legacy report recognizes all at rr.created_at.
 T='00000000-0000-0000-0000-000000000005';R='00000000-0000-0000-0000-000000000006';W='00000000-0000-0000-0000-000000000007'
 q(f"INSERT INTO tournaments(id,club_id,name,tournament_type,status) VALUES('{T}','{C}','Receipt tournament','MTT','COMPLETED'); INSERT INTO rake_records(id,tournament_id,is_tournament,rake_amount,created_at) VALUES('{R}','{T}',true,0.24,'2026-11-14T08:00Z'); INSERT INTO accounting_tournament_fee_sources(rake_record_id,club_id,player_id,rake_credit,charged_at) SELECT '{R}','{C}',u::uuid,0.08,'2026-11-13T07:00Z' FROM (VALUES('{U}'),('{V}'),('{W}'))z(u); INSERT INTO ca_club_data_fact SELECT '{C}','2026-11-14','TOURNAMENT','{T}',u::uuid,0.08,0,0,0,'2026-11-14T08:00Z' FROM(VALUES('{U}'),('{V}'),('{W}'))z(u);")
 check(json.loads(seed('2026-11-14'))['complete'],True,'no-RA tournament uses three immutable direct fee receipts')
 check(q(f"SELECT sum(fee)||':'||count(DISTINCT user_id)||':'||min(stat_date) FROM ca_club_data_pacific_fact_ct WHERE game_id='{T}'"),'0.24:3:2026-11-14','receipt fee shares retain original recognition instant and owners')
 # An unrelated source without accepted legacy controls fails only its own
 # source-game club, never every standalone club in the same UTC day.
 OTHER='00000000-0000-0000-0000-000000000008';OT='00000000-0000-0000-0000-000000000009'
 q(f"INSERT INTO tournaments(id,club_id,name,tournament_type,status) VALUES('{OT}','{OTHER}','Unproven other club','MTT','COMPLETED'); INSERT INTO rake_records(tournament_id,is_tournament,rake_amount,created_at) VALUES('{OT}',true,2,'2026-11-14T09:00Z');")
 check(json.loads(seed('2026-11-14',True))['complete'],False,'unsupported unrelated source remains visible in finite receipt')
 check(q(f"SELECT count(*) FROM ca_club_data_pacific_failures WHERE utc_day='2026-11-14' AND (club_id='{C}' OR club_id IS NULL)"),'0','unrelated unowned fee never globally refuses proven standalone clubs')
 check(q(f"SELECT sum(fee) FROM ca_club_data_pacific_fact_ct WHERE game_id='{T}'"),'0.24','proven club projection remains available alongside scoped failed source')
 seed('2026-11-15')
 check(json.loads(q(f"SELECT ca_club_data_screen('{C}','2026-11-14','2026-11-14')"))['summary']['fee'],0.24,'actual proven-club reader remains usable beside unrelated failed source')
 # Equal/opposite per-record defects must not disappear inside a UTC sum.
 # The reconstructed per-player UTC totals match controls, yet neither
 # recognition record has a complete receipt witness.
 R2='00000000-0000-0000-0000-00000000000a'
 q(f"UPDATE accounting_tournament_fee_sources SET rake_credit=0.09 WHERE rake_record_id='{R}' AND player_id='{U}'; INSERT INTO rake_records(id,tournament_id,is_tournament,rake_amount,created_at) VALUES('{R2}','{T}',true,0.24,'2026-11-14T08:01Z'); INSERT INTO accounting_tournament_fee_sources(rake_record_id,club_id,player_id,rake_credit,charged_at) SELECT '{R2}','{C}',u::uuid,CASE WHEN u='{U}' THEN 0.07 ELSE 0.08 END,'2026-11-13T07:00Z' FROM (VALUES('{U}'),('{V}'),('{W}'))z(u); UPDATE ca_club_data_fact SET fee=0.16 WHERE game_id='{T}';")
 check(json.loads(seed('2026-11-14',True))['complete'],False,'offsetting incomplete per-record receipts cannot qualify by matching UTC totals')
 q(f"SELECT ca_club_data_screen('{C}','2026-11-14','2026-11-14');",'CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE')
 # Hold only the report aggregate's owner lock in a second transaction.
 # The settling writer must append its own journal rather than wait for it.
 key=f"f:{C}:2026-11-12:2026-11-12:{G}:{U}:true"
 holder=subprocess.Popen([str(x) for x in command()],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV)
 holder.stdin.write(f"BEGIN; SELECT fn_ca_club_data_pacific_own('{key}');\n\\echo OWNED\nSELECT pg_sleep(2); COMMIT;\n");holder.stdin.close()
 while holder.stdout.readline().strip()!='OWNED':
  if holder.poll() is not None:raise AssertionError('report lock fixture failed')
 t=time.monotonic();q(f"SET lock_timeout='500ms'; SELECT fn_ca_club_data_fact_put('{C}','2026-11-12','CASH','{G}','{U}',1,0,0,0,'2026-11-12T08:00Z');")
 assert time.monotonic()-t<1,'live report writer waited for contested aggregate'
 holder.wait(timeout=5)
 check(q(f"SELECT sum(fee) FROM ca_club_data_pacific_journal WHERE club_id='{C}' AND utc_day='2026-11-12'"),'1','contended report capture is append-only and nonblocking')
 q(f"UPDATE ca_club_data_fact SET winnings=winnings+1 WHERE club_id='{C}' AND stat_date='2026-11-09';")
 check(json.loads(seed('2026-11-09',True))['complete'],False,'missing source/control mismatch remains explicit incomplete')
 q(f"SELECT ca_club_data_player_totals('{C}','2026-11-09','2026-11-09');",'CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE')
 print('PASS: actual public reader refuses a failed rebuild',flush=True)
 run(command('authenticated'),f"SELECT ca_club_data_screen('{C}','2026-11-09','2026-11-09');",'not authorized')
 run(command('authenticated'),f"SELECT fn_ca_club_data_pacific_seed('2026-11-09');",'permission denied')
 print('PASS: actual browser role refuses unauthorized screen and private loader',flush=True)
 q(f"SET test.denied='true'; SELECT fn_ca_club_data_pacific_require('{C}','2026-11-09','2026-11-09');",'not authorized')
 check(q("SELECT bool_and(NOT has_function_privilege('authenticated',p.oid,'EXECUTE')) FROM pg_proc p WHERE pronamespace='public'::regnamespace AND proname LIKE 'fn_ca_club_data_pacific_%'"),'t','browser cannot call projection/seed/private coverage bypass')
 for x in ds:
  if x['proname'].endswith('_chicago_basis'):
   name=x['proname'].replace('_chicago_basis','_pacific_basis_core')
   check(q(f"SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='{name}'"),'1',name+' installed from qualified original')
 # Qualify the permanent canonical cash ownership follow-up against the exact
 # installed report and original statement-hook preimages.
 q("SET check_function_bodies=false; CREATE TABLE accounting_cash_rake_sources(id uuid PRIMARY KEY,rake_record_id uuid,player_id uuid,club_id uuid,UNIQUE(rake_record_id,player_id)); CREATE TABLE accounting_cash_funding_contract_admissions(source_id uuid PRIMARY KEY,funding_club_id uuid); ALTER TABLE rake_attributions ADD COLUMN id uuid DEFAULT gen_random_uuid();")
 originals=json.loads((FIX/'cash-source-preimages.json').read_text())
 q('SET check_function_bodies=false;'+''.join(x['definition']+';\n' for x in originals if x['proname'].startswith('trg_')))
 # Frozen source and admission already exist before this attachment; delayed
 # auxiliary attribution must never replay an already source-seeded transition.
 PB='00000000-0000-0000-0000-0000000000b1';BR='00000000-0000-0000-0000-0000000000b2';BS='00000000-0000-0000-0000-0000000000b3'
 q(f"INSERT INTO tables(id,club_id,name,game_variant,big_blind) VALUES('{PB}','{C}','Already funded history','nlh',2); INSERT INTO rake_records(id,table_id,rake_amount,created_at,player_contributions) VALUES('{BR}','{PB}',0.25,'2026-11-16T12:00Z','{{\"{U}\":1}}'); INSERT INTO accounting_cash_rake_sources VALUES('{BS}','{BR}','{U}','{C}'); INSERT INTO accounting_cash_funding_contract_admissions VALUES('{BS}','{B}'); INSERT INTO ca_club_data_fact VALUES('{C}','2026-11-16','CASH','{PB}','{U}',0.25,0,0,0,'2026-11-16T12:00Z');")
 q((ROOT/'supabase/migrations/20261116181617_pacific_data_cash_follows_original_funded_source_ownership.sql').read_text())
 print('PASS: canonical cash follow-up installs on exact qualified preimages',flush=True)
 q(f"SELECT fn_ca_club_data_pacific_require('{B}','2026-11-10','2026-11-10');",'CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE')
 receipt=json.loads(seed('2026-11-10'))
 check((receipt.get('already_loaded',False),q("SELECT basis_version FROM ca_club_data_pacific_seed_log WHERE utc_day='2026-11-10'")),(False,'1'),'old basis0 receipt is rebuilt and cannot return already_loaded')
 # New ownership fixtures use a separate immutable game and never current
 # membership. Wrong UNIQUE UTC ownership must not win over original RA.
 K='00000000-0000-0000-0000-000000000081';F='00000000-0000-0000-0000-000000000082';NG='00000000-0000-0000-0000-000000000083';NR='00000000-0000-0000-0000-000000000084';NS='00000000-0000-0000-0000-000000000085'
 q(f"INSERT INTO clubs VALUES('{K}','Wrong parent fallback',NULL),('{F}','Original funded club',NULL); INSERT INTO tables(id,club_id,name,game_variant,big_blind) VALUES('{NG}','{K}','Funded child parent','nlh',2); INSERT INTO rake_records(id,table_id,rake_amount,created_at,player_contributions) VALUES('{NR}','{NG}',0.5,'2026-11-16T09:00Z','{{\"{U}\":1,\"{V}\":2}}'); INSERT INTO rake_attributions(rake_record_id,player_id,club_id,rake_amount,created_at) SELECT '{NR}',u::uuid,'{F}',0.17,'2026-11-16T09:00Z' FROM(VALUES('{U}'),('{V}'))x(u); INSERT INTO ca_club_data_fact VALUES('{K}','2026-11-16','CASH','{NG}','{U}',0.5/3,0,0,0,'2026-11-16T09:00Z'),('{K}','2026-11-16','CASH','{NG}','{V}',0.5*2/3,0,0,0,'2026-11-16T09:00Z');")
 q(f"INSERT INTO ca_club_data_pacific_fact VALUES('{K}','2026-11-16','2026-11-16','CASH','{NG}','{U}',0.5/3,0,0,0,'2026-11-16T09:00Z',0,true,1),('{K}','2026-11-16','2026-11-16','CASH','{NG}','{V}',0.5*2/3,0,0,0,'2026-11-16T09:00Z',0,true,1); INSERT INTO club_table_daily(club_id,table_id,stat_date,hands) VALUES('{K}','{NG}','2026-11-16',3);")
 check(json.loads(seed('2026-11-16',True))['complete'],True,'canonical immutable cash owner qualifies despite wrong UNIQUE UTC club')
 check(q(f"SELECT count(DISTINCT game_id) FROM ca_club_data_pacific_fact_ct WHERE club_id='{K}' AND stat_date='2026-11-16'"),'0','wrong original club has no phantom game after rebuild')
 check(q(f"SELECT sum(fee)||':'||sum(hands)||':'||count(DISTINCT game_id) FROM ca_club_data_pacific_fact_ct WHERE club_id='{F}' AND stat_date='2026-11-16'"),'0.50000000000000000000:2:1','canonical owner keeps raw fractional fees and participant hands')
 check(json.loads(q(f"SELECT ca_club_data_screen('{K}','2026-11-16','2026-11-16')"))['summary']['games'],0,'actual screen omits wrong-club game after signed source correction')
 check(q("SELECT basis_version FROM ca_club_data_pacific_seed_log WHERE utc_day='2026-11-16'"),'1','new source-qualified history receipt records basis version1')
 check(json.loads(seed('2026-11-16'))['already_loaded'],True,'same source basis receipt remains idempotent')
 # Fresh callbacks own the new projection; repeated observers are idempotent.
 q(f"SELECT fn_ca_club_data_pacific_cash_observe('[{{\"rake_record_id\":\"{NR}\",\"user_id\":\"{U}\"}},{{\"rake_record_id\":\"{NR}\",\"user_id\":\"{V}\"}}]');")

 q(f"INSERT INTO accounting_cash_rake_sources VALUES('{NS}','{NR}','{U}','{F}'); INSERT INTO accounting_cash_funding_contract_admissions VALUES('{NS}','{K}'); SELECT fn_ca_club_data_pacific_cash_observe('[{{\"rake_record_id\":\"{NR}\",\"user_id\":\"{U}\",\"event\":\"funding_admission\"}}]');")
 check(q(f"SELECT club_id||':'||stage FROM ca_club_data_pacific_cash_current WHERE rake_record_id='{NR}' AND user_id='{U}'"),K+':3','original funded admission dominates frozen source and RA')

 # A pre-attachment record was already source-rebuilt under its original
 # owner. A later authorized admission moves the original event atomically.
 LG='00000000-0000-0000-0000-0000000000a1';PR='00000000-0000-0000-0000-0000000000a2';PS='00000000-0000-0000-0000-0000000000a3'
 q(f"INSERT INTO tables(id,club_id,name,game_variant,big_blind) VALUES('{LG}','{F}','Late funded receipt','nlh',2); INSERT INTO rake_records(id,table_id,rake_amount,created_at,player_contributions) VALUES('{PR}','{LG}',1,'2026-11-16T11:00Z','{{\"{U}\":1}}'); INSERT INTO rake_attributions(rake_record_id,player_id,club_id,rake_amount,created_at) VALUES('{PR}','{U}','{F}',1,'2026-11-16T11:00Z'); INSERT INTO ca_club_data_fact VALUES('{F}','2026-11-16','CASH','{LG}','{U}',1,0,0,0,'2026-11-16T11:00Z');")
 seed('2026-11-16',True)
 # Existing statement-hook wiring, not a direct helper-only simulation.
 q("CREATE TRIGGER native_cash_ra AFTER INSERT ON rake_attributions REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_ca_club_rake_daily_user_insert(); CREATE TRIGGER native_cash_source AFTER INSERT ON accounting_cash_rake_sources REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_ca_club_acct_cash_fee(); CREATE TRIGGER native_cash_admission AFTER INSERT ON accounting_cash_funding_contract_admissions REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_ca_club_acct_admission(); CREATE TRIGGER native_cash_rake AFTER INSERT ON rake_records FOR EACH ROW EXECUTE FUNCTION trg_ca_club_data_fact_rake();")
 LR='00000000-0000-0000-0000-000000000091';LS='00000000-0000-0000-0000-000000000092'
 q(f"INSERT INTO rake_records(id,table_id,rake_amount,created_at,player_contributions) VALUES('{LR}','{NG}',0.5,'2026-11-16T10:00Z','{{\"{U}\":1}}');")
 check(q(f"SELECT count(*) FROM ca_club_data_pacific_cash_records WHERE rake_record_id='{LR}'"),'1','actual original rake trigger registers canonical pending source')
 q(f"SELECT fn_ca_club_data_pacific_require('{K}','2026-11-16','2026-11-16');",'CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE')
 q(f"INSERT INTO rake_attributions(rake_record_id,player_id,club_id,rake_amount,created_at) VALUES('{LR}','{U}','{F}',0.5,'2026-11-16T10:00Z');")
 check(q(f"SELECT club_id||':'||fee FROM ca_club_data_pacific_cash_current WHERE rake_record_id='{LR}'"),F+':0.50000000000000000000','actual RA statement hook supplies original owner after legacy callback')
 q(f"INSERT INTO accounting_cash_rake_sources VALUES('{LS}','{LR}','{U}','{F}'); INSERT INTO accounting_cash_funding_contract_admissions VALUES('{LS}','{K}');")
 check(q(f"SELECT club_id||':'||stage FROM ca_club_data_pacific_cash_current WHERE rake_record_id='{LR}'"),K+':3','actual admission hook atomically supersedes original source owner')
 check(q(f"SELECT count(*) FROM ca_club_data_pacific_cash_current WHERE rake_record_id='{LR}' AND club_id='{F}'"),'0','late original admission immediately suppresses former club presence')
 q(f"INSERT INTO accounting_cash_rake_sources VALUES('{PS}','{PR}','{U}','{F}'); INSERT INTO accounting_cash_funding_contract_admissions VALUES('{PS}','{K}');")
 check(q(f"SELECT count(DISTINCT game_id) FROM ca_club_data_pacific_fact_ct WHERE club_id='{F}' AND game_id='{LG}'"),'0','late admission removes historical former-owner phantom game atomically')
 check(q(f"SELECT sum(fee)||':'||count(DISTINCT game_id) FROM ca_club_data_pacific_fact_ct WHERE club_id='{K}' AND game_id='{LG}'"),'1.00000000000000000000:1','late admission adds exact historical source to funded club once')
 q(f"INSERT INTO rake_attributions(rake_record_id,player_id,club_id,rake_amount,created_at) VALUES('{BR}','{U}','{C}',0.25,'2026-11-16T12:00Z'); SELECT fn_ca_club_data_pacific_cash_observe('[{{\"rake_record_id\":\"{BR}\",\"user_id\":\"{U}\"}}]');")
 check(q(f"SELECT sum(fee)||':'||sum(hands)||':'||count(DISTINCT game_id) FROM ca_club_data_pacific_fact_ct WHERE club_id='{B}' AND game_id='{PB}'"),'0.25000000000000000000:1:1','delayed RA and generic replay cannot double-apply an already funded seed')
 check(q(f"SELECT count(DISTINCT game_id) FROM ca_club_data_pacific_fact_ct WHERE club_id='{C}' AND game_id='{PB}'"),'0','delayed attribution leaves former owner game absent')
 # A report observer never contends on an idempotency receipt. The same
 # original key can be observed in concurrent transactions without waiting.
 holder=subprocess.Popen([str(x) for x in command()],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV)
 payload=json.dumps([{'rake_record_id':LR,'user_id':U}])
 holder.stdin.write(f"BEGIN; SELECT fn_ca_club_data_pacific_cash_observe('{payload}');\n\\echo OBSERVED\nSELECT pg_sleep(2); COMMIT;\n");holder.stdin.close()
 while holder.stdout.readline().strip()!='OBSERVED':
  if holder.poll() is not None:raise AssertionError('cash source concurrency fixture failed')
 t=time.monotonic();q(f"SET lock_timeout='100ms'; SELECT fn_ca_club_data_pacific_cash_observe('{payload}');")
 assert time.monotonic()-t<1,'canonical cash observer waited for same source receipt'
 holder.wait(timeout=5)
 check(q(f"SELECT count(*) FROM ca_club_data_pacific_cash_current WHERE rake_record_id='{LR}'"),'1','concurrent duplicate source callbacks stay nonblocking and idempotent')
 # A finite qualified source rebuild can retire an observer's transient
 # error. An unrelated missing-owner source remains refused in that snapshot.
 UC='00000000-0000-0000-0000-0000000000c1';UG='00000000-0000-0000-0000-0000000000c2';UR='00000000-0000-0000-0000-0000000000c3'
 q(f"INSERT INTO clubs VALUES('{UC}','Unresolved source',NULL); INSERT INTO tables(id,club_id,name,game_variant,big_blind) VALUES('{UG}','{UC}','Missing canonical owner','nlh',2); INSERT INTO rake_records(id,table_id,rake_amount,created_at,player_contributions) VALUES('{UR}','{UG}',1,'2026-11-16T13:00Z','{{\"{V}\":1}}'); INSERT INTO ca_club_data_fact VALUES('{UC}','2026-11-16','CASH','{UG}','{V}',1,0,0,0,'2026-11-16T13:00Z'); INSERT INTO ca_club_data_pacific_failures(club_id,utc_day,source,detail) VALUES('{F}','2026-11-16','live_cash_source','resolved original observer failure'),('{UC}','2026-11-16','live_cash_source','missing original owner remains unresolved');")
 check(json.loads(seed('2026-11-16',True))['complete'],False,'unresolved original source remains explicit during scoped recovery')
 check(q(f"SELECT count(*) FROM ca_club_data_pacific_failures WHERE club_id='{F}' AND utc_day='2026-11-16' AND source='live_cash_source'"),'0','qualified source rebuild retires same-snapshot resolved cash observer failure')
 check(q(f"SELECT count(*) FROM ca_club_data_pacific_failures WHERE club_id='{UC}' AND utc_day='2026-11-16' AND source='live_cash_source'"),'1','rebuild preserves unrelated unresolved cash source failure')
 q(f"SELECT fn_ca_club_data_pacific_require('{UC}','2026-11-16','2026-11-16');",'CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE')
 # An error committed after the rebuild's established snapshot is outside
 # its source qualification and must survive that transaction's cleanup.
 snapshot=subprocess.Popen([str(x) for x in command()],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV)
 snapshot.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT count(*) FROM clubs;\n\\echo SNAPSHOT_READY\n");snapshot.stdin.flush()
 while snapshot.stdout.readline().strip()!='SNAPSHOT_READY':
  if snapshot.poll() is not None:raise AssertionError('source recovery snapshot fixture failed')
 q(f"INSERT INTO ca_club_data_pacific_failures(club_id,utc_day,source,detail) VALUES('{B}','2026-11-16','live_cash_source','committed after original source snapshot');")
 snapshot.stdin.write("SELECT fn_ca_club_data_pacific_seed('2026-11-16',true); COMMIT;\n");snapshot.stdin.close();snapshot.wait(timeout=5)
 assert snapshot.returncode==0,snapshot.stderr.read()
 check(q(f"SELECT count(*) FROM ca_club_data_pacific_failures WHERE club_id='{B}' AND utc_day='2026-11-16' AND source='live_cash_source'"),'1','rebuild cannot retire a cash error committed after its source snapshot')
 # Historical ambiguity has no new registration. Every immutable candidate
 # must remain refused, even when the old aggregate named only a third club.
 AR='00000000-0000-0000-0000-0000000000c4'
 q(f"ALTER TABLE rake_records DISABLE TRIGGER native_cash_rake; INSERT INTO rake_records(id,table_id,rake_amount,created_at,player_contributions) VALUES('{AR}','{UG}',2,'2026-11-16T14:00Z','{{\"{U}\":1}}'); ALTER TABLE rake_records ENABLE TRIGGER native_cash_rake; INSERT INTO rake_attributions(rake_record_id,player_id,club_id,rake_amount,created_at) SELECT '{AR}','{U}',c::uuid,1,'2026-11-16T14:00Z' FROM(VALUES('{F}'),('{K}'))x(c); INSERT INTO ca_club_data_fact VALUES('{UC}','2026-11-16','CASH','{UG}','{U}',2,0,0,0,'2026-11-16T14:00Z'); INSERT INTO ca_club_data_pacific_failures(club_id,utc_day,source,detail) VALUES('{F}','2026-11-16','live_cash_source','ambiguous historical owner'),('{K}','2026-11-16','live_cash_source','ambiguous historical owner');")
 seed('2026-11-16',True)
 check(q(f"SELECT count(DISTINCT club_id) FROM ca_club_data_pacific_failures WHERE utc_day='2026-11-16' AND club_id IN('{F}','{K}') AND source='live_cash_source'"),'2','ambiguous historical original owners both retain observer failures')
 check(q(f"SELECT count(DISTINCT club_id) FROM ca_club_data_pacific_failures WHERE utc_day='2026-11-16' AND club_id IN('{F}','{K}') AND source='history'"),'2','history failure scope includes every immutable cash owner candidate')
 q(f"SELECT fn_ca_club_data_pacific_require('{B}','2026-11-16','2026-11-16');")
 # Conflicting same-authority receipts cannot be guessed into true totals;
 # pending visibility is scoped, so an unrelated qualified club stays usable.
 q(f"INSERT INTO ca_club_data_pacific_cash_observations SELECT rake_record_id,user_id,utc_day,stat_date,game_id,source_at,stage,'{F}',old_club_id,fee,legacy_recorded,full_source FROM ca_club_data_pacific_cash_current WHERE rake_record_id='{LR}';")
 q(f"SELECT fn_ca_club_data_pacific_require('{K}','2026-11-16','2026-11-16');",'CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE')
 q(f"SELECT fn_ca_club_data_pacific_require('{B}','2026-11-16','2026-11-16');")
 print('PASS: source conflict refuses affected window without global club outage',flush=True)
 q(f"INSERT INTO ca_club_data_pacific_fact VALUES('{K}','2026-11-16','2026-11-16','TOURNAMENT','{T}','{U}',0,0,0,0,'2026-11-16T09:00Z',0,true,0);")
 check(q(f"SELECT count(DISTINCT game_id) FROM ca_club_data_pacific_fact_ct WHERE club_id='{K}' AND kind='TOURNAMENT' AND game_id='{T}'"),'1','legitimate zero-fee tournament source retains game presence')
 check(q("SELECT bool_and(NOT has_table_privilege('authenticated',c.oid,'SELECT')) FROM pg_class c WHERE relname IN('ca_club_data_pacific_cash_records','ca_club_data_pacific_cash_observations')"),'t','canonical source receipts remain private to report owner')
 plan=q(f"SET enable_seqscan=off; EXPLAIN SELECT * FROM ca_club_data_pacific_cash_current WHERE club_id='{K}' AND stat_date BETWEEN '2026-11-09' AND '2026-11-15';")
 assert 'ca_club_data_pacific_cash_observations_read_idx' in plan and 'ca_club_data_pacific_cash_observations_source_idx' in plan,plan
 print('PASS: one-club week uses scoped day and source-dominance indexes',flush=True)
 print('PASS: legacy Pacific native PostgreSQL qualification')
finally:
 if started:run([PG/'pg_ctl','-D',cluster/'data','-m','fast','-w','stop'])
 shutil.rmtree(cluster,ignore_errors=True)
