#!/usr/bin/env python3
"""A CALLED NAME KEEPS ITS PLACE (20261123013241), proved on a disposable PostgreSQL.

Production's own recorded bodies, rebuilt from the repository exactly as they
were installed: the hourly cash policy (20261116153902, 20261116194028), its
throughput cohort producer (20261112105743, 20261116200642), the feeder opener's
question (fn_cash_hourly_feeder_admissible, 20261121174545), the roster seat
guard that runs the admission on every seat insert (fixture, md5 pinned by
20261116153902) and the seat call, fn_offer_open_seat, through its own chain
(fixture preimage, 20261020201931, 20261023094000). Leaf readers the policy does
not own (wallet cover, entry need, open-seat count) are fixtures.

The cluster tick is not rebuilt: it is simulated by what it writes (a feeder
row in 'opening', the two bump moves, one fn_offer_open_seat call at a time),
and the seat move executor by what the admission keys on (the engine caller,
app.cash_seat_move='on', the insert before the source chair is released). A
horse's answer to a call is the buy-in's seat insert with its hold still live,
then the hold marked 'seated', in that order, as atomic_table_buyin does.

Every scenario runs twice: on the installed bodies, where it must reproduce the
defect (red), and after the migration, where it must not (green). No production
connection is made and no production row is read or written.
"""
import json, os, pathlib, re, shutil, subprocess, tempfile

P = pathlib.Path
ROOT = P(__file__).resolve().parents[2]
MIG = ROOT / 'supabase/migrations'
FIX = ROOT / 'scripts/ci/fixtures'
CANDIDATE = MIG / '20261123013241_a_called_name_keeps_its_place_under_the_hourly_cap.sql'
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
w = P(tempfile.mkdtemp(prefix='called-', dir=parent))
sock = w / 's'
sock.mkdir()
env = {'PATH': str(PG) + ':/usr/bin:/bin', 'LC_ALL': 'C', 'LANG': 'C'}
passed = []


def run(args, sql=None):
    r = subprocess.run([str(x) for x in args], input=sql, text=True, capture_output=True, env=env, timeout=90)
    if r.returncode:
        raise RuntimeError(r.stdout + r.stderr)
    return r.stdout.strip()


def q(sql):
    return run([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-U', 'postgres', '-d', 'postgres'], sql)


def check(ok, label):
    if not ok:
        raise AssertionError(label)
    passed.append(label)
    print('PASS', label, flush=True)


def attempt(sql):
    """None when the statement committed, else the refusal text."""
    try:
        q(sql)
        return None
    except RuntimeError as e:
        return str(e)


def function_block(path, name, terminator):
    """The exact CREATE text of one function inside a recorded migration."""
    text = path.read_text()
    start = text.index('CREATE OR REPLACE FUNCTION public.' + name + '(')
    end = text.index(terminator, start) + len(terminator)
    return text[start:end]


def uid(label):
    return q(f"SELECT md5('{label}')::uuid;")


SCHEMA = r'''
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA smarter_private; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('fixture.uid',true),'')::uuid$$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
CREATE TABLE profiles(id uuid PRIMARY KEY,is_horse boolean,status text,horse_status text,balance numeric DEFAULT 0,
  funded boolean DEFAULT true,barred boolean DEFAULT false);
CREATE TABLE clubs(id uuid PRIMARY KEY,owner_id uuid,is_public boolean DEFAULT true,asset text DEFAULT 'chips',
  is_platform boolean,union_id uuid);
CREATE TABLE club_members(club_id uuid,user_id uuid,status text);
CREATE TABLE diamond_debts(user_id uuid,settled_at timestamptz,amount numeric);
CREATE TABLE tables(id uuid PRIMARY KEY,name text,club_id uuid,union_id uuid,tournament_id uuid,is_spins boolean DEFAULT false,
  is_template boolean DEFAULT false,is_deleted boolean DEFAULT false,status text DEFAULT 'waiting',lifecycle text DEFAULT 'live',
  live_at timestamptz,opened_at timestamptz,created_at timestamptz DEFAULT clock_timestamp(),updated_at timestamptz,
  current_players integer,max_players integer DEFAULT 9,cluster_id uuid,game_variant text DEFAULT 'nlh',
  small_blind numeric DEFAULT 1,big_blind numeric DEFAULT 2,role text DEFAULT 'main',main_index integer DEFAULT 1);
CREATE TABLE table_seats(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,table_id uuid,user_id uuid,seat_number integer,
  occupancy_id uuid DEFAULT gen_random_uuid(),left_at timestamptz,active_game_scope text,stack numeric DEFAULT 100,
  is_sitting_out boolean DEFAULT false,leave_pending boolean DEFAULT false,member_id uuid,sit_out_at timestamptz,
  is_away boolean,joined_at timestamptz DEFAULT clock_timestamp(),horse_id uuid,status text,auto_rebuy boolean,
  time_bank_remaining integer,time_bank_uses_remaining integer,club_id uuid,entry_hold text,entry_post_agreed boolean);
CREATE TABLE table_waitlist(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),table_id uuid,user_id uuid,position integer,
  status text,created_at timestamptz DEFAULT clock_timestamp(),notified_at timestamptz,hold_expires_at timestamptz);
CREATE UNIQUE INDEX active_table_queue ON table_waitlist(table_id,user_id) WHERE status IN ('waiting','notified');
CREATE TABLE cash_game_waitlist(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid,user_id uuid,status text,
  created_at timestamptz DEFAULT clock_timestamp(),updated_at timestamptz DEFAULT clock_timestamp());
CREATE UNIQUE INDEX active_game_queue ON cash_game_waitlist(game_id,user_id) WHERE status IN ('waiting','notified');
CREATE TABLE notifications(id uuid DEFAULT gen_random_uuid(),user_id uuid,type text,title text,message text,data jsonb);
CREATE TABLE waitlist_policy(id boolean,max_concurrent_holds integer); INSERT INTO waitlist_policy VALUES(true,1);
CREATE TABLE cash_seat_moves(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid,player_id uuid,from_table_id uuid,
  to_table_id uuid,swap_move_id uuid,state text DEFAULT 'pending',ready_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT now()+interval '10 minutes',note text,executed_at timestamptz,to_seat_number integer);
CREATE TABLE cash_cluster_events(game_id uuid,table_id uuid,kind text,payload jsonb);
CREATE TABLE cash_games(id uuid PRIMARY KEY,club_id uuid,enabled boolean DEFAULT true,cluster_mode text DEFAULT 'must_move',
  ruleset_snapshot jsonb DEFAULT '{}'::jsonb,opening_hold_since timestamptz,cluster_epoch integer DEFAULT 1,
  lightning_enabled boolean DEFAULT false,variant text,sb numeric,bb numeric);
CREATE TABLE ca_horse_fleet_register(horse_id uuid,retired_at timestamptz);
CREATE TABLE ca_horse_active_roster(horse_id uuid);
CREATE TABLE engine_table_leases(table_id uuid,instance_id text,lease_generation uuid);
CREATE TABLE engine_leader(id boolean PRIMARY KEY,instance_id text);
INSERT INTO engine_leader VALUES(true,'engine');
CREATE TABLE cash_cluster_epoch(cluster_id uuid,epoch integer,ended_at timestamptz);
CREATE TABLE ca_operator_policy(restrictions_enforced boolean);
CREATE TABLE lightning_pool_session(id uuid,cluster_id uuid,player_id uuid,state text,cluster_epoch integer,anchor_seat_id uuid,
  stop_requested_at timestamptz,entered_at timestamptz,exited_at timestamptz,cash_player_session_id uuid);
CREATE TABLE lightning_pool_slot(id uuid,cluster_id uuid,player_id uuid,closed_at timestamptz,cluster_epoch integer,pool_session_id uuid);
CREATE TABLE cash_player_session(id uuid,closed_at timestamptz,closed_reason text,player_id uuid,scope_type text,scope_id uuid,table_id uuid);
CREATE TABLE lightning_reservation(cluster_id uuid,player_id uuid,state text,lightning_instance_id uuid);
CREATE TABLE lightning_instance(id uuid,state text);
CREATE TYPE restriction AS(reason_code text);
CREATE FUNCTION fn_platform_frozen() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
CREATE FUNCTION fn_caller_is_engine() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(current_setting('test.engine',true),'true')='true'$$;
CREATE FUNCTION fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz DEFAULT now()) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION fn_plo_lightning_horse_admit(uuid,uuid,timestamptz) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION fn_lightning_horse_admit_paced(uuid,uuid,timestamptz) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION fn_lightning_config(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION smarter_private.lightning_top_up_pending(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION fn_lightning_pool_stack(uuid) RETURNS numeric LANGUAGE sql AS $$SELECT 100$$;
CREATE FUNCTION fn_lightning_anchor_is_live_eligible(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION fn_ca_player_restricted(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION fn_rg_require_not_excluded(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"ok":true}'::jsonb$$;
CREATE FUNCTION fn_lightning_hands_owed(uuid,boolean) RETURNS integer LANGUAGE sql AS $$SELECT 0$$;
CREATE FUNCTION fn_lightning_player_in_hand(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION fn_ca_player_restriction_for(uuid,text) RETURNS restriction LANGUAGE sql AS $$SELECT ROW(null::text)::restriction$$;
CREATE FUNCTION fn_cashout_seat_occupancy(p_user_id uuid,p_table_id uuid,p_seat_number integer,p_occupancy_id uuid,p_leave_mode text DEFAULT NULL)
 RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION fn_cash_game_open_seats(p_table_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT greatest(0,coalesce(t.max_players,9)
    -(SELECT count(*) FROM table_seats s WHERE s.table_id=t.id AND s.left_at IS NULL)
    -(SELECT count(*) FROM table_waitlist w WHERE w.table_id=t.id AND w.status='notified' AND w.hold_expires_at>clock_timestamp())
    -(SELECT count(*) FROM cash_seat_moves m WHERE m.to_table_id=t.id AND m.state='pending' AND m.swap_move_id IS NULL))::integer
  FROM tables t WHERE t.id=p_table_id $$;
CREATE FUNCTION fn_ca_cash_wallet_covers(uuid,uuid,uuid,numeric) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT funded FROM profiles WHERE id=$1$$;
CREATE FUNCTION fn_ca_cash_entry_need(uuid,uuid) RETURNS numeric LANGUAGE sql STABLE AS $$SELECT 80::numeric$$;
CREATE FUNCTION fn_cash_game_barred_seconds(uuid,uuid) RETURNS integer LANGUAGE sql STABLE AS $$SELECT CASE WHEN barred THEN 60 ELSE NULL END FROM profiles WHERE id=$2$$;
CREATE FUNCTION fn_caller_session_is_live() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;
'''

CLUB = 'c1000000-0000-4000-8000-000000000001'


def reset():
    """A clean floor and an empty policy clock; the installed functions stay."""
    q("""TRUNCATE tables,table_seats,table_waitlist,cash_game_waitlist,notifications,cash_seat_moves,cash_games,
           cash_hourly_table_starts,cash_hourly_table_origins,profiles,ca_horse_active_roster;
         UPDATE cash_hourly_table_pacing SET enabled_instance_id='engine',next_open_at='-infinity',next_close_at='-infinity';""")
    q(f"INSERT INTO clubs(id) VALUES('{CLUB}') ON CONFLICT DO NOTHING;")


def horses(prefix, n):
    q(f"""INSERT INTO profiles(id,is_horse) SELECT md5('{prefix}'||i)::uuid,true FROM generate_series(1,{n}) i;
          INSERT INTO ca_horse_active_roster SELECT md5('{prefix}'||i)::uuid FROM generate_series(1,{n}) i;""")


def floor_of_other_games(n):
    """n other horse-only tables already counted against the cap, opened earlier."""
    if n <= 0:
        return
    horses('other', n)
    q(f"""ALTER TABLE table_seats DISABLE TRIGGER roster_guard;
          INSERT INTO tables(id,name,club_id,created_at,status) SELECT md5('othertable'||i)::uuid,'Other '||i,'{CLUB}',
                 clock_timestamp()-interval '3 hours'+i*interval '1 second','running' FROM generate_series(1,{n}) i;
          INSERT INTO table_seats(table_id,user_id,seat_number)
                 SELECT md5('othertable'||i)::uuid,md5('other'||i)::uuid,1 FROM generate_series(1,{n}) i;
          ALTER TABLE table_seats ENABLE TRIGGER roster_guard;""")


def full_main(game, size, prefix):
    """A game whose Main 1 is full of horses that sat an hour ago (established)."""
    main = uid(game + ':main')
    horses(prefix, size)
    q(f"""INSERT INTO cash_games(id,club_id,variant,sb,bb) VALUES('{uid(game)}','{CLUB}','nlh',1,2);
          ALTER TABLE table_seats DISABLE TRIGGER roster_guard;
          INSERT INTO tables(id,name,club_id,cluster_id,max_players,created_at,status,role,main_index)
                 VALUES('{main}','Main 1','{CLUB}','{uid(game)}',{size},clock_timestamp()-interval '2 hours','running','main',1);
          INSERT INTO table_seats(table_id,user_id,seat_number,joined_at)
                 SELECT '{main}',md5('{prefix}'||i)::uuid,i,clock_timestamp()-interval '1 hour'+i*interval '1 minute'
                   FROM generate_series(1,{size}) i;
          ALTER TABLE table_seats ENABLE TRIGGER roster_guard;""")
    return main


def put_on_list(game, users, start_minutes_ago=10):
    for i, u in enumerate(users):
        q(f"""INSERT INTO cash_game_waitlist(game_id,user_id,status,created_at)
              VALUES('{uid(game)}','{u}','waiting',clock_timestamp()-interval '{start_minutes_ago - i} minutes');""")


def open_feeder(game, size=9):
    feeder = uid(game + ':feeder')
    admissible = q(f"SELECT public.fn_cash_hourly_feeder_admissible('{uid(game)}');")
    q(f"""INSERT INTO tables(id,name,club_id,cluster_id,max_players,status,lifecycle,role,main_index)
          VALUES('{feeder}','Feeder','{CLUB}','{uid(game)}',{size},'waiting','opening','feeder',NULL);""")
    return feeder, admissible == 't'


def execute_move(player, source, dest, seat):
    """The one-way executor's shape: the destination chair, then the source released."""
    return attempt(f"""BEGIN; SET LOCAL app.cash_seat_move='on';
        INSERT INTO table_seats(table_id,user_id,seat_number) VALUES('{dest}','{player}',{seat});
        UPDATE table_seats SET left_at=clock_timestamp() WHERE table_id='{source}' AND user_id='{player}' AND left_at IS NULL;
        UPDATE cash_seat_moves SET state='executed',executed_at=clock_timestamp()
         WHERE player_id='{player}' AND to_table_id='{dest}' AND state='pending';
        COMMIT;""")


def offer(table):
    return json.loads(q(f"SELECT public.fn_offer_open_seat('{table}');"))


def claim(table, user, seat):
    """A horse answering its call: the buy-in's seat insert, then its hold 'seated'."""
    return attempt(f"""BEGIN;
        INSERT INTO table_seats(table_id,user_id,seat_number) VALUES('{table}','{user}',{seat});
        UPDATE table_waitlist SET status='seated' WHERE table_id='{table}' AND user_id='{user}' AND status IN ('waiting','notified');
        COMMIT;""")


def lapse(user):
    q(f"UPDATE table_waitlist SET hold_expires_at=clock_timestamp()-interval '1 second' WHERE user_id='{user}' AND status='notified';")


def game_row(game, user):
    return q(f"SELECT string_agg(status,',' ORDER BY created_at) FROM cash_game_waitlist WHERE game_id='{uid(game)}' AND user_id='{user}';")


def seated_at(table):
    return int(q(f"SELECT count(*) FROM table_seats WHERE table_id='{table}' AND left_at IS NULL;"))


def call_round(game, table, names, next_seat):
    """Call the list into `table` one name at a time, as the tick does, and let each
    horse answer. A refused answer lapses its hold, as sixty seconds would."""
    refusals = []
    for _ in range(len(names) + 2):
        r = offer(table)
        if not r.get('ok'):
            break
        who = r['user_id']
        refused = claim(table, who, next_seat)
        if refused is None:
            next_seat += 1
        else:
            refusals.append((who, refused))
            lapse(who)
    return refusals, next_seat


def cap():
    return int(q('SELECT table_cap FROM public.fn_cash_hourly_table_range();'))


def scenario_full_ring_at_the_edge(fixed):
    """Nine-handed Main 1 full, four names on the list, ONE table left under the cap."""
    reset()
    c = cap()
    floor_of_other_games(c - 2)
    main = full_main('ring', 9, 'ringhorse')
    names = [uid(f'listhorse{i}') for i in range(1, 5)]
    q("INSERT INTO profiles(id,is_horse) SELECT md5('listhorse'||i)::uuid,true FROM generate_series(1,4) i;"
      "INSERT INTO ca_horse_active_roster SELECT md5('listhorse'||i)::uuid FROM generate_series(1,4) i;")
    put_on_list('ring', names)
    feeder, admitted = open_feeder('ring')
    tag = 'fixed' if fixed else 'installed'
    check(admitted, f'[{tag}] the opener admits the feeder on the last table under the cap')
    # Two bump moves, the last two to sit, planned by the tick.
    last_two = q(f"""SELECT string_agg(user_id::text,',' ORDER BY joined_at DESC) FROM
                     (SELECT user_id,joined_at FROM table_seats WHERE table_id='{main}' AND left_at IS NULL
                       ORDER BY joined_at DESC LIMIT 2) s;""").split(',')
    for p in last_two:
        q(f"INSERT INTO cash_seat_moves(game_id,player_id,from_table_id,to_table_id) VALUES('{uid('ring')}','{p}','{main}','{feeder}');")
    # Before the hand boundary executes the bumps, an autonomous horse tries to
    # start an unrelated empty lobby table. The feeder holds the last slot.
    horses('lobby', 1)
    q(f"INSERT INTO tables(id,name,club_id) VALUES('{uid('lobby')}','Lobby','{CLUB}');")
    lobby_projection = q(f"SELECT allowed FROM public.fn_cash_hourly_table_admissions() WHERE table_id='{uid('lobby')}';")
    lobby = attempt(f"INSERT INTO table_seats(table_id,user_id,seat_number) VALUES('{uid('lobby')}',md5('lobby1')::uuid,1);")
    bump1 = execute_move(last_two[0], main, feeder, 1)
    bump2 = execute_move(last_two[1], main, feeder, 2)
    refusals, _ = call_round('ring', feeder, names, 3)
    rows = [game_row('ring', n) for n in names]
    if not fixed:
        check(lobby_projection == 't' and lobby is None,
              '[installed] an unrelated autonomous start takes the slot the opening feeder was admitted on')
        check(bump1 is not None and 'cash_hourly_table_cap_reached' in bump1,
              '[installed] so the first bumped player is refused the feeder at the cap (red)')
        reset_pair = 'cash_hourly_horse_arrival_paced'
        # The same game without the interloper: the second bump is paced off the feeder.
        reset()
        floor_of_other_games(c - 2)
        main = full_main('ring', 9, 'ringhorse')
        feeder, _ = open_feeder('ring')
        b1 = execute_move(md5_seated(main, 0), main, feeder, 1)
        mover = md5_seated(main, 0)
        b2 = execute_move(mover, main, feeder, 2)
        check(b1 is None and b2 is not None and reset_pair in b2,
              '[installed] with the slot free, the second bumped player is refused by arrival pacing (red)')
        q("INSERT INTO profiles(id,is_horse) SELECT md5('listhorse'||i)::uuid,true FROM generate_series(1,4) i;"
          "INSERT INTO ca_horse_active_roster SELECT md5('listhorse'||i)::uuid FROM generate_series(1,4) i;")
        put_on_list('ring', names)
        refusals, _ = call_round('ring', feeder, names, 2)
        rows = [game_row('ring', n) for n in names]
        check(len(refusals) >= 1 and all(reset_pair in r for _, r in refusals),
              '[installed] the list is called to the feeder and every horse is refused by arrival pacing (red)')
        offer(feeder)
        rows = [game_row('ring', n) for n in names]
        check(any(r is not None and r.startswith('expired') for r in rows),
              '[installed] a lapsed call takes the waiting horse off the list: it lost its place (red)')
        return
    check(lobby_projection == 'f', '[fixed] the fleet projection no longer offers the reserved slot to an autonomous start')
    check(lobby is not None and 'cash_hourly_table_cap_reached' in lobby,
          '[fixed] the database refuses that autonomous start: the opening feeder holds its slot')
    check(bump1 is None, '[fixed] the first bumped player moves to the feeder')
    check(bump2 is None, '[fixed] the second bumped player moves to the feeder (no arrival pacing on a sanctioned move)')
    check(refusals == [], '[fixed] every name the list calls to the feeder sits down')
    check(all(r == 'seated' for r in rows),
          '[fixed] all four names went waiting -> notified -> seated; none expired, none lost its place')
    order = q(f"""SELECT string_agg(user_id::text,',' ORDER BY seat_number) FROM table_seats
                 WHERE table_id='{feeder}' AND left_at IS NULL AND seat_number>=3;""").split(',')
    check(order == names, '[fixed] the four sat in arrival order, first on the list first')
    check(seated_at(feeder) == 6 and seated_at(main) == 7,
          '[fixed] the feeder deals six handed and Main 1 keeps its two bumped chairs empty')


def md5_seated(table, nth):
    return q(f"""SELECT user_id FROM table_seats WHERE table_id='{table}' AND left_at IS NULL
                 ORDER BY joined_at DESC OFFSET {nth} LIMIT 1;""")


def scenario_floor_clock_after_the_open(fixed):
    """Two tables left; the feeder opens, then another game starts and holds the floor
    clock before the bump executes. The admitted feeder still starts."""
    reset()
    c = cap()
    floor_of_other_games(c - 3)
    main = full_main('ring', 9, 'ringhorse')
    feeder, admitted = open_feeder('ring')
    tag = 'fixed' if fixed else 'installed'
    check(admitted, f'[{tag}] the opener admits the feeder with two tables left')
    horses('lobby', 1)
    q(f"INSERT INTO tables(id,name,club_id) VALUES('{uid('lobby')}','Lobby','{CLUB}');")
    other_start = attempt(f"INSERT INTO table_seats(table_id,user_id,seat_number) VALUES('{uid('lobby')}',md5('lobby1')::uuid,1);")
    check(other_start is None, f'[{tag}] another game starts on the remaining slot and holds the floor clock')
    held_until = q("SELECT next_open_at FROM cash_hourly_table_pacing WHERE scope='floor';")
    mover = md5_seated(main, 0)
    bump1 = execute_move(mover, main, feeder, 1)
    if not fixed:
        check(bump1 is not None and 'cash_hourly_table_start_paced' in bump1,
              '[installed] the floor clock refuses the first bump into the admitted feeder (red)')
        return
    check(bump1 is None, '[fixed] the first bump starts the admitted feeder despite the floor clock')
    check(q(f"SELECT next_open_at>='{held_until}'::timestamptz FROM cash_hourly_table_pacing WHERE scope='floor';") == 't',
          '[fixed] the feeder start still restarts the floor clock; it never shortens it')
    # And an AUTONOMOUS start is still held by that clock.
    horses('lobbytwo', 1)
    q(f"INSERT INTO tables(id,name,club_id) VALUES('{uid('lobbytwo')}','Lobby 2','{CLUB}');")
    autonomous = attempt(f"INSERT INTO table_seats(table_id,user_id,seat_number) VALUES('{uid('lobbytwo')}',md5('lobbytwo1')::uuid,1);")
    check(autonomous is not None and ('cash_hourly_table_start_paced' in autonomous or 'cash_hourly_table_cap_reached' in autonomous),
          '[fixed] an autonomous horse start is still refused by the cap and the floor clock')


def scenario_six_max_list_start(fixed):
    """Six-max: two names on the list start the feeder heads up, under a floor clock."""
    reset()
    c = cap()
    floor_of_other_games(c - 3)
    full_main('six', 6, 'sixhorse')
    names = [uid(f'sixlist{i}') for i in range(1, 3)]
    q("INSERT INTO profiles(id,is_horse) SELECT md5('sixlist'||i)::uuid,true FROM generate_series(1,2) i;"
      "INSERT INTO ca_horse_active_roster SELECT md5('sixlist'||i)::uuid FROM generate_series(1,2) i;")
    put_on_list('six', names)
    feeder, admitted = open_feeder('six', 6)
    tag = 'fixed' if fixed else 'installed'
    check(admitted, f'[{tag}] the six-max opener admits its heads-up feeder')
    q("UPDATE cash_hourly_table_pacing SET next_open_at=clock_timestamp()+interval '3 minutes' WHERE scope='floor';")
    refusals, _ = call_round('six', feeder, names, 1)
    rows = [game_row('six', n) for n in names]
    if not fixed:
        check(len(refusals) >= 1, '[installed] the called horses are refused the admitted heads-up feeder (red)')
        offer(feeder)
        rows = [game_row('six', n) for n in names]
        check(any(r is not None and r.startswith('expired') for r in rows),
              '[installed] and each refused call costs a horse its place (red)')
        return
    check(refusals == [] and seated_at(feeder) == 2, '[fixed] both called names sit: the feeder deals heads up')
    check(all(r == 'seated' for r in rows), '[fixed] neither name lost its place')


def scenario_excess_table_passes_over(fixed):
    """The floor is over its cap and this full game's table is the one being closed.
    A chair opens. A horse heads the list, a person is second."""
    reset()
    c = cap()
    floor_of_other_games(c)
    main = full_main('closing', 9, 'closinghorse')
    check(q(f"SELECT public.fn_cash_hourly_table_excess('{main}');") == 't', 'the full game is the excess table')
    horse = uid('excesslist1')
    person = uid('person1')
    q(f"INSERT INTO profiles(id,is_horse) VALUES('{horse}',true),('{person}',false); INSERT INTO ca_horse_active_roster VALUES('{horse}');")
    put_on_list('closing', [horse])
    q(f"UPDATE table_seats SET left_at=clock_timestamp() WHERE id=(SELECT id FROM table_seats WHERE table_id='{main}' AND left_at IS NULL LIMIT 1);")
    r = offer(main)
    if not fixed:
        check(r.get('user_id') == horse, '[installed] the seat is called to the horse the cap will refuse')
        refused = claim(main, horse, 9)
        check(refused is not None and 'cash_hourly_table_cap_reached' in refused, '[installed] the called horse is refused (red)')
        lapse(horse)
        offer(main)
        check(game_row('closing', horse) == 'expired', '[installed] the refused call costs the horse its place (red)')
        return
    # Only a horse waiting: nobody is called and nobody loses a place.
    check(not r.get('ok') and r.get('reason') == 'hourly_cap_passes_over',
          '[fixed] with only a horse waiting at a closing table the seat is not called, and the answer says why')
    check(game_row('closing', horse) == 'waiting', '[fixed] the horse the cap would refuse keeps its place')
    # A person joins the line behind the horse and is called to the seat.
    put_on_list('closing', [person], start_minutes_ago=1)
    r = offer(main)
    check(r.get('user_id') == person, '[fixed] the horse is passed over for this seat only; the person behind it is called')
    check(game_row('closing', horse) == 'waiting', '[fixed] the passed-over horse still holds the head of the line')
    check(claim(main, person, 9) is None, '[fixed] the person sits (the hourly policy never gates a person)')
    # A person at the table protects it: it is no longer being closed, so the
    # next chair that opens is one the horse CAN take, and it is still first.
    check(q(f"SELECT public.fn_cash_hourly_table_excess('{main}');") == 'f', 'a person at the table takes it off the closing list')
    q(f"UPDATE table_seats SET left_at=clock_timestamp() WHERE id=(SELECT id FROM table_seats WHERE table_id='{main}' AND left_at IS NULL AND user_id<>'{person}' LIMIT 1);")
    r = offer(main)
    check(r.get('user_id') == horse, '[fixed] the next seat it can take is called to the horse, still first in line')
    check(claim(main, horse, 8) is None and game_row('closing', horse) == 'notified',
          '[fixed] and it sits there: it kept its place until it was offered a seat it could take')


def scenario_autonomous_pacing_kept(fixed):
    """The gradual look of a NEW game is unchanged: a person sits at an empty table;
    the first horse joins, the next autonomous horse waits its 2-4 minute window."""
    reset()
    person = uid('starter')
    q(f"INSERT INTO profiles(id,is_horse) VALUES('{person}',false); INSERT INTO tables(id,name,club_id) VALUES('{uid('fresh')}','Fresh','{CLUB}');")
    horses('fresh', 2)
    t = uid('fresh')
    check(attempt(f"INSERT INTO table_seats(table_id,user_id,seat_number) VALUES('{t}','{person}',1);") is None,
          'a person sits at an empty table')
    check(attempt(f"INSERT INTO table_seats(table_id,user_id,seat_number) VALUES('{t}',md5('fresh1')::uuid,2);") is None,
          'the first horse joins the person')
    second = attempt(f"INSERT INTO table_seats(table_id,user_id,seat_number) VALUES('{t}',md5('fresh2')::uuid,3);")
    check(second is not None and 'cash_hourly_horse_arrival_paced' in second,
          'the next autonomous horse still waits its own arrival window (3-7 minute fill kept)')


def agreement():
    """The predicate fn_offer_open_seat asks answers exactly what the admission does
    for a called horse, at every kind of table the scenarios built."""
    reset()
    c = cap()
    floor_of_other_games(c)
    main = full_main('closing', 9, 'closinghorse')
    horse = uid('agree1')
    q(f"INSERT INTO profiles(id,is_horse) VALUES('{horse}',true); INSERT INTO ca_horse_active_roster VALUES('{horse}');")
    q(f"UPDATE table_seats SET left_at=clock_timestamp() WHERE id=(SELECT id FROM table_seats WHERE table_id='{main}' AND left_at IS NULL LIMIT 1);")
    feeder, _ = open_feeder('closing')
    q(f"INSERT INTO tables(id,name,club_id) VALUES('{uid('emptymain')}','Empty','{CLUB}');")
    for table, label in [(main, 'excess full game'), (feeder, 'empty feeder over the cap'), (uid('emptymain'), 'empty lobby table over the cap')]:
        predicate = q(f"SELECT public.fn_cash_hourly_call_admissible('{table}','{horse}');")
        q(f"""INSERT INTO table_waitlist(table_id,user_id,position,status,notified_at,hold_expires_at)
              VALUES('{table}','{horse}',0,'notified',clock_timestamp(),clock_timestamp()+interval '1 minute');""")
        outcome = attempt(f"BEGIN; INSERT INTO table_seats(table_id,user_id,seat_number) VALUES('{table}','{horse}',9); ROLLBACK;")
        q(f"DELETE FROM table_waitlist WHERE user_id='{horse}';")
        check((predicate == 't') == (outcome is None), f'the call predicate agrees with the admission: {label}')
    # Under the cap the same tables admit the called horse, and the predicate says so.
    q("UPDATE table_seats SET left_at=clock_timestamp() WHERE table_id IN (SELECT id FROM tables WHERE name LIKE 'Other %');")
    for table, label in [(main, 'established table under the cap'), (feeder, 'empty feeder under the cap')]:
        predicate = q(f"SELECT public.fn_cash_hourly_call_admissible('{table}','{horse}');")
        q(f"""INSERT INTO table_waitlist(table_id,user_id,position,status,notified_at,hold_expires_at)
              VALUES('{table}','{horse}',0,'notified',clock_timestamp(),clock_timestamp()+interval '1 minute');""")
        outcome = attempt(f"BEGIN; INSERT INTO table_seats(table_id,user_id,seat_number) VALUES('{table}','{horse}',9); ROLLBACK;")
        q(f"DELETE FROM table_waitlist WHERE user_id='{horse}';")
        check(predicate == 't' and outcome is None, f'the call predicate agrees with the admission: {label}')
    person = uid('agreeperson')
    q(f"INSERT INTO profiles(id,is_horse) VALUES('{person}',false);")
    check(q(f"SELECT public.fn_cash_hourly_call_admissible('{main}','{person}');") == 't', 'a person is never refused by the hourly policy')


try:
    run([PG / 'initdb', '-D', w / 'd', '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'])
    run([PG / 'pg_ctl', '-D', w / 'd', '-l', w / 'pg.log', '-o', f"-h '' -k {sock}", '-w', 'start'])
    q(SCHEMA)
    # The installed bodies, in the order production received them.
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
    digests = json.loads(q("""SELECT json_object_agg(s,md5(pg_get_functiondef(s::regprocedure))) FROM unnest(ARRAY[
        'public.fn_cash_hourly_table_admit(uuid,uuid)','public.fn_cash_hourly_table_admissions()',
        'public.fn_offer_open_seat(uuid,interval,interval)','public.fn_lightning_admission_policy()',
        'public.fn_cash_hourly_feeder_admissible(uuid)']) s;"""))
    print('installed digests', json.dumps(digests), flush=True)
    pinned = dict(re.findall(r"\('(public\.fn_[a-z_]+\([a-z,]*\))',\s*'([0-9a-f]{32})'\)", CANDIDATE.read_text()))
    for signature, digest in pinned.items():
        check(digests.get(signature) == digest, f'the migration pins the installed text of {signature}')
    old_cohort = q('SELECT hourly_fingerprint FROM public.fn_lightning_admission_policy();')

    for scenario in [scenario_full_ring_at_the_edge, scenario_floor_clock_after_the_open,
                     scenario_six_max_list_start, scenario_excess_table_passes_over]:
        scenario(False)
    scenario_autonomous_pacing_kept(False)

    q(CANDIDATE.read_text())

    for scenario in [scenario_full_ring_at_the_edge, scenario_floor_clock_after_the_open,
                     scenario_six_max_list_start, scenario_excess_table_passes_over]:
        scenario(True)
    scenario_autonomous_pacing_kept(True)
    agreement()

    new_cohort = q('SELECT hourly_fingerprint FROM public.fn_lightning_admission_policy();')
    check(new_cohort != '' and new_cohort != old_cohort, 'the throughput cohort names the changed admission policy')
    definition = q("SELECT pg_get_functiondef('public.fn_cash_hourly_call_admissible(uuid,uuid)'::regprocedure);")
    q(definition.replace('AS $function$', 'AS $function$\n-- changed call predicate', 1))
    check(q('SELECT hourly_fingerprint FROM public.fn_lightning_admission_policy();') != new_cohort,
          'a change to the call predicate alone changes the cohort fingerprint (it is a counted input)')
    q(definition)
    for role in ['anon', 'authenticated']:
        for signature in ['fn_cash_hourly_call_admissible(uuid,uuid)', 'fn_offer_open_seat(uuid,interval,interval)',
                          'fn_cash_hourly_table_admit(uuid,uuid)', 'fn_cash_hourly_table_admissions()']:
            check(q(f"SELECT has_function_privilege('{role}','{signature}','EXECUTE');") == 'f', f'{signature} stays private from {role}')
    check(q("SELECT has_function_privilege('service_role','fn_cash_hourly_call_admissible(uuid,uuid)','EXECUTE');") == 't',
          'the engine role can ask the call predicate')
    check(q("SELECT prosecdef FROM pg_proc WHERE oid='public.fn_cash_hourly_table_admit(uuid,uuid)'::regprocedure;") == 't',
          'the admission keeps SECURITY DEFINER')
    replay = attempt(CANDIDATE.read_text())
    check(replay is not None and 'called_name_keeps_place_preimage_changed' in replay, 'the migration refuses a replay')
    print(json.dumps({'passed': len(passed), 'postgres_version_num': q('SHOW server_version_num;'),
                      'productionWrites': 0, 'cap_at_run': cap()}))
finally:
    if (w / 'd/postmaster.pid').exists():
        run([PG / 'pg_ctl', '-D', w / 'd', '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(w)
