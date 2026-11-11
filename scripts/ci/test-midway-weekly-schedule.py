#!/usr/bin/env python3
"""Execute original schedule, event and table boundaries in private PostgreSQL."""
import json, os, pathlib, socket, subprocess, tempfile
from datetime import datetime
root=pathlib.Path(__file__).resolve().parents[2]
fixture=root/'scripts/ci/fixtures/midway-weekly'
pg=pathlib.Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
parent=os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP')
if not parent: raise RuntimeError('TMPDIR must point at task-owned external scratch')
document=json.loads((root/'docs/tournament-schedules/midway-weekly-2026-11-07.json').read_text())
contract=json.loads((fixture/'production-creation-contract.json').read_text())
for event in document['events']:
    if event['terms']['game_type']=='PLO6':
        assert event['terms']['table_size']<=7 and event['config']['tableSize']<=7,event['name']
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
        sql_prefix=''
        def sql(text): return run('psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-d','postgres',input=sql_prefix+text)
        sql("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
         CREATE SCHEMA auth; CREATE SCHEMA smarter_private;
         CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
         CREATE TABLE tournament_schedule_spawns(spawn_key text PRIMARY KEY,tournament_id uuid);
         CREATE TABLE tournament_cancellation_receipts(tournament_id uuid,receipt jsonb);
         CREATE FUNCTION smarter_private.cancellation_lane(uuid) RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
         CREATE FUNCTION atomic_cancel_tournament(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"fully_settled":false}'::jsonb$$;
        """)
        # Production's exact zone validator is intentionally retained: its
        # per-row catalog lookup must fit the unchanged 8s statement budget.
        sql("""CREATE FUNCTION fn_schedule_time_zone_is_known(p_zone text)
         RETURNS boolean LANGUAGE sql STABLE SET search_path TO pg_catalog AS $$
          SELECT p_zone IS NULL OR ((p_zone IN ('UTC','GMT')
           OR p_zone ~ '^[A-Z][A-Za-z]+/[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)?$')
           AND EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names n WHERE n.name=p_zone))$$;
""")
        # Reproduce the actual creation schema instead of deriving permissive
        # nullable columns from the current candidate terms.
        for table in ['tournament_schedules','tournaments']:
            columns=[]
            for column in contract['columns']:
                if column['table_name']!=table: continue
                clause=column['name']+' '+column['type']
                if column['default_expression'] is not None: clause+=' DEFAULT '+column['default_expression']
                if column['not_null']: clause+=' NOT NULL'
                if column['name']=='id': clause+=' PRIMARY KEY'
                columns.append(clause)
            columns += ['CONSTRAINT '+check['name']+' '+check['definition'].removesuffix(' NOT VALID') for check in contract['checks'] if check['table']==table]
            sql('CREATE TABLE '+table+'('+','.join(columns)+')')
        sql("""CREATE ROLE postgres;
         CREATE TABLE ca_mtt_admission_contract(singleton boolean PRIMARY KEY,abi text);
         INSERT INTO ca_mtt_admission_contract VALUES(true,'unlimited-mtt-v2');
         CREATE TABLE engine_maintenance_break(enforce_freeze boolean,announced_at timestamptz,phase text,break_started_at timestamptz,break_ends_at timestamptz);
         CREATE TABLE engine_maintenance_thaws(contract_version integer,release_target_at timestamptz,shifted jsonb);
         CREATE TABLE tournament_players(id uuid,tournament_id uuid);
         CREATE TABLE ca_freeroll_free_buy_log(tournament_id uuid,tournament_name text,op text,status text,changed jsonb);
         CREATE TABLE tables(id uuid,tournament_id uuid,small_blind numeric,big_blind numeric,ante numeric,stakes text);""")
        # Definition bodies can reference a later helper, just as production's
        # existing dependency graph does. Every captured signature/hash is checked.
        sql('SET check_function_bodies=off;'+''.join(f['definition']+';' for f in contract['functions']))
        for function in contract['functions']:
            assert sql("SELECT md5(pg_get_functiondef('public."+function['signature']+"'::regprocedure))")==function['hash'],function['signature']
        sql(';'.join(trigger['definition'] for trigger in contract['creationTriggers'])+';')
        sql((fixture/'blind-number.sql').read_text()+';')
        sql((fixture/'clock-helpers.sql').read_text())
        for name in ['fn_ca_tournament_lock_level_clock','fn_ca_schedule_level_clock_floor','fn_tournament_table_inherits_committed_blinds','fn_ca_tournament_level_clock_floor','fn_tournaments_creation_guard','fn_ca_bounty_mtt_rebuys_until_registration_closes']:
            sql((fixture/(name+'.sql')).read_text()+';')
        assert sql("SELECT md5(pg_get_functiondef('fn_ca_bounty_mtt_rebuys_until_registration_closes()'::regprocedure))")=='2e0b024e984523fc7f10cb856ed6406d'
        assert sql("SELECT md5(pg_get_functiondef('fn_ca_mtt_blind_contract(text,integer)'::regprocedure))")=='4a13e21eba115284df84b1f8be2c83de'
        sql('CREATE TRIGGER a3_bounty_mtt_rebuys_until_registration_closes BEFORE INSERT OR UPDATE OF is_bounty,is_pko,is_mystery_bounty,tournament_type,variant,satellite_target_id,is_rebuy,is_reentry,rebuy_cost,rebuy_chips,rebuy_levels,max_rebuys,max_reentries,late_reg_levels,buy_in_amount,buy_in_fee ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_ca_bounty_mtt_rebuys_until_registration_closes();')
        sql('''CREATE TRIGGER tournament_schedule_level_clock_floor BEFORE INSERT OR UPDATE OF config ON tournament_schedules FOR EACH ROW EXECUTE FUNCTION fn_ca_schedule_level_clock_floor();
         CREATE TRIGGER tournaments_lock_level_clock BEFORE INSERT OR UPDATE OF blind_structure ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_ca_tournament_lock_level_clock();
         CREATE TRIGGER zzzzzzzzzz_tournament_level_clock_floor BEFORE INSERT OR UPDATE ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_ca_tournament_level_clock_floor();
         CREATE TRIGGER table_inherits BEFORE INSERT ON tables FOR EACH ROW EXECUTE FUNCTION fn_tournament_table_inherits_committed_blinds();''')
        target=next(e for e in document['events'] if e['sourceName']=='Nightly 10K (NLH)')
        scope='fade0000-0000-0000-0000-000000000001'
        def insert_event(event_id,schedule_id=target['id'],club=scope,status='REGISTERING',started='NULL',buy_in=31.5,fee=3.5):
            sql(f"""INSERT INTO tournaments(id,schedule_id,club_id,union_id,name,status,started_at,current_level,tournament_type,variant,buy_in_amount,buy_in_fee,starting_chips,blind_structure,late_reg_levels,late_reg_mins,blind_speed,ban_chat,start_time)
             VALUES('{event_id}','{schedule_id}','{club}','{club}','Old Terms','{status}',{started},0,'MTT','freezeout',{buy_in},{fee},30000,'[{{"level":1,"smallBlind":25,"bigBlind":50,"ante":0,"durationMinutes":8}}]',6,48,'standard',true,'2026-11-10 01:00:00+00');""")
        insert_event('11111111-1111-4111-8111-111111111111')
        before=sql("SELECT starting_chips||','||(blind_structure::jsonb->0->>'smallBlind')||'/'||(blind_structure::jsonb->0->>'bigBlind') FROM tournaments LIMIT 1")
        assert before!='10000,50/100', 'baseline must reproduce legacy terms'
        migration=next((root/'supabase/migrations').glob('*midway_weekly_tournaments_follow_the_owner_spreadsheet.sql'))
        # Production already owns 142 catalog identities; only the 20:15 split
        # feeder is new. Keep its original owner trigger installed before DML.
        sql("""CREATE FUNCTION fn_tournament_schedule_board_is_hard_coded()
          RETURNS trigger LANGUAGE plpgsql SET search_path TO public AS $$BEGIN
           IF coalesce(auth.role(),'') IN ('authenticated','anon') AND (
            (TG_OP<>'INSERT' AND (OLD.config->>'type'='fixed_board' OR OLD.config ? 'fixedBoard')) OR
            (TG_OP<>'DELETE' AND (NEW.config->>'type'='fixed_board' OR NEW.config ? 'fixedBoard')))
           THEN RAISE EXCEPTION 'hard coded owner schedule' USING ERRCODE='42501'; END IF;
           RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END$$;
          CREATE TRIGGER owner_board BEFORE INSERT OR UPDATE OR DELETE ON tournament_schedules
           FOR EACH ROW EXECUTE FUNCTION fn_tournament_schedule_board_is_hard_coded();""")
        existing=[e for e in document['events'] if not e['id'].startswith('ef80591d')]
        assert len(existing)==142
        seed=[dict(id=e['id'],club_id=scope,union_id=scope,name='Old '+e['name'],days_of_week=e['days'],start_times_utc=e['times'],active=True,time_zone='America/Chicago',config={}) for e in existing]
        seed.append(dict(id='ccb6164a-2db4-400a-8ee0-b6607e880f4e',club_id=scope,union_id=scope,name='Retired Prime Time',days_of_week=[1,2,3,4,5,6],start_times_utc=['18:00'],active=True,time_zone='America/Chicago',config={}))
        sql("INSERT INTO tournament_schedules(id,club_id,union_id,name,active,time_zone,config,days_of_week,start_times_utc) SELECT id,club_id,union_id,name,active,time_zone,config,days_of_week,start_times_utc FROM jsonb_populate_recordset(NULL::tournament_schedules,$seed$"+json.dumps(seed)+"$seed$::jsonb)")
        # Historical inactive rows already satisfy retirement. Their exact
        # row image must not be rewritten or revalidate zones during install.
        sql("""INSERT INTO tournament_schedules(id,club_id,union_id,name,active,time_zone,config,days_of_week,start_times_utc)
          SELECT ('87000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
          'fade0000-0000-0000-0000-000000000001','fade0000-0000-0000-0000-000000000001',
          'Inactive historical event '||i,false,'America/Chicago','{}',ARRAY[0],ARRAY['08:00'] FROM generate_series(1,48) i;
          CREATE TABLE inactive_history_updates(id uuid);
          CREATE FUNCTION record_inactive_history_update() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
           IF OLD.id::text LIKE '87000000-%' THEN INSERT INTO inactive_history_updates VALUES(OLD.id); END IF;
           RETURN NEW; END$$;
          CREATE TRIGGER inactive_history_update_witness BEFORE UPDATE ON tournament_schedules
           FOR EACH ROW EXECUTE FUNCTION record_inactive_history_update();""")
        sql("""CREATE TABLE schedule_check_calls(id uuid);
          CREATE FUNCTION schedule_check_witness(p_id uuid) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN
           INSERT INTO schedule_check_calls VALUES(p_id); RETURN true; END$$;
          ALTER TABLE tournament_schedules ADD CONSTRAINT row_check_count CHECK(schedule_check_witness(id));
          TRUNCATE schedule_check_calls;""")
        # Mirror the production applier's owning transaction identity and 12s
        # bound; the migration retains its own 8s statement/1s lock limits.
        installed=migration.read_text().replace('BEGIN;\n',"BEGIN;\nSET LOCAL application_name='apply-recorded-migration';\nSET LOCAL transaction_timeout='12s';\n",1)
        sql(installed)
        assert sql('SELECT count(*) FROM inactive_history_updates')=='0','inactive historical schedules were rewritten'
        assert sql("SELECT count(*) FROM (SELECT id FROM schedule_check_calls GROUP BY id HAVING count(*)>1) q")=='0','existing schedule CHECK ran twice through proposed INSERT'
        assert sql("SELECT active FROM tournament_schedules WHERE id='ccb6164a-2db4-400a-8ee0-b6607e880f4e'")=='f'

        sql('''CREATE TRIGGER tournaments_creation_guard BEFORE INSERT ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_tournaments_creation_guard();
         CREATE FUNCTION affordability_witness() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
          IF NEW.club_id='fade0000-0000-0000-0000-000000000001'::uuid AND NEW.started_at IS NULL AND NEW.status='REGISTERING'
             AND fn_ca_midway_weekly_terms(NEW.schedule_id) IS NOT NULL
             AND NEW.guaranteed_prize IS DISTINCT FROM (fn_ca_midway_weekly_terms(NEW.schedule_id)->>'guaranteed_prize')::numeric
          THEN RAISE EXCEPTION 'Affordability saw a stale guarantee'; END IF; RETURN NEW; END$$;
         CREATE TRIGGER tournaments_guarantee_affordable_ins BEFORE INSERT ON tournaments FOR EACH ROW EXECUTE FUNCTION affordability_witness();''')
        # The installed source wrote NULL into a production NOT NULL column
        # when add-ons were disabled. Reproduce23502 before the followup.
        disabled=next(e for e in document['events'] if e['id']=='a70c1028-1600-4000-9000-000000000001')
        try: insert_event('88888888-8888-4888-8888-888888888888',disabled['id'])
        except RuntimeError as error: assert 'addon_break_minutes' in str(error) and 'not-null constraint' in str(error),str(error)
        else: raise AssertionError('installed null add-on clock unexpectedly satisfied NOT NULL')
        followup=next((root/'supabase/migrations').glob('*midway_disabled_addons_keep_the_required_break_clock.sql'))
        sql(followup.read_text().replace('BEGIN;\n',"BEGIN;\nSET LOCAL application_name='apply-recorded-migration';\nSET LOCAL transaction_timeout='12s';\n",1))
        assert sql("SELECT count(*) FROM tournament_schedules WHERE active AND config->'midwayWeeklyTerms'->'addon_break_minutes'='null'::jsonb")=='0'
        # The real earlier a3 guard rejected the newly authored50/100 ladder
        # before the canonical creation boundary could apply the current terms.
        try: insert_event('99999999-1111-4111-8111-111111111111','a70c1028-1800-2500-9000-000000000001',buy_in=22.5,fee=2.5)
        except RuntimeError as error: assert 'DAILY_6PM_AUTHORED_STRUCTURE_DRIFT' in str(error),str(error)
        else: raise AssertionError('legacy6PM guard did not reproduce its authored structure refusal')
        sixpm=next((root/'supabase/migrations').glob('*midway_weekly_terms_supersede_legacy_sixpm_defaults.sql'))
        sql(sixpm.read_text())
        insert_event('99999999-1111-4111-8111-111111111111','a70c1028-1800-2500-9000-000000000001',buy_in=22.5,fee=2.5)
        assert sql("SELECT to_jsonb(t) @> fn_ca_midway_weekly_terms(t.schedule_id) FROM tournaments t WHERE id='99999999-1111-4111-8111-111111111111'")=='t'
        # Every configured feeder must resolve an active canonical target by
        # the same exact name used by the serving scheduler's target lookup.
        missing_targets=sql("SELECT feeder.name FROM tournament_schedules feeder WHERE feeder.active AND feeder.config ? 'satelliteTargetName' AND NOT EXISTS (SELECT 1 FROM tournament_schedules target WHERE target.active AND target.name=feeder.config->>'satelliteTargetName' AND target.union_id=feeder.union_id)")
        assert not missing_targets,missing_targets
        assert sql('SELECT sum(cardinality(days_of_week)*cardinality(start_times_utc)) FROM tournament_schedules WHERE active')=='378'
        counts=sql('SELECT d,count(*) FROM tournament_schedules CROSS JOIN LATERAL unnest(days_of_week) d WHERE active GROUP BY d ORDER BY d')
        assert counts.splitlines()==['0|61','1|49','2|49','3|50','4|51','5|57','6|61']
        insert_event('22222222-2222-4222-8222-222222222222')
        actual=sql("SELECT name||','||trim_scale(guaranteed_prize)::text||','||starting_chips||','||(blind_structure::jsonb->0->>'smallBlind')||'/'||(blind_structure::jsonb->0->>'bigBlind')||','||late_reg_levels||','||late_reg_mins FROM tournaments WHERE id='22222222-2222-4222-8222-222222222222'")
        assert actual=='Nightly 10K (NLH),10000,10000,50/100,12,0',actual
        sql("UPDATE tournament_schedules SET name='Old Name',days_of_week=ARRAY[0],start_times_utc=ARRAY['01:00'],config='{\"type\":\"fixed_board\",\"fixedBoard\":\"Nightly 10K (NLH)\"}' WHERE id='"+target['id']+"'")
        assert sql("SELECT name||','||start_times_utc[1]||','||(config->>'midwayWeeklyRevision') FROM tournament_schedules WHERE id='"+target['id']+"'")=="Nightly 10K (NLH),19:00,owner-sheet-2026-11-07-v1"
        # Every row, including renamed fixed boards and changed satellites,
        # survives the old creator's wrong defaults at the original insert.
        for i,event in enumerate(document['events']):
            event_id=f'30000000-0000-4000-8000-{i:012d}'
            insert_event(event_id,event['id'])
            assert sql("SELECT to_jsonb(t) @> fn_ca_midway_weekly_terms(t.schedule_id) FROM tournaments t WHERE id='"+event_id+"'")=='t',event['name']
        # A whitespace-only JSON ladder difference preserves the accepted row
        # and its claim instead of entering the refund/cancellation authority.
        sql("UPDATE tournaments SET start_time='2026-11-10 01:00:00+00',blind_structure=jsonb_pretty(blind_structure::jsonb) WHERE id='22222222-2222-4222-8222-222222222222'")
        sql("INSERT INTO tournament_schedule_spawns VALUES('matching-claim','22222222-2222-4222-8222-222222222222')")
        assert 'already_matches' in sql("SELECT fn_ca_install_midway_weekly_occurrence('22222222-2222-4222-8222-222222222222')")
        assert sql("SELECT spawn_key FROM tournament_schedule_spawns WHERE tournament_id='22222222-2222-4222-8222-222222222222'")=='matching-claim'
        # Canonical feeder terms do not make a cancelled/missing parent valid.
        feeder=next(e for e in document['events'] if e['times']==['20:15'] and e['name']=='Sunday Deep Stack Satellite 30')
        feeder_id='66666666-6666-4666-8666-666666666666'
        parent_id='77777777-7777-4777-8777-777777777777'
        insert_event(parent_id,schedule_id='99999999-9999-4999-8999-999999999997')
        insert_event(feeder_id,schedule_id=feeder['id'])
        sql("UPDATE tournaments SET start_time='2026-11-10 02:15:00+00',satellite_target_id='"+parent_id+"' WHERE id='"+feeder_id+"'; UPDATE tournaments SET start_time='2026-11-15 19:00:00+00' WHERE id='"+parent_id+"'; INSERT INTO tournament_schedule_spawns VALUES('feeder-claim','"+feeder_id+"')")
        assert 'already_matches' in sql("SELECT fn_ca_install_midway_weekly_occurrence('"+feeder_id+"')")
        for invalid in ["UPDATE tournaments SET status='CANCELLED' WHERE id='"+parent_id+"'", "DELETE FROM tournaments WHERE id='"+parent_id+"'"]:
            sql(invalid)
            try: sql("SELECT fn_ca_install_midway_weekly_occurrence('"+feeder_id+"')")
            except RuntimeError as error: assert 'Exact cancellation did not settle' in str(error)
            else: raise AssertionError('canonical feeder retained a cancelled/missing parent')
            assert sql("SELECT spawn_key FROM tournament_schedule_spawns WHERE tournament_id='"+feeder_id+"'")=='feeder-claim'
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
        # Independently bad inputs must be refused by real schema/normalizers,
        # even when they are outside the canonical catalog's rewrite boundary.
        generic=dict(name='Native creation contract',club_id='99999999-9999-4999-8999-999999999999',union_id=None,
          tournament_type='MTT',variant='freezeout',status='REGISTERING',start_time='2026-11-10T01:00:00Z',
          buy_in_amount=36,buy_in_fee=4,starting_chips=10000,max_players=100,min_players=3,ban_chat=True,
          blind_structure='[{"level":1,"smallBlind":25,"bigBlind":50,"ante":0,"durationMinutes":8}]')
        def insert_generic(overrides):
            row=generic|overrides; keys=','.join(row)
            sql('INSERT INTO tournaments('+keys+') SELECT '+keys+' FROM jsonb_populate_record(NULL::tournaments,$row$'+json.dumps(row)+'$row$::jsonb)')
        invalid=[({'addon_break_minutes':None},'addon_break_minutes'),
          ({'status':'INVALID'},'tournaments_status_check'),
          ({'buy_in_amount':30,'buy_in_fee':10},'tournaments_rake_within_10_pct'),
          ({'free_buy':True},'tournaments_free_buy_entry_is_free'),
          ({'mystery_bounty_profile':'invalid'},'tournaments_mystery_profile_chk'),
          ({'format_contract':'mtt-v2'},'TOURNAMENT_FORMAT_IS_DATABASE_ASSIGNED')]
        for overrides,expected in invalid:
            try: insert_generic(overrides)
            except RuntimeError as error: assert expected in str(error),(overrides,str(error))
            else: raise AssertionError('creation contract accepted '+repr(overrides))
        sql("UPDATE ca_mtt_admission_contract SET abi='unknown'")
        try:
            try: insert_generic({})
            except RuntimeError as error: assert 'MTT_ADMISSION_CONTRACT_MISSING_OR_UNKNOWN' in str(error)
            else: raise AssertionError('unknown admission contract was accepted')
        finally: sql("UPDATE ca_mtt_admission_contract SET abi='unlimited-mtt-v2'")
        sql("INSERT INTO engine_maintenance_break VALUES(true,now()-interval '1 minute','last_hand',NULL,NULL)")
        try:
            try: insert_generic({})
            except RuntimeError as error: assert 'MTT_CREATION_PLATFORM_FROZEN' in str(error)
            else: raise AssertionError('frozen admission was accepted')
        finally: sql('DELETE FROM engine_maintenance_break')
        insert_generic({'name':'Capacity normalization witness','max_players':2,'min_players':2})
        assert sql("SELECT max_players IS NULL AND min_players=3 AND format_contract='mtt-v2' AND payout_percent=15 AND payout_depth_percent=15 FROM tournaments WHERE name='Capacity normalization witness'")=='t'
        # Owner November7: only twelve-level chip entries priced25+ change.
        # The existing final row boundary is captured after its earlier clock fix.
        sql((fixture/'final-clock-before-ten-levels.sql').read_text())
        sql("CREATE TABLE clubs(id uuid PRIMARY KEY,asset text,is_platform boolean DEFAULT false);")
        sql("INSERT INTO clubs(id,asset) VALUES('"+scope+"','chips'),('99999999-9999-4999-8999-999999999999','diamonds')")
        sql("CREATE TABLE before_ten AS SELECT id,to_jsonb(t) row FROM tournaments t;")
        assert sql("SELECT count(*) FROM tournaments WHERE club_id='"+scope+"' AND buy_in_amount+buy_in_fee>=25 AND late_reg_levels=12 AND status='REGISTERING'")!='0'
        ten=next((root/'supabase/migrations').glob('*chip_buyins_twenty_five_and_up_register_for_ten_levels.sql'))
        # The first installer refusal came from this omitted UPDATE authority.
        # Capture its actual source and pure dependencies; no guard is stubbed.
        lifecycle=json.loads((fixture/'lifecycle-contract.json').read_text())
        # Empty, exact typed read projection for the unrelated prior guarantee
        # exception. The real guard plans this relation even when its ID differs.
        sql('CREATE TABLE chip_ledger('+','.join(c['name']+' '+c['type'] for c in lifecycle['ledgerColumns'])+')')
        sql('SET check_function_bodies=off;'+''.join(f['definition']+';' for f in lifecycle['functions'])+lifecycle['guard']+';')
        for function in lifecycle['functions']:
            assert sql("SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE proname='"+function['name']+"' AND pronamespace='public'::regnamespace")==function['hash'],function['name']
        assert sql("SELECT md5(pg_get_functiondef('public.fn_guard_managed_game_lifecycle()'::regprocedure))")==lifecycle['guardHash']
        sql(lifecycle['trigger']+';')
        registered='22222222-2222-4222-8222-222222222222'
        sql("INSERT INTO tournament_players(id,tournament_id) VALUES(gen_random_uuid(),'"+registered+"'); ALTER ROLE postgres SUPERUSER;")
        # The isolated cluster's admin starts as the local OS identity. The
        # production installer connects as postgres; reproduce that identity.
        sql_prefix='SET SESSION AUTHORIZATION postgres; '
        failed=(fixture/'ten-levels-before-lifecycle-admission.sql').read_text()
        def installer(text):
            return text.replace('BEGIN;\n',"BEGIN;\nSET LOCAL application_name='apply-recorded-migration';\nSET LOCAL transaction_timeout='12s';\n",1)
        try: sql(installer(failed))
        except RuntimeError as error: assert 'This tournament cannot be modified after a player has registered' in str(error),str(error)
        else: raise AssertionError('registered-player lifecycle refusal did not reproduce')
        assert sql("SELECT to_regprocedure('public.fn_ca_ten_level_late_registration(public.tournaments)') IS NULL")=='t','refused migration partially committed'
        assert sql("SELECT late_reg_levels FROM tournaments WHERE id='"+registered+"'")=='12'
        # Stage only the candidate source in isolation for negative admission
        # probes, then restore every preimage before the exact full migration.
        signatures=['fn_ca_midway_weekly_catalog()','fn_ca_tournament_level_clock_floor()','fn_ca_bounty_mtt_rebuys_until_registration_closes()','fn_guard_managed_game_lifecycle()']
        preimages=[sql("SELECT pg_get_functiondef('public."+sig+"'::regprocedure)") for sig in signatures]
        candidate=ten.read_text()
        sql(installer(candidate[:candidate.index('-- Capture and lock')]+"COMMIT;"))
        exact="UPDATE tournaments SET late_reg_levels=10,short_description=replace(short_description,'Late Registration Through Level 12.','Late Registration Through Level 10.') WHERE id='"+registered+"'"
        # The same production guard also handles table status and deletion.
        # Exercise the real trigger before and after applying its forward fix.
        sql("""ALTER TABLE tables ADD COLUMN status text, ADD COLUMN is_deleted boolean DEFAULT false;
            CREATE TABLE table_seats(table_id uuid, left_at timestamptz);
            CREATE TRIGGER trg_tables_managed_lifecycle_guard BEFORE UPDATE OF status,is_deleted
            ON tables FOR EACH ROW EXECUTE FUNCTION fn_guard_managed_game_lifecycle();
            INSERT INTO tables(id,status) VALUES ('11111111-0000-4000-8000-000000000001','running');""")
        table_id = "'11111111-0000-4000-8000-000000000001'"
        close_table = "UPDATE tables SET status='closed' WHERE id=" + table_id
        try: sql(close_table)
        except RuntimeError as error: assert 'record "old" has no field "late_reg_levels"' in str(error),str(error)
        else: raise AssertionError('missing table-row cutoff error was not reproduced')
        cutoff_guard=next((root/'supabase/migrations').glob('*scope_tournament_cutoff_fields_to_tournament_trigger_rows.sql')).read_text()
        sql(cutoff_guard)
        sql('INSERT INTO table_seats(table_id) VALUES (' + table_id + ')')
        try: sql(close_table)
        except RuntimeError as error: assert 'cannot be closed while players are seated' in str(error),str(error)
        else: raise AssertionError('occupied table closed')
        sql('UPDATE table_seats SET left_at=now() WHERE table_id='+table_id)
        sql(close_table)
        assert sql('SELECT status FROM tables WHERE id='+table_id)=='closed'
        # An exact installer edit succeeds, while the four witnesses below
        # still exercise the incumbent tournament restrictions on the fixed guard.
        sql("BEGIN;SET LOCAL application_name='apply-recorded-migration';"+exact+";ROLLBACK;")
        bad_contexts=[("SET application_name='ordinary-request'; ",exact),
          ("SET application_name='apply-recorded-migration'; SET request.jwt.claim.role='authenticated'; ",exact),
          ("SET application_name='apply-recorded-migration'; ",exact.replace('late_reg_levels=10,','late_reg_levels=10,rebuy_levels=13,')),
          ("SET application_name='apply-recorded-migration'; ",exact.replace('late_reg_levels=10,','late_reg_levels=9,'))]
        for context,statement in bad_contexts:
            try: sql(context+statement)
            except RuntimeError as error: assert 'This tournament cannot be modified after a player has registered' in str(error),str(error)
            else: raise AssertionError('lifecycle admission accepted an unauthorized context or unrelated edit')
            assert sql("SELECT to_jsonb(t)=b.row FROM tournaments t JOIN before_ten b USING(id) WHERE t.id='"+registered+"'")=='t'
        sql('SET check_function_bodies=off;'+''.join(definition+';' for definition in preimages)+"DROP FUNCTION public.fn_ca_ten_level_late_registration(public.tournaments);")
        sql(installer(candidate))
        print('PASS: actual registered-player lifecycle refusal reproduced and rolled back; exact installer cutoff admitted; ordinary caller, wrong context, rebuy edits and other cutoffs remain refused')

        # Compare whole persisted rows; the allowed difference is exactly the
        # registration level and its literal description, never rebuy/addon.
        for before in json.loads(sql("SELECT jsonb_agg(row) FROM before_ten")):
            expected=dict(before)
            if before['club_id']==scope and before['buy_in_amount']+before['buy_in_fee']>=25 and before['late_reg_levels']==12 and before['status'] not in ['COMPLETED','COMPLETING','CANCELLED','CANCELED','FAILED']:
                expected['late_reg_levels']=10
                if expected['short_description'] is not None: expected['short_description']=expected['short_description'].replace('Late Registration Through Level 12.','Late Registration Through Level 10.')
            actual=json.loads(sql("SELECT to_jsonb(t) FROM tournaments t WHERE id='"+before['id']+"'"))
            assert actual==expected,(before['name'],{k:(before[k],actual[k]) for k in before if before[k]!=actual[k]})
        for event in document['events']:
            assert sql("SELECT config->'midwayWeeklyTerms'->>'late_reg_levels' FROM tournament_schedules WHERE id='"+event['id']+"'")==str(event['terms']['late_reg_levels']),event['name']
        # Generic stored boundary covers exact25 (22.5+2.5), higher prices,
        # running games, and preservation of other caps, terminal and diamonds.
        for total,cap,status,asset,want in [(25,12,'REGISTERING','chips',10),(24,12,'REGISTERING','chips',12),(100,12,'RUNNING','chips',10),(25,6,'RUNNING','chips',6),(25,0,'RUNNING','chips',0),(25,12,'COMPLETED','chips',12),(25,12,'RUNNING','diamonds',12)]:
            row=dict(buy_in_amount=total*.9,buy_in_fee=total*.1,late_reg_levels=cap,status=status,club_id=scope if asset=='chips' else '99999999-9999-4999-8999-999999999999',rebuy_levels=12,late_reg_mins=96,short_description='Original')
            encoded=json.dumps(row).replace("'","''")
            actual=json.loads(sql("SELECT to_jsonb(fn_ca_ten_level_late_registration(jsonb_populate_record(NULL::tournaments,'"+encoded+"'::jsonb)))"))
            assert actual['late_reg_levels']==want,(row,actual)
            assert actual['rebuy_levels']==12 and actual['late_reg_mins']==96 and actual['short_description']=='Original'
        insert_event('91000000-0000-4000-8000-000000000001',target['id'])
        assert sql("SELECT late_reg_levels=10 AND rebuy_levels=12 FROM tournaments WHERE id='91000000-0000-4000-8000-000000000001'")=='t'
        sql("UPDATE tournaments SET is_rebuy=is_rebuy WHERE id='91000000-0000-4000-8000-000000000001'")
        assert sql("SELECT late_reg_levels=10 AND rebuy_levels=12 FROM tournaments WHERE id='91000000-0000-4000-8000-000000000001'")=='t'
        print('PASS: twelve to ten at total25; all other persisted event/schedule fields, lower prices, currencies, other caps and terminal records preserved; future insert and repeated write keep rebuy12')
        # Apply the revised opening against all 143 real catalog definitions.
        # Install the serving normalizers. The old repeated 50/100 opener
        # shortened the effective registration window to nine levels.
        migrations=root/'supabase/migrations'
        strip=next(migrations.glob('*record_strip_repeated_blind_levels_applied_directly.sql')).read_text()
        sql(strip[strip.index('CREATE OR REPLACE FUNCTION'):strip.index('CREATE OR REPLACE FUNCTION public.fn_ca_schedule_level_clock_floor')])
        clocks=next(migrations.glob('*freebuy_rebuy_cutoff_and_rebuild_storm_resolution.sql')).read_text()
        sql(clocks[clocks.index('CREATE OR REPLACE FUNCTION'):clocks.index('DO $backfill_rebuy_cutoff$')])
        sql("UPDATE tournament_schedules SET config=config WHERE (config->>'buyIn')::numeric IN (35,40)")
        assert sql("SELECT count(*) FROM tournament_schedules WHERE (config->>'buyIn')::numeric IN (35,40) AND config->>'lateRegistrationLevels'='9'")=='4'
        sql("CREATE TABLE before_opening AS SELECT id,config FROM tournament_schedules")
        opening=next((root/'supabase/migrations').glob('*midway_35_40_chip_mtt_opening.sql'))
        sql(installer(opening.read_text()))
        changed=sql("SELECT count(*) FROM tournament_schedules s JOIN before_opening b USING(id) WHERE s.config IS DISTINCT FROM b.config")
        assert changed=='4',changed
        for event in document['events']:
            if event['config']['buyIn'] not in (35,40):
                continue
            new_id=event['id']
            row_id=sql("SELECT gen_random_uuid()")
            insert_event(row_id,new_id)
            actual=json.loads(sql("SELECT to_jsonb(t) FROM tournaments t WHERE id='"+row_id+"'"))
            assert actual['starting_chips']==15000 and actual['short_description']==event['terms']['short_description']
            assert actual['late_reg_levels']==10 and actual['late_reg_mins']==0
            assert json.loads(actual['blind_structure'])==document['profiles'][event['blindProfile']]
        print('PASS: four revised schedules spawn 15,000 at 25/50 with every subsequent level preserved')
        # Dan 2026-11-11: the 7 PM Nightly 10K guarantees 20K. Before the
        # migration: one open instance nobody entered, one with an entrant.
        nightly=target['id']
        open_id,held_id='92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002'
        for event_id in (open_id,held_id):
            insert_event(event_id,nightly)
        sql("UPDATE tournaments SET start_time=now()+interval '1 day' WHERE id IN ('"+open_id+"','"+held_id+"')")
        sql("INSERT INTO tournament_players(id,tournament_id) VALUES(gen_random_uuid(),'"+held_id+"')")
        assert sql("SELECT string_agg(trim_scale(guaranteed_prize)::text,',' ORDER BY id) FROM tournaments WHERE id IN ('"+open_id+"','"+held_id+"')")=='10000,10000'
        sql("DROP TABLE IF EXISTS before_nightly; CREATE TABLE before_nightly AS SELECT id,config FROM tournament_schedules")
        nightly_sql=next((root/'supabase/migrations').glob('*nightly_10k_guarantees_20k.sql')).read_text()
        sql(installer(nightly_sql))
        changed=sql("SELECT string_agg(s.id::text,',') FROM tournament_schedules s JOIN before_nightly b USING(id) WHERE s.config IS DISTINCT FROM b.config")
        assert changed==nightly,changed
        assert sql("SELECT (config->>'guaranteedPrize')||','||(config#>>'{midwayWeeklyTerms,guaranteed_prize}')||','||name||','||start_times_utc[1] FROM tournament_schedules WHERE id='"+nightly+"'")=='20000,20000,Nightly 10K (NLH),19:00'
        assert sql("SELECT (b.config::jsonb-'guaranteedPrize'-'midwayWeeklyTerms')=(s.config::jsonb-'guaranteedPrize'-'midwayWeeklyTerms') AND ((b.config::jsonb->'midwayWeeklyTerms')-'guaranteed_prize')=((s.config::jsonb->'midwayWeeklyTerms')-'guaranteed_prize') FROM tournament_schedules s JOIN before_nightly b USING(id) WHERE s.id='"+nightly+"'")=='t'
        assert sql("SELECT string_agg(trim_scale(guaranteed_prize)::text,',' ORDER BY id) FROM tournaments WHERE id IN ('"+open_id+"','"+held_id+"')")=='20000,10000'
        spawned=sql("SELECT gen_random_uuid()")
        insert_event(spawned,nightly)
        assert sql("SELECT trim_scale(guaranteed_prize)::text||','||(fn_ca_midway_weekly_terms(t.schedule_id)->>'guaranteed_prize') FROM tournaments t WHERE id='"+spawned+"'")=='20000,20000'
        # The catalog document carries the same guarantee as the installed catalog.
        assert target['config']['guaranteedPrize']==20000 and target['terms']['guaranteed_prize']==20000
        try: sql(installer(nightly_sql))
        except RuntimeError as error: assert 'changed since qualification' in str(error),str(error)
        else: raise AssertionError('a second install of the Nightly 20K migration was not refused')
        print('PASS: Nightly 10K guarantees 20,000 on its schedule, new spawns and unentered instances; an entered instance keeps its contract')
        # Execute the maintained snapshot against this production-shaped schema.
        # Empty read inputs do not emulate cancellation or certify a refund.
        sql("""ALTER TABLE tournament_players ADD COLUMN IF NOT EXISTS user_id uuid;
         CREATE TABLE tournament_refund_entitlements(id uuid,tournament_id uuid,user_id uuid,gross numeric,entitlement_kind text);
         CREATE TABLE tournament_refund_tranches(entitlement_id uuid);
         CREATE TABLE tournament_tickets(source_refund_entitlement_id uuid);""")
        snapshot_sql=(root/'scripts/tournament-schedules/midway-live-snapshot.sql').read_text()
        snapshot=json.loads(sql('BEGIN READ ONLY;'+snapshot_sql+'COMMIT;'))
        assert len(snapshot['events'])==143
        assert len(snapshot['statuses'])==378
        assert datetime.fromisoformat(snapshot['asOf']).tzinfo is not None
        assert snapshot['occurrences'] and all(o['refundAuthorityVerified'] is False for o in snapshot['occurrences'])
        assert all(o['cancellationRefundStatus']=='requires_exact_authority' for o in snapshot['occurrences'])
        print('PASS: maintained snapshot executes read-only with 143 definitions, 378 statuses, timestamp and explicitly unverified refund authority')
        print('PASS: exact production defaults/NOT NULL/CHECKs and creation normalizers enforce invalid inputs, admission state, actual capacity and all 143 weekly contracts')
        print('PASS: legacy drift reproduced; all 143 canonical insert contracts, 378 weekly starts, creator overwrite, actual table blinds, unrelated-club isolation, running-game preservation and operator protection verified')
    finally:
        run('pg_ctl','-D',str(path/'data'),'-m','immediate','stop')
