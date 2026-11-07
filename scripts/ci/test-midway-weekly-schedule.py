#!/usr/bin/env python3
"""Execute original schedule, event and table boundaries in private PostgreSQL."""
import json, os, pathlib, socket, subprocess, tempfile
root=pathlib.Path(__file__).resolve().parents[2]
fixture=root/'scripts/ci/fixtures/midway-weekly'
pg=pathlib.Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
parent=os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP')
if not parent: raise RuntimeError('TMPDIR must point at task-owned external scratch')
document=json.loads((root/'docs/tournament-schedules/midway-weekly-2026-11-07.json').read_text())
def run(tool,*args,input=None):
    result=subprocess.run([str(pg/tool),*args],input=input,text=True,capture_output=True)
    if result.returncode: raise RuntimeError(result.stderr)
    return result.stdout.strip()
with tempfile.TemporaryDirectory(prefix='midway-weekly-',dir=parent) as folder:
    path=pathlib.Path(folder)
    run('initdb','-D',str(path/'data'),'-A','trust','--no-locale','-E','UTF8')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=str(sock.getsockname()[1])
    run('pg_ctl','-D',str(path/'data'),'-l',str(path/'log'),'-o',f'-k {parent} -p {port} -h 127.0.0.1','start')
    try:
        def sql(text): return run('psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-d','postgres',input=text)
        sql("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
         CREATE SCHEMA auth; CREATE SCHEMA smarter_private;
         CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
         CREATE TABLE tournament_schedules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid,union_id uuid,name text,description text,active boolean,days_of_week integer[],start_times_utc text[],interval_minutes integer,time_zone text,config jsonb);
         CREATE TABLE tournament_schedule_spawns(spawn_key text PRIMARY KEY,tournament_id uuid);
         CREATE TABLE tournament_cancellation_receipts(tournament_id uuid,receipt jsonb);
         CREATE FUNCTION smarter_private.cancellation_lane(uuid) RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
         CREATE FUNCTION atomic_cancel_tournament(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"fully_settled":false}'::jsonb$$;
         CREATE FUNCTION fn_ca_new_tournament_is_unlimited(jsonb) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
        """)
        types={}
        for event in document['events']:
            for key,value in event['terms'].items():
                types.setdefault(key,'text')
                if value is not None: types[key]='boolean' if isinstance(value,bool) else 'numeric' if isinstance(value,(int,float)) else 'text'
        types.update(id='uuid',club_id='uuid',union_id='uuid',schedule_id='uuid',status='text',start_time='timestamptz',started_at='timestamptz',current_level='integer',blind_level_state='jsonb',blind_structure='text',prize_pool_finalized='boolean',format_contract='text',max_players='integer',starting_chips='integer',late_reg_levels='integer',late_reg_mins='integer')
        sql('CREATE TABLE tournaments('+','.join(k+' '+v for k,v in types.items())+'); CREATE TABLE tables(id uuid,tournament_id uuid,small_blind numeric,big_blind numeric,ante numeric,stakes text);')
        sql((fixture/'blind-number.sql').read_text()+';')
        sql((fixture/'clock-helpers.sql').read_text())
        for name in ['fn_ca_tournament_lock_level_clock','fn_ca_schedule_level_clock_floor','fn_tournament_table_inherits_committed_blinds','fn_ca_tournament_level_clock_floor','fn_tournaments_creation_guard']:
            sql((fixture/(name+'.sql')).read_text()+';')
        sql('''CREATE TRIGGER tournament_schedule_level_clock_floor BEFORE INSERT OR UPDATE OF config ON tournament_schedules FOR EACH ROW EXECUTE FUNCTION fn_ca_schedule_level_clock_floor();
         CREATE TRIGGER tournaments_lock_level_clock BEFORE INSERT OR UPDATE OF blind_structure ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_ca_tournament_lock_level_clock();
         CREATE TRIGGER zzzzzzzzzz_tournament_level_clock_floor BEFORE INSERT OR UPDATE ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_ca_tournament_level_clock_floor();
         CREATE TRIGGER table_inherits BEFORE INSERT ON tables FOR EACH ROW EXECUTE FUNCTION fn_tournament_table_inherits_committed_blinds();''')
        target=next(e for e in document['events'] if e['sourceName']=='Nightly 10K (NLH)')
        scope='fade0000-0000-0000-0000-000000000001'
        def insert_event(event_id,schedule_id=target['id'],club=scope,status='REGISTERING',started='NULL'):
            sql(f"""INSERT INTO tournaments(id,schedule_id,club_id,union_id,name,status,started_at,current_level,tournament_type,variant,buy_in_amount,buy_in_fee,starting_chips,blind_structure,late_reg_levels,late_reg_mins,blind_speed)
             VALUES('{event_id}','{schedule_id}','{club}','{club}','Old Terms','{status}',{started},0,'MTT','freezeout',31.5,3.5,30000,'[{{"level":1,"smallBlind":25,"bigBlind":50,"ante":0,"durationMinutes":8}}]',6,48,'standard');""")
        insert_event('11111111-1111-4111-8111-111111111111')
        before=sql("SELECT starting_chips||','||(blind_structure::jsonb->0->>'smallBlind')||'/'||(blind_structure::jsonb->0->>'bigBlind') FROM tournaments LIMIT 1")
        assert before!='10000,50/100', 'baseline must reproduce legacy terms'
        migration=next((root/'supabase/migrations').glob('*midway_weekly_tournaments_follow_the_owner_spreadsheet.sql'))
        sql(migration.read_text())
        sql('''CREATE TRIGGER tournaments_creation_guard BEFORE INSERT ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_tournaments_creation_guard();
         CREATE FUNCTION affordability_witness() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
          IF NEW.club_id='fade0000-0000-0000-0000-000000000001'::uuid AND NEW.started_at IS NULL AND NEW.status='REGISTERING'
             AND fn_ca_midway_weekly_terms(NEW.schedule_id) IS NOT NULL
             AND NEW.guaranteed_prize IS DISTINCT FROM (fn_ca_midway_weekly_terms(NEW.schedule_id)->>'guaranteed_prize')::numeric
          THEN RAISE EXCEPTION 'Affordability saw a stale guarantee'; END IF; RETURN NEW; END$$;
         CREATE TRIGGER tournaments_guarantee_affordable_ins BEFORE INSERT ON tournaments FOR EACH ROW EXECUTE FUNCTION affordability_witness();''')
        sql('CREATE TRIGGER owner_board BEFORE INSERT OR UPDATE OR DELETE ON tournament_schedules FOR EACH ROW EXECUTE FUNCTION fn_tournament_schedule_board_is_hard_coded();')
        assert sql('SELECT sum(cardinality(days_of_week)*cardinality(start_times_utc)) FROM tournament_schedules WHERE active')=='378'
        counts=sql('SELECT d,count(*) FROM tournament_schedules CROSS JOIN LATERAL unnest(days_of_week) d WHERE active GROUP BY d ORDER BY d')
        assert counts.splitlines()==['0|61','1|49','2|49','3|50','4|51','5|57','6|61']
        insert_event('22222222-2222-4222-8222-222222222222')
        actual=sql("SELECT name||','||guaranteed_prize||','||starting_chips||','||(blind_structure::jsonb->0->>'smallBlind')||'/'||(blind_structure::jsonb->0->>'bigBlind')||','||late_reg_levels||','||late_reg_mins FROM tournaments WHERE id='22222222-2222-4222-8222-222222222222'")
        assert actual=='Nightly 10K (NLH),10000,10000,50/100,12,0',actual
        sql("UPDATE tournament_schedules SET name='Old Name',days_of_week=ARRAY[0],start_times_utc=ARRAY['01:00'],config='{\"type\":\"fixed_board\",\"fixedBoard\":\"Nightly 10K (NLH)\"}' WHERE id='"+target['id']+"'")
        assert sql("SELECT name||','||start_times_utc[1]||','||(config->>'midwayWeeklyRevision') FROM tournament_schedules WHERE id='"+target['id']+"'")=="Nightly 10K (NLH),19:00,owner-sheet-2026-11-07-v1"
        # Every row, including renamed fixed boards and changed satellites,
        # survives the old creator's wrong defaults at the original insert.
        for i,event in enumerate(document['events']):
            event_id=f'30000000-0000-4000-8000-{i:012d}'
            insert_event(event_id,event['id'])
            assert sql("SELECT to_jsonb(t) @> fn_ca_midway_weekly_terms(t.schedule_id) FROM tournaments t WHERE id='"+event_id+"'")=='t',event['name']
        sql("INSERT INTO tables VALUES(gen_random_uuid(),'22222222-2222-4222-8222-222222222222',25,50,0,'25/50')")
        assert sql('SELECT stakes FROM tables')=='50/100'
        insert_event('44444444-4444-4444-8444-444444444444',club='99999999-9999-4999-8999-999999999999',schedule_id='99999999-9999-4999-8999-999999999998')
        assert sql("SELECT name FROM tournaments WHERE id='44444444-4444-4444-8444-444444444444'")=='Old Terms'
        insert_event('44444444-4444-4444-8444-444444444445',club='99999999-9999-4999-8999-999999999999')
        assert sql("SELECT name FROM tournaments WHERE id='44444444-4444-4444-8444-444444444445'")=='Old Terms'
        insert_event('55555555-5555-4555-8555-555555555555',status='RUNNING',started='now()')
        assert sql("SELECT name FROM tournaments WHERE id='55555555-5555-4555-8555-555555555555'")=='Old Terms'
        assert 'accepted_contract_preserved' in sql("SELECT fn_ca_install_midway_weekly_occurrence('55555555-5555-4555-8555-555555555555')")
        sql("INSERT INTO tournament_schedule_spawns VALUES('original-claim','11111111-1111-4111-8111-111111111111')")
        try: sql("SELECT fn_ca_install_midway_weekly_occurrence('11111111-1111-4111-8111-111111111111')")
        except RuntimeError as error: assert 'Exact cancellation did not settle' in str(error)
        else: raise AssertionError('installer claimed an unsettled cancellation succeeded')
        assert sql("SELECT spawn_key FROM tournament_schedule_spawns WHERE tournament_id='11111111-1111-4111-8111-111111111111'")=='original-claim'
        try: sql("SET request.jwt.claim.role='authenticated'; UPDATE tournament_schedules SET name='Tampered' WHERE id='"+target['id']+"'")
        except RuntimeError as error: assert 'hard coded owner weekly schedule' in str(error)
        else: raise AssertionError('operator bypassed source ownership')
        print('PASS: legacy drift reproduced; all 143 canonical insert contracts, 378 weekly starts, creator overwrite, actual table blinds, unrelated-club isolation, running-game preservation and operator protection verified')
    finally:
        run('pg_ctl','-D',str(path/'data'),'-m','immediate','stop')
