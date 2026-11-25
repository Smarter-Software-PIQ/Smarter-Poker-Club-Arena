#!/usr/bin/env python3
"""AN OWED MAIN STARTS BEFORE AN EXTRA TABLE (20261124072701), proved on a disposable PostgreSQL.

Production's recorded bodies, rebuilt from the repository exactly as they were
installed, through the same chain scripts/ci/test-a-called-name-keeps-its-place-postgres.py
builds (its fixture schema is read from that file, not copied): the hourly cash
policy (20261116153902, 20261116194028), the throughput cohort producer, the
seat call chain, the feeder opener's question as 20261121174545 installed it,
then 20261123013241 (the admission production runs today). The roster seat
guard runs the admission on every seat insert, so a Horse starting a Main 1 is
refused or admitted by production's own fn_cash_hourly_table_admit.

The cluster tick is not rebuilt: it is simulated by the one question it asks
before it opens an extra table, fn_cash_hourly_feeder_admissible(game), and by
what it writes when the answer is yes (an empty 'opening' feeder). The Horse
fleet is simulated by its heartbeat row (detail.variety_owed_games) and by the
seat insert its walk makes at an owed Main 1.

Every scenario runs on the installed body, where it must reproduce the defect
(red), and after the migration, where it must not (green). No production
connection is made and no production row is read or written.
"""
import ast, json, os, pathlib, shutil, subprocess, tempfile

P = pathlib.Path
ROOT = P(__file__).resolve().parents[2]
MIG = ROOT / 'supabase/migrations'
FIX = ROOT / 'scripts/ci/fixtures'
CANDIDATE = MIG / '20261124072701_an_owed_main_starts_before_an_extra_table.sql'
SIBLING = ROOT / 'scripts/ci/test-a-called-name-keeps-its-place-postgres.py'
INSTALLED_MD5 = 'a7f507e81cdf5e6005ae94405481a8e6'
if os.environ.get('PG_BIN'):
    PG = P(os.environ['PG_BIN'])
elif os.uname().sysname == 'Darwin':
    PG = P('/opt/homebrew/opt/postgresql@17/bin')
else:
    installed = sorted(P('/usr/lib/postgresql').glob('*/bin'),
                       key=lambda p: int(p.parent.name) if p.parent.name.isdigit() else -1, reverse=True)
    PG = next((p for p in [P('/usr/lib/postgresql/17/bin'), *installed] if (p / 'initdb').is_file()), None)
    if PG is None:
        raise SystemExit('PostgreSQL server binaries unavailable; provide PG_BIN')
parent = P(os.environ.get('TMPDIR', str(ROOT / 'work')))
parent.mkdir(exist_ok=True)
w = P(tempfile.mkdtemp(prefix='owed-', dir=parent))
sock = w / 's'
sock.mkdir()
env = {'PATH': str(PG) + ':/usr/bin:/bin', 'LC_ALL': 'C', 'LANG': 'C'}
passed = []
failed = []
# 'prove' (default, CI): red on the installed body, then green after the migration.
# 'installed-only': hold the INSTALLED body to the fixed expectations and report
# every one it breaks (exit 1); the migration is never applied.
MODE = os.environ.get('OWED_MAIN_MODE', 'prove')


def run(args, sql=None):
    r = subprocess.run([str(x) for x in args], input=sql, text=True, capture_output=True, env=env, timeout=90)
    if r.returncode:
        raise RuntimeError(r.stdout + r.stderr)
    return r.stdout.strip()


def q(sql):
    return run([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-U', 'postgres', '-d', 'postgres'], sql)


def check(ok, label):
    if not ok:
        if MODE == 'installed-only':
            failed.append(label)
            print('FAIL', label, flush=True)
            return
        raise AssertionError(label)
    passed.append(label)
    print('PASS', label, flush=True)


def attempt(sql):
    try:
        q(sql)
        return None
    except RuntimeError as e:
        return str(e)


def function_block(path, name, terminator):
    text = path.read_text()
    start = text.index('CREATE OR REPLACE FUNCTION public.' + name + '(')
    end = text.index(terminator, start) + len(terminator)
    return text[start:end]


def sibling_schema():
    """The fixture schema the called-name proof builds, read from that file."""
    tree = ast.parse(SIBLING.read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, 'id', None) == 'SCHEMA' for t in node.targets):
            return ast.literal_eval(node.value)
    raise SystemExit('SCHEMA not found in ' + str(SIBLING))


def uid(label):
    return q(f"SELECT md5('{label}')::uuid;")


CLUB = 'c1000000-0000-4000-8000-000000000001'
HEARTBEAT = '''
CREATE TABLE ca_horse_fleet_heartbeat(id bigserial PRIMARY KEY,beat_at timestamptz NOT NULL DEFAULT now(),cycle_ms integer,
  horses_total integer,horses_seated integer,horses_idle integer,horses_stuck integer,tables_seen integer,tables_seeded integer,
  seats_filled integer,seats_released integer,policy_version timestamptz,degraded boolean,detail jsonb);
CREATE INDEX ca_horse_fleet_heartbeat_beat_at_idx ON ca_horse_fleet_heartbeat(beat_at DESC);
'''


def reset():
    q("""TRUNCATE tables,table_seats,table_waitlist,cash_game_waitlist,notifications,cash_seat_moves,cash_games,
           cash_hourly_table_starts,cash_hourly_table_origins,profiles,ca_horse_active_roster,ca_horse_fleet_heartbeat;
         UPDATE cash_hourly_table_pacing SET enabled_instance_id='engine',next_open_at='-infinity',next_close_at='-infinity';""")
    q(f"INSERT INTO clubs(id) VALUES('{CLUB}') ON CONFLICT DO NOTHING;")


def horses(prefix, n):
    q(f"""INSERT INTO profiles(id,is_horse) SELECT md5('{prefix}'||i)::uuid,true FROM generate_series(1,{n}) i;
          INSERT INTO ca_horse_active_roster SELECT md5('{prefix}'||i)::uuid FROM generate_series(1,{n}) i;""")


def floor_of_other_tables(n):
    """n other horse tables already counted against the cap (a deep game's Mains)."""
    if n <= 0:
        return
    horses('other', n)
    q(f"""ALTER TABLE table_seats DISABLE TRIGGER roster_guard;
          INSERT INTO tables(id,name,club_id,created_at,status) SELECT md5('othertable'||i)::uuid,'Other '||i,'{CLUB}',
                 clock_timestamp()-interval '3 hours'+i*interval '1 second','running' FROM generate_series(1,{n}) i;
          INSERT INTO table_seats(table_id,user_id,seat_number)
                 SELECT md5('othertable'||i)::uuid,md5('other'||i)::uuid,1 FROM generate_series(1,{n}) i;
          ALTER TABLE table_seats ENABLE TRIGGER roster_guard;""")


def free_one_slot(i):
    """One of the other tables breaks: its last seat leaves and a slot frees."""
    q(f"UPDATE table_seats SET left_at=clock_timestamp() WHERE table_id=md5('othertable{i}')::uuid AND left_at IS NULL;")


def deep_game(game):
    """A full nine-handed game holding a table, with four Horses on its list (#11773)."""
    main = uid(game + ':main')
    horses(game + 'seat', 9)
    horses(game + 'list', 4)
    q(f"""INSERT INTO cash_games(id,club_id,variant,sb,bb) VALUES('{uid(game)}','{CLUB}','nlh',1,2);
          ALTER TABLE table_seats DISABLE TRIGGER roster_guard;
          INSERT INTO tables(id,name,club_id,cluster_id,max_players,created_at,status,role,main_index)
                 VALUES('{main}','Main 1','{CLUB}','{uid(game)}',9,clock_timestamp()-interval '2 hours','running','main',1);
          INSERT INTO table_seats(table_id,user_id,seat_number,joined_at)
                 SELECT '{main}',md5('{game}seat'||i)::uuid,i,clock_timestamp()-interval '1 hour' FROM generate_series(1,9) i;
          ALTER TABLE table_seats ENABLE TRIGGER roster_guard;
          INSERT INTO cash_game_waitlist(game_id,user_id,status)
                 SELECT '{uid(game)}',md5('{game}list'||i)::uuid,'waiting' FROM generate_series(1,4) i;""")
    return main


def dark_game(game, variant='short_deck', enabled=True):
    """An enabled plan game with no table dealing: an empty Main 1 waits."""
    main = uid(game + ':main')
    q(f"""INSERT INTO cash_games(id,club_id,variant,sb,bb,enabled) VALUES('{uid(game)}','{CLUB}','{variant}',0.5,1,{str(enabled).lower()});
          INSERT INTO tables(id,name,club_id,cluster_id,max_players,status,role,main_index,game_variant)
                 VALUES('{main}','Main 1','{CLUB}','{uid(game)}',6,'waiting','main',1,'{variant}');""")
    return main


def beat(owed, age_seconds=5):
    q(f"""INSERT INTO ca_horse_fleet_heartbeat(beat_at,detail)
          VALUES(clock_timestamp()-interval '{age_seconds} seconds',
                 jsonb_build_object('reason',null,'variety_owed_games',{owed}));""")


def owed_list(*games):
    return "'" + json.dumps([uid(g) for g in games]) + "'::jsonb"


def admissible(game):
    return q(f"SELECT public.fn_cash_hourly_feeder_admissible('{uid(game)}');") == 't'


def tick_opens_feeder(game, n):
    """What the tick writes when the opener says yes: an empty 'opening' feeder."""
    feeder = uid(f'{game}:feeder{n}')
    q(f"""INSERT INTO tables(id,name,club_id,cluster_id,max_players,status,lifecycle,role,main_index)
          VALUES('{feeder}','Feeder','{CLUB}','{uid(game)}',9,'waiting','opening','feeder',NULL);""")
    return feeder


def horse_starts(table, who):
    """The fleet's walk: one Horse sits at an empty owed Main 1 (an unsolicited start)."""
    horses(who, 1)
    q("UPDATE cash_hourly_table_pacing SET next_open_at='-infinity' WHERE scope='floor';")
    return attempt(f"INSERT INTO table_seats(table_id,user_id,seat_number) VALUES('{table}',md5('{who}1')::uuid,1);")


def floor_clock_passes():
    """The 2-4 minute floor clock a start set has run out."""
    q("UPDATE cash_hourly_table_pacing SET next_open_at='-infinity' WHERE scope='floor';")


def census():
    return int(q('SELECT count(*) FROM public.fn_cash_hourly_table_capacity_census();'))


def cap():
    return int(q('SELECT table_cap FROM public.fn_cash_hourly_table_range();'))


def scenario_freed_slot(fixed):
    """Cap full: deep game A holds a table and a Horse list, Short Deck B has none.
    A slot frees. The tick asks first (5 s), the fleet walks after (30 s)."""
    tag = 'fixed' if fixed else 'installed'
    reset()
    c = cap()
    deep_game('a')
    floor_of_other_tables(c - 1)
    b_main = dark_game('b')
    check(census() == c, f'[{tag}] the floor holds {c} of {c} counted tables')
    beat(owed_list('b'))
    check(not admissible('a'), f'[{tag}] at a full cap no extra table opens')
    full = horse_starts(b_main, 'bstartfull')
    check(full is not None and 'cash_hourly_table_cap_reached' in full, f'[{tag}] nor can Short Deck start at a full cap')
    free_one_slot(1)
    check(census() == c - 1, f'[{tag}] one slot frees')
    a_ok = admissible('a')
    if a_ok:
        tick_opens_feeder('a', 1)
    start = horse_starts(b_main, 'bstart')
    if not fixed:
        check(a_ok, "[installed] the tick opens A's waiting-list feeder on the freed slot (red)")
        check(start is not None and 'cash_hourly_table_cap_reached' in start,
              "[installed] so Short Deck's owed Main 1 is refused at the cap: it never starts (red)")
        return
    check(not a_ok, "[fixed] the tick does not open A's extra table while Short Deck is owed the slot")
    check(start is None, "[fixed] Short Deck's owed Main 1 takes the freed slot: a Horse sits")
    check(census() == c, '[fixed] and the floor is exactly at its cap again, never over it')
    check(q(f"SELECT count(*) FROM cash_game_waitlist WHERE game_id='{uid('a')}' AND status='waiting';") == '4',
          "[fixed] A keeps its whole waiting list (#11773): only the extra table waited")
    # Short Deck now holds a table, so it is no longer owed; the next freed slot is A's.
    free_one_slot(2)
    floor_clock_passes()
    check(admissible('a'), "[fixed] once nothing is owed, the next freed slot opens A's waiting-list feeder (#11773 depth)")


def scenario_no_owed_game(fixed):
    """No game is owed a start: the opener answers exactly as it did before."""
    tag = 'fixed' if fixed else 'installed'
    reset()
    c = cap()
    deep_game('a')
    floor_of_other_tables(c - 1)
    free_one_slot(1)
    check(admissible('a'), f'[{tag}] no heartbeat at all: the freed slot opens the waiting-list feeder')
    beat("'[]'::jsonb")
    check(admissible('a'), f'[{tag}] an empty owed list: the feeder opens')
    dark_game('b')
    beat(owed_list('b'), age_seconds=100)
    check(admissible('a'), f'[{tag}] a stale heartbeat (100 s) holds nothing: the feeder opens')
    for label, owed in [('a string', "'\"x\"'::jsonb"), ('an object', "'{\"b\":1}'::jsonb"),
                        ('non-uuid entries', "'[1, \"nope\", null, {\"k\": 2}]'::jsonb"), ('null', "'null'::jsonb")]:
        beat(owed)
        check(admissible('a'), f'[{tag}] a malformed owed list ({label}) is read as none and never raises')
    beat(owed_list('a'))
    check(admissible('a'), f'[{tag}] a game is never owed its own slot')
    q(f"UPDATE cash_games SET enabled=false WHERE id='{uid('b')}';")
    beat(owed_list('b'))
    check(admissible('a'), f'[{tag}] a switched-off game is not owed a start')
    q(f"UPDATE cash_games SET enabled=true WHERE id='{uid('b')}';")
    horses('bseated', 1)
    q(f"""ALTER TABLE table_seats DISABLE TRIGGER roster_guard;
          INSERT INTO table_seats(table_id,user_id,seat_number) VALUES('{uid('b:main')}',md5('bseated1')::uuid,1);
          ALTER TABLE table_seats ENABLE TRIGGER roster_guard;""")
    free_one_slot(2)
    beat(owed_list('b'))
    check(census() == c - 1 and admissible('a'),
          f'[{tag}] a listed game that already holds an occupied table is not owed')


def scenario_every_owed_start_must_fit(fixed):
    """Two owed games: an extra table opens only if both still fit after it."""
    tag = 'fixed' if fixed else 'installed'
    reset()
    c = cap()
    deep_game('a')
    floor_of_other_tables(c - 1)
    dark_game('b')
    dark_game('c', 'pineapple')
    beat(owed_list('b', 'c'))
    free_one_slot(1)
    free_one_slot(2)
    two_free = admissible('a')
    free_one_slot(3)
    three_free = admissible('a')
    if not fixed:
        check(two_free, '[installed] two slots free, two games owed: the extra table opens anyway (red)')
        return
    check(not two_free, '[fixed] two slots free, two games owed: the extra table waits')
    check(three_free, '[fixed] three slots free, two games owed: the extra table opens, both starts still fit')


def scenario_person_on_the_line(fixed):
    tag = 'fixed' if fixed else 'installed'
    reset()
    c = cap()
    deep_game('a')
    floor_of_other_tables(c - 1)
    dark_game('b')
    beat(owed_list('b'))
    person = uid('person1')
    q(f"""INSERT INTO profiles(id,is_horse) VALUES('{person}',false);
          INSERT INTO cash_game_waitlist(game_id,user_id,status) VALUES('{uid('a')}','{person}','waiting');""")
    check(admissible('a'), f'[{tag}] a person on the line still opens the table at a full cap with a game owed (never gated)')


try:
    run([PG / 'initdb', '-D', w / 'd', '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'])
    run([PG / 'pg_ctl', '-D', w / 'd', '-l', w / 'pg.log', '-o', f"-h '' -k {sock}", '-w', 'start'])
    q(sibling_schema())
    q(HEARTBEAT)
    for fixture in ['hourly-cash-caps/roster.sql', 'hourly-cash-caps/lightning-legality.sql', 'unattended-offer-preimage.sql']:
        q((FIX / fixture).read_text())
    q('CREATE TRIGGER roster_guard BEFORE INSERT OR UPDATE OF user_id,table_id,left_at ON table_seats '
      'FOR EACH ROW WHEN(NEW.left_at IS NULL) EXECUTE FUNCTION fn_ca_horse_roster_seat_guard();')
    for name in ['20261116153902_enforce_owner_hourly_cash_table_caps_with_human_expansion.sql',
                 '20261116194028_human_started_cash_games_remain_additional_hourly_capacity.sql',
                 '20261112105743_lightning_throughput_baseline_names_the_installed_admission_.sql',
                 '20261116200642_cash_throughput_cohorts_name_the_adopted_hourly_admission_co.sql',
                 '20261020201931_unattended_cash_game_offers.sql',
                 '20261023094000_a_lapsed_game_seat_offer_leaves_the_waitlist.sql']:
        q((MIG / name).read_text())
    q('BEGIN;' + function_block(MIG / '20261121174545_full_ring_feeder_and_opening_count_honour_hourly_cap.sql',
                               'fn_cash_hourly_feeder_admissible', '$f$;') + 'COMMIT;')
    q((MIG / '20261123013241_a_called_name_keeps_its_place_under_the_hourly_cap.sql').read_text())
    installed = q("SELECT md5(pg_get_functiondef('public.fn_cash_hourly_feeder_admissible(uuid)'::regprocedure));")
    check(installed == INSTALLED_MD5, 'the rebuilt opener is byte for byte the body production runs')
    check(f"'{INSTALLED_MD5}'" in CANDIDATE.read_text(), 'the migration pins that installed text')
    print('cap at run', cap(), flush=True)

    scenarios = [scenario_freed_slot, scenario_no_owed_game, scenario_every_owed_start_must_fit, scenario_person_on_the_line]
    if MODE == 'installed-only':
        for scenario in scenarios:
            scenario(True)
        print(json.dumps({'mode': MODE, 'passed': len(passed), 'failed': failed}))
        raise SystemExit(1 if failed else 0)
    for scenario in scenarios:
        scenario(False)

    q(CANDIDATE.read_text())
    for scenario in scenarios:
        scenario(True)

    for role in ['anon', 'authenticated']:
        check(q(f"SELECT has_function_privilege('{role}','public.fn_cash_hourly_feeder_admissible(uuid)','EXECUTE');") == 'f',
              f'the opener stays private from {role}')
    check(q("SELECT has_function_privilege('service_role','public.fn_cash_hourly_feeder_admissible(uuid)','EXECUTE');") == 't',
          'the engine role can ask the opener')
    check(q("""SELECT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']
               FROM pg_proc WHERE oid='public.fn_cash_hourly_feeder_admissible(uuid)'::regprocedure;""") == 't',
          'the opener keeps SECURITY DEFINER, STABLE and its pinned search_path')
    replay = attempt(CANDIDATE.read_text())
    check(replay is not None and 'owed_main_preimage_changed' in replay, 'the migration refuses a replay')
    print(json.dumps({'passed': len(passed), 'postgres_version_num': q('SHOW server_version_num;'),
                      'productionWrites': 0, 'cap_at_run': cap()}))
finally:
    if (w / 'd/postmaster.pid').exists():
        run([PG / 'pg_ctl', '-D', w / 'd', '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(w)
