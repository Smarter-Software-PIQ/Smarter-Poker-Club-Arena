"""Execute the production admission/rebuy/phase functions in isolated PostgreSQL."""
import json, os, pathlib, shutil, subprocess, tempfile
ROOT=pathlib.Path(__file__).resolve().parents[2]
PG=pathlib.Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
cluster=pathlib.Path(tempfile.mkdtemp(prefix='addon-reg-',dir=os.environ.get('TMPDIR')))
sock=pathlib.Path(tempfile.mkdtemp(prefix='ar-',dir=os.environ.get('CA_PG_SOCKET_ROOT',os.environ.get('TMPDIR'))))
env={**os.environ,'LC_ALL':'C','LANG':'C'}
def cmd(args,sql=None,ok=True):
 r=subprocess.run(list(map(str,args)),input=sql,text=True,capture_output=True,env=env)
 if ok and r.returncode: raise RuntimeError(r.stderr)
 return r
psql=[PG/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',sock,'-p','55941','-U','postgres']
def sql(s):return cmd(psql,s).stdout.strip()
ID='00000000-0000-4000-8000-000000000001'
checks=[]
def check(name,yes):
 assert yes,name
 checks.append(name)
def fixture(**extra):
 data=dict(id=ID,status='RUNNING',format_contract='mtt-v2',late_reg_levels=9,rebuy_levels=9,late_reg_mins=90,current_level=8,prize_pool_finalized=False,add_on_available=True,is_rebuy=True,is_reentry=False,addon_period_triggered=False)
 data.update(extra)
 payload=json.dumps(data).replace("'","''")
 sql("truncate tournaments,tournament_players;insert into tournaments select * from json_populate_record(null::tournaments,'"+payload+"'::json);")
 sql("update tournaments set started_at=clock_timestamp()-interval '91 minutes'")
def call(name):return json.loads(sql("select public."+name+"('"+ID+"')"))
def admission():return sql("select fn_tournament_late_registration_open('"+ID+"')")=='t'
try:
 cmd([PG/'initdb','-D',cluster/'data','-U','postgres','-A','trust','--no-locale'])
 cmd([PG/'pg_ctl','-D',cluster/'data','-l',cluster/'pg.log','-o',f"-k {sock} -p 55941 -c listen_addresses=''",'-w','start'])
 sql((ROOT/'scripts/ci/fixtures/late-registration-clock/dependencies.sql').read_text())
 sql('''alter table tournaments add column add_on_available boolean,add column addon_from_start boolean,add column is_rebuy boolean,add column is_reentry boolean,add column addon_period_triggered boolean,add column addon_period_started_at timestamptz,add column addon_period_ends_at timestamptz;
 create function fn_ca_lock_settlement_lane_for_tournament(uuid) returns void language sql as $$select$$;
 create function fn_finalize_tournament_entry_pool_locked(uuid,text,text) returns jsonb language sql as $$select '{"ok":true,"entry_closed":true,"finalized":true}'::jsonb$$;''')
 old=(ROOT/'supabase/migrations/20260926035534_late_registration_closes_at_whichever_of_its_level_or_clock_.sql').read_text()
 sql(old[old.index('CREATE OR REPLACE FUNCTION public.fn_tournament_late_registration_open'):old.index('-- ---------------------------------------------------------------------------\n-- POST-APPLY')])
 sql((ROOT/'scripts/ci/fixtures/late-registration-clock/addon-preimage.sql').read_text())
 sql("set check_function_bodies=off;"+(ROOT/'scripts/ci/fixtures/late-registration-clock/get_club_home-preimage.sql').read_text())
 fixture();check('RED Nightly rejects admission before addon starts',not admission());check('RED rebuy also closed before addon starts',not call('fn_ca_tournament_rebuy_window')['open'])
 migration=(ROOT/'supabase/migrations/20261106024817_registration_and_rebuys_remain_open_through_the_addon_minute.sql').read_text()
 sql(migration)
 fixture();check('pending addon keeps admission open past nominal minutes',admission());check('pending addon keeps rebuy open',call('fn_ca_tournament_rebuy_window')['open']);check('level eight still waits for level nine',not call('fn_close_tournament_entry_window')['entry_closed'])
 fixture(current_level=9);check('draining keeps admission open',admission());check('draining keeps rebuys open',call('fn_ca_tournament_rebuy_window')['open']);check('serving engine still receives addon-start transition',call('fn_close_tournament_entry_window')['reason']=='addon_required')
 sql("update tournaments set addon_period_triggered=true,addon_period_started_at=clock_timestamp()-interval '59 seconds',addon_period_ends_at=clock_timestamp()+interval '1 second'")
 check('last second accepts buyin',admission());r=call('fn_ca_tournament_rebuy_window');check('last second accepts rebuy',r['open']);check('rebuy decision cannot outlive addon',sql("select '"+r['prompt_until']+"'::timestamptz<=addon_period_ends_at from tournaments")=='t')
 sql("update tournaments set addon_period_ends_at=clock_timestamp()")
 check('exact expiry rejects buyin',not admission());check('exact expiry rejects rebuy',not call('fn_ca_tournament_rebuy_window')['open'])
 fixture(addon_from_start=True,addon_period_triggered=True);sql("update tournaments set addon_period_started_at=clock_timestamp()-interval '92 minutes',addon_period_ends_at=clock_timestamp()-interval '1 minute'");check('legacy early offer expiry is not final addon cutoff',admission() and call('fn_ca_tournament_rebuy_window')['open']);check('legacy early offer rebuy deadline is still future',sql("select (fn_ca_tournament_rebuy_window('"+ID+"')->>'prompt_until')::timestamptz>clock_timestamp()")=='t')
 fixture(prize_pool_finalized=True);check('finalized rejects buyin',not admission());check('finalized rejects rebuy',not call('fn_ca_tournament_rebuy_window')['open'])
 fixture(status='COMPLETED');check('completed rejects buyin',not admission());check('completed rejects rebuy',not call('fn_ca_tournament_rebuy_window')['open'])
 fixture(format_contract='sng-v1',max_players=1);sql("insert into tournament_players(tournament_id,user_id) values ('"+ID+"',gen_random_uuid())");check('capacity remains enforced',not admission())
 fixture(add_on_available=False);check('no addon retains old clock cutoff',not admission());check('no addon rebuy retains old clock cutoff',not call('fn_ca_tournament_rebuy_window')['open'])
 fixture(late_reg_levels=0,rebuy_levels=0,late_reg_mins=90);sql("update tournaments set started_at=clock_timestamp()-interval '89 minutes'");check('clock only starts addon at its boundary',not call('fn_close_tournament_entry_window')['entry_closed'])
 sql("update tournaments set started_at=clock_timestamp()-interval '91 minutes'");check('clock only expired starts addon but still admits',admission() and call('fn_close_tournament_entry_window')['reason']=='addon_required')
 check('replay refused',cmd(psql,migration,ok=False).returncode!=0)
 # Qualify the actual purchase source insertion and private receive policy.
 sql("set check_function_bodies=off;"+(ROOT/'scripts/ci/fixtures/late-registration-clock/process_tournament_rebuy-preimage.sql').read_text())
 sql("""create schema realtime;
 create table realtime.messages(payload jsonb,event text,topic text,private boolean,extension text default 'broadcast');
 alter table realtime.messages enable row level security;
 grant usage on schema realtime to authenticated,anon;
 grant select,insert on realtime.messages to authenticated,anon;
 create function realtime.topic() returns text language sql stable as $$select current_setting('test.topic',true)$$;
 create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$insert into realtime.messages(payload,event,topic,private) values ($1,$2,$3,$4)$$;
 alter table tournaments enable row level security;
 grant select on tournaments to authenticated;
 create policy test_readable_tournament on tournaments for select to authenticated using (id='00000000-0000-4000-8000-000000000001');""")
 counter=(ROOT/'supabase/migrations/20261106025529_committed_tournament_addon_purchases_notify_the_break_counte.sql').read_text()
 sql("set check_function_bodies=off;"+counter)
 body=sql("select prosrc from pg_proc where oid='process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure")
 check('purchase source emits after exact receipt proof',body.index('PERFORM realtime.send')>body.index('atomic tournament chip-purchase receipt changed at commit'))
 check('purchase source has one send',body.count('PERFORM realtime.send')==1)
 snippet=body[body.index("  IF v_type='addon' THEN",body.index('-- Enqueued in the purchase transaction')):body.index('  RETURN v_recorded;',body.index('-- Enqueued in the purchase transaction'))]
 emit="DO $test$ DECLARE v_type text:='addon';p_tournament_id uuid:='"+ID+"';BEGIN "+snippet+" END $test$;"
 sql('begin;'+emit+'rollback;');check('aborted purchase publishes no signal',sql('select count(*) from realtime.messages')=='0')
 sql(emit);check('committed purchase signal is private and contains no identity',sql("select count(*) from realtime.messages where payload='{}'::jsonb and event='purchase_committed' and private")=='1')
 topic='tournament-purchases:'+ID
 check('readable event receives signal',sql("set role authenticated;set test.topic='"+topic+"';select count(*) from realtime.messages;reset role;")=='1')
 sql("insert into realtime.messages(payload,event,topic,private) values ('{}','purchase_committed','tournament-purchases:00000000-0000-4000-8000-000000000002',true)")
 check('unreadable event receives nothing',sql("set role authenticated;set test.topic='tournament-purchases:00000000-0000-4000-8000-000000000002';select count(*) from realtime.messages;reset role;")=='0')
 check('client cannot forge purchase signal',cmd(psql,"set role authenticated;insert into realtime.messages(payload,event,topic,private) values ('{}','purchase_committed','"+topic+"',true)",ok=False).returncode!=0)

 print(json.dumps({'passed':len(checks),'checks':checks},indent=2))
finally:
 cmd([PG/'pg_ctl','-D',cluster/'data','-m','immediate','-w','stop'],ok=False)
 shutil.rmtree(cluster);shutil.rmtree(sock)
