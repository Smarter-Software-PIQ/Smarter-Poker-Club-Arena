#!/usr/bin/env python3
"""Native PG17 proof of the real opening/clock triggers, with isolated rows.

Captured clock and lifecycle functions are real production definitions. The
registered-event guard and its read-only helpers execute on typed synthetic rows.
Settlement/cancellation and full RLS are outside this fixture; no production connection accepted.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'scripts/qualification/fixtures/tournament-opening-blinds'
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
BASE = Path(os.environ.get('TMPDIR') or tempfile.gettempdir())
if sys.platform == 'darwin' and not str(BASE).startswith('/Volumes/SmarterWork/agent-work/'):
    raise RuntimeError('Use task-owned external SSD scratch')
ENV = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
MIGRATION = ROOT / 'supabase/migrations/20261106011202_tournaments_open_at_twenty_five_fifty.sql'


def literal(value):
    return "'" + json.dumps(value).replace("'", "''") + "'"


def main():
    with tempfile.TemporaryDirectory(prefix='ob-', dir=BASE) as folder:
        d = Path(folder)
        sock = d / 's'
        sock.mkdir()

        def command(args):
            r = subprocess.run([str(v) for v in args], env=ENV, text=True, capture_output=True)
            if r.returncode:
                raise RuntimeError(r.stdout + r.stderr)
            return r.stdout

        command([PG/'initdb', '-D', d/'db', '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
        command([PG/'pg_ctl', '-D', d/'db', '-l', d/'log', '-o',
                 f"-k {sock} -p 55491 -c listen_addresses='' -c shared_buffers=16MB", '-w', 'start'])

        def sql(text, error=None):
            r = subprocess.run([str(PG/'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                                '-h', str(sock), '-p', '55491', '-U', 'postgres', '-d', 'postgres'],
                               input=text, env=ENV, text=True, capture_output=True)
            if error:
                assert r.returncode and error in r.stderr, r.stderr
            else:
                assert r.returncode == 0, r.stderr
            return r.stdout.strip()

        def snapshot():
            return sql("SELECT jsonb_build_object('events',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM tournaments t),'schedules',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM tournament_schedules s),'tables',(SELECT jsonb_agg(to_jsonb(tb) ORDER BY id) FROM tables tb));")

        ladder = [dict(level=1, smallBlind=25, bigBlind=25, ante=0, durationMinutes=8),
                  dict(level=2, smallBlind=25, bigBlind=50, ante=0, durationMinutes=8),
                  dict(level=3, smallBlind=50, bigBlind=100, ante=10, durationMinutes=8)]
        expected = [dict(ladder[0], bigBlind=50), *ladder[1:]]
        spin = [dict(level=1, smallBlind=10, bigBlind=20, ante=0, durationMinutes=5),
                dict(level=2, smallBlind=15, bigBlind=30, ante=0, durationMinutes=5)]

        def add(kind, variant, status='REGISTERING', structure=None, started=False):
            return sql(f"INSERT INTO tournaments(tournament_type,variant,status,blind_structure,started_at) VALUES('{kind}','{variant}','{status}',{literal(structure or ladder)},{'now()' if started else 'NULL'}) RETURNING id;")

        try:
            sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
CREATE TABLE clubs(id uuid PRIMARY KEY, lifecycle_status text, asset text DEFAULT 'chips', is_platform boolean DEFAULT false);
CREATE TABLE tournaments(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, club_id uuid,
 tournament_type text, variant text, status text, started_at timestamptz, current_level int DEFAULT 0,
 blind_level_state jsonb, blind_structure text, buy_in_amount numeric(15,2) DEFAULT 10, buy_in_fee numeric(15,2) DEFAULT 0,
 name text DEFAULT 'Regular', is_bounty boolean DEFAULT false, is_pko boolean DEFAULT false,
 is_mystery_bounty boolean DEFAULT false, bounty_amount numeric DEFAULT 0, is_pinned boolean DEFAULT false,
 late_reg_levels int DEFAULT 2, late_reg_mins int DEFAULT 16, rebuy_levels int DEFAULT 2,
 prize_pool numeric(18,2) DEFAULT 0, guaranteed_prize numeric(15,2) DEFAULT 0,
 bounty_pool numeric(18,2) DEFAULT 0, prize_pool_finalized boolean DEFAULT false,
 is_rebuy boolean DEFAULT false, addon_break_minutes integer DEFAULT 1,
 payout_structure text DEFAULT '[]', payout_depth_percent numeric(5,2), payout_percent smallint,
 satellite_target_id uuid, satellite_target uuid, is_premium_spin boolean DEFAULT false);
CREATE TABLE tournament_players(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, tournament_id uuid);
CREATE TABLE chip_ledger(idempotency_key text,tournament_id uuid,category text,amount numeric,
 from_type text,from_entity_id uuid,to_type text,to_entity_id uuid,metadata jsonb);
CREATE TABLE tables(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, tournament_id uuid, status text DEFAULT 'waiting', is_deleted boolean DEFAULT false, small_blind numeric, big_blind numeric, ante numeric DEFAULT 0, stakes text, hands_dealt int DEFAULT 0);
CREATE TABLE tournament_schedules(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 club_id uuid, active boolean DEFAULT true, config jsonb);
GRANT INSERT, SELECT, UPDATE ON tournaments,tournament_schedules TO authenticated,service_role;
GRANT SELECT ON tournament_players,chip_ledger,clubs TO authenticated,service_role;''')
            sql((FIXTURE/'clock-dependencies.sql').read_text())
            for definition in json.loads((FIXTURE/'preimage.json').read_text()).values():
                sql(definition+';')
            sql('''CREATE TRIGGER tournaments_lock_level_clock BEFORE INSERT OR UPDATE OF blind_structure
 ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_ca_tournament_lock_level_clock();
CREATE TRIGGER tournament_schedule_level_clock_floor BEFORE INSERT OR UPDATE OF config
 ON tournament_schedules FOR EACH ROW EXECUTE FUNCTION fn_ca_schedule_level_clock_floor();
CREATE TRIGGER tournament_table_inherits_committed_blinds BEFORE INSERT ON tables
 FOR EACH ROW EXECUTE FUNCTION fn_tournament_table_inherits_committed_blinds();''')
            capture = json.loads((FIXTURE/'lifecycle-guard-capture.json').read_text())
            definitions = {row['signature']: row for row in capture['functions']}
            for signature in ['auth.role()', 'fn_ca_text_without_dollar(text)',
                              'fn_ca_diamond_guarantee_copy(text)', 'fn_safe_jsonb_array(text)',
                              'fn_ca_midway_free_buy_conversion_transition(jsonb,jsonb)',
                              'fn_ca_effective_payout_depth(numeric,smallint)',
                              'fn_ca_payout_structure(integer,numeric)',
                              'fn_ca_provisional_payout_structure(uuid)', 'fn_guard_managed_game_lifecycle()']:
                definition = definitions[signature]
                sql(definition['definition']+';')
                assert sql(f"SELECT md5(pg_get_functiondef('{signature}'::regprocedure));") == definition['definition_md5']
            for trigger in capture['triggers']:
                sql(trigger['definition']+';')
            assert sql("SELECT count(*) FROM pg_trigger WHERE tgname='trg_tournaments_managed_lifecycle_guard' AND tgenabled='O';") == '1'
            affected = [add('MTT', v) for v in ['freezeout', 'bounty', 'progressive_bounty', 'mystery_bounty', 'satellite', 'rebuy']]
            affected += [add('SNG', 'sng', structure=spin), add('SATELLITE', 'satellite')]
            untouched = [add('SPIN', 'spin', structure=spin), add('MTT', 'spin', structure=spin),
                         add('MTT', 'freezeout', 'RUNNING', started=True), add('SNG', 'sng', 'COMPLETED', started=True),
                         add('SNG', 'sng', started=True)]
            sql(f"INSERT INTO tournament_schedules(config) VALUES({literal({'type':'mtt','blindStructure':ladder})}::jsonb),({literal({'type':'sng','blindStructure':ladder})}::jsonb),({literal({'type':'spin','blindPreset':'TURBO','blindStructure':spin})}::jsonb);")
            sql("INSERT INTO tables(tournament_id,small_blind,big_blind) SELECT id,(blind_structure::jsonb->0->>'smallBlind')::numeric,(blind_structure::jsonb->0->>'bigBlind')::numeric FROM tournaments;")
            sql("INSERT INTO tournament_players(tournament_id) SELECT id FROM tournaments;")
            before=json.loads(snapshot())
            assert all(json.loads(t['blind_structure'])[0]['bigBlind'] in (20,25) for t in before['events'])
            print('PASS preimage reproduces 25/25 MTTs and 10/20 SNGs', flush=True)
            missing_admission = MIGRATION.read_text().replace("SET LOCAL app.lock_level_clock='on';", '')
            sql(missing_admission, 'This tournament cannot be modified after a player has registered')
            assert json.loads(snapshot()) == before
            assert sql("SELECT to_regprocedure('public.fn_ca_tournament_opening_blinds(text)') IS NULL;") == 't'
            print('PASS actual registered-event lifecycle guard rejects missing admission and rolls back the whole migration', flush=True)
            sql(MIGRATION.read_text())
            after=json.loads(snapshot())
            for old,new in zip(before['events'],after['events']):
                if str(old['id']) in untouched:
                    assert new==old,(old,new)
                else:
                    assert {k:v for k,v in old.items() if k!='blind_structure'}=={k:v for k,v in new.items() if k!='blind_structure'}
                    rows=json.loads(new['blind_structure'])
                    assert (rows[0]['smallBlind'],rows[0]['bigBlind'])==(25,50)
                    assert len(rows)==len(json.loads(old['blind_structure']))
            for old,new in zip(before['tables'],after['tables']):
                if str(old['tournament_id']) in untouched:
                    assert old==new,(old,new)
                else:
                    assert new==dict(old,small_blind=25,big_blind=50,stakes='25/50'),(old,new)
            assert after['schedules'][2]==before['schedules'][2]
            for row in after['schedules'][:2]:
                assert row['config']['blindStructure']==expected
            print('PASS transition changes only unstarted MTT/SNG blinds; Spins and played events unchanged',flush=True)
            state=snapshot()
            sql(MIGRATION.read_text())
            assert snapshot()==state
            print('PASS repeat installation is idempotent',flush=True)
            for kind,variant in [('MTT','freezeout'),('SNG','sng'),('SATELLITE','satellite')]:
                event=add(kind,variant)
                assert json.loads(sql(f"SELECT blind_structure FROM tournaments WHERE id='{event}'::uuid;"))==expected
                assert sql(f"INSERT INTO tables(tournament_id,small_blind,big_blind) VALUES('{event}'::uuid,10,20) RETURNING stakes;")=='25/50'
            event=add('SPIN','spin',structure=spin)
            assert json.loads(sql(f"SELECT blind_structure FROM tournaments WHERE id='{event}'::uuid;"))==spin
            assert sql(f"INSERT INTO tables(tournament_id,small_blind,big_blind) VALUES('{event}'::uuid,10,20) RETURNING stakes;")=='10/20'
            assert sql("INSERT INTO tables(small_blind,big_blind,stakes) VALUES(1,2,'1/2') RETURNING stakes;")=='1/2'
            print('PASS real insert trigger enforces new MTT/SNG openings and leaves new Spins alone',flush=True)
            event=affected[0]
            sql(f"SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false); UPDATE tournaments SET blind_structure={literal(ladder)} WHERE id='{event}'::uuid;")
            assert json.loads(sql(f"SELECT blind_structure FROM tournaments WHERE id='{event}'::uuid;"))==expected
            sql(f"SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false); UPDATE tournaments SET blind_structure={literal(ladder)} WHERE id='{event}'::uuid;")
            assert json.loads(sql(f"SELECT blind_structure FROM tournaments WHERE id='{event}'::uuid;"))==expected
            print('PASS authenticated/service writers cannot reinstate 25/25',flush=True)
            sql(f"BEGIN; SET LOCAL app.lock_level_clock='on'; UPDATE tournaments SET buy_in_amount=buy_in_amount+1 WHERE id='{event}'::uuid; COMMIT;", 'This tournament cannot be modified after a player has registered')
            assert sql(f"SELECT buy_in_amount FROM tournaments WHERE id='{event}'::uuid;") == '10.00'
            print('PASS clock admission cannot alter registered buy-in terms', flush=True)
            for opening in [(10,20),(25,25),(25,50),(50,100)]:
                rows=[dict(ladder[0],smallBlind=opening[0],bigBlind=opening[1]),*ladder[1:]]
                result=json.loads(sql(f"SELECT fn_ca_tournament_opening_blinds({literal(rows)});"))
                assert result==expected
            breaks=[ladder[0],dict(level=2,smallBlind=0,bigBlind=0,ante=0,isBreak=True,durationMinutes=5),ladder[2]]
            assert json.loads(sql(f"SELECT fn_ca_tournament_opening_blinds({literal(breaks)});"))==[dict(breaks[0],bigBlind=50),*breaks[1:]]
            sql("SELECT fn_ca_tournament_opening_blinds('[{\"smallBlind\":25,\"bigBlind\":0}]');",'invalid blinds')
            sql("SET ROLE anon; SELECT fn_ca_tournament_opening_blinds('[]');",'permission denied')
            print('PASS bounds, invalid input, breaks, exact level clocks and helper permissions',flush=True)
        finally:
            command([PG/'pg_ctl','-D',d/'db','-m','immediate','-w','stop'])


if __name__ == '__main__':
    main()
