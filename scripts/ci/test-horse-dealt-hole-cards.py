#!/usr/bin/env python3
"""Real PG17: every Horse's dealt hole cards reach the service-only table.

Migrations 20261120014240 and 20261120025753 (review B1). Builds the
accepted-hand stats projector and the horse retention basis from the exact
repository migrations that produced the production bodies (md5-pinned to
production, read 2026-11-19), applies 20261120014240 (which no longer touches
the basis: the basis still refuses the key, so an engine must not send it yet),
then 20261120025753 (the basis drops the key; public.horse_stats_basis_accepted_keys
lists it; re-runnable), and proves: Horses only (never a human's cards, even when the
payload names one), Lightning passes through, replay and rollback keep exactly
once, a malformed list never fails the projection, the retention basis keeps
no cards, retention matches hand_history, and no client role can read it.
No DSN or remote connection accepted; private Unix socket, synthetic data.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'tests/sql/fixtures/horse-daily-counts'
M = ROOT / 'supabase/migrations'
DAILY = M / '20261025185247_horse_daily_counts_share_the_accepted_hand_receipt.sql'
SEAT = M / '20261026142110_accepted_horse_hand_projection_updates_its_physical_seat_clo.sql'
WITNESS = M / '20261026181909_all_in_runout_witnesses_survive_the_accepted_stats_projector.sql'
LIGHTNING = M / '20261025000729_lightning_hands_reach_the_stats_facts_and_the_collusion_scan.sql'
BASIS = M / '20261012170919_horse_fact_cards_age_out_without_erasing_player_totals.sql'
BASIS_ROLLUPS = M / '20261105174453_horse_stats_basis_accepts_horse_rollups.sql'
MIGRATION = M / '20261120014240_every_horse_dealt_hole_cards_are_kept_for_audit.sql'
BASIS_KEY = M / '20261120025753_the_horse_stats_basis_drops_the_horse_hole_cards_key.sql'
PROJECTOR_PRE = '1fbfe441e124bff9317e4f8b1c3def8c'
BASIS_PRE = '914a8bbaf45776566ea7ca886d26c7fc'
PROJECTOR_POST = 'a5f235fbec8ac733e2c436e9c7546b71'
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
BASE = Path(os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP') or tempfile.gettempdir())
if sys.platform == 'darwin' and not str(BASE).startswith('/Volumes/SmarterWork/agent-work/'):
    raise RuntimeError('TMPDIR must be the task-owned external SSD scratch directory')
ENV = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
ENV.update(LANG='C', LC_ALL='C')
PORT = '55513'


def uid(label):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'horse-dealt-hole-cards/' + label))


def literal(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


HORSE, HORSE2, HUMAN, NOT_HORSE = uid('horse'), uid('horse2'), uid('human'), uid('flag-false')
TABLE, CLUB = uid('table'), uid('club')


def fact(label, user, seat, invested=0):
    f = dict(hand_id=uid(label), user_id=user, table_id=TABLE, club_id=CLUB, tournament_id=None,
             played_at='2026-11-19T12:00:00.5Z', game_variant='plo4', big_blind=2, seat=seat,
             position='btn', players_dealt=3, invested=invested, returned=0, net=-invested,
             net_bb=-invested / 2, rake_paid=0, ev_net=-invested, ev_net_bb=-invested / 2)
    f.update({k: False for k in ['vpip', 'pfr', 'three_bet', 'four_bet', 'faced_three_bet',
              'folded_to_three_bet', 'had_cbet_flop_opp', 'cbet_flop', 'saw_flop',
              'went_to_showdown', 'won_at_showdown', 'was_all_in']})
    f.update(aggressive_actions=0, passive_actions=0)
    return f


def payload(label, cards=True, **over):
    d = dict(version=2, transfers=[],
             facts=[fact(label, HORSE, 2), fact(label, HUMAN, 5, 2), fact(label, HORSE2, 7, 1)])
    if cards:
        d['horse_hole_cards'] = [
            dict(user_id=HORSE, seat=2, cards=['As', 'Kd', 'Qh', 'Jc']),
            dict(user_id=HORSE2, seat=7, cards=['2c', '3c', '4c', '5c']),
        ]
    d.update(over)
    return d


def main():
    checks = []
    if os.geteuid() == 0:
        raise RuntimeError('Run as non-root (initdb requirement)')
    with tempfile.TemporaryDirectory(prefix='horse-cards-', dir=BASE) as raw, \
         tempfile.TemporaryDirectory(prefix='hd-', dir=BASE.parents[1]) as sock:
        data = Path(raw) / 'data'

        def command(args, sql=None):
            return subprocess.run(list(map(str, args)), input=sql, text=True,
                                  capture_output=True, env=ENV, timeout=60)

        def run(sql, ok=True):
            r = command([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock,
                         '-p', PORT, '-U', 'postgres', '-d', 'postgres'], sql)
            if (r.returncode == 0) != ok:
                raise AssertionError(r.stderr or r.stdout)
            return r.stdout.strip() if ok else r.stderr

        def check(name, condition):
            if not condition:
                raise AssertionError(name)
            checks.append(name)

        def accept(label, d, has_human=True):
            run('INSERT INTO hand_atomic_commits VALUES (' + "'" + uid(label) + "','" + TABLE + "',"
                + literal(dict(accepted_hand_facts=dict(stats_facts=d))) + ');'
                + "INSERT INTO hand_history(id,has_human) VALUES ('" + uid(label) + "'," + str(has_human).lower() + ');')

        def project(label, ok=True):
            out = run("SELECT ca_project_hand_stats_facts('" + uid(label) + "');", ok)
            return json.loads(out) if ok else out

        def kept(label):
            return run("SELECT coalesce(json_agg(json_build_array(user_id,seat,hole_cards,has_human,game_variant) "
                       "ORDER BY seat),'[]') FROM smarter_private.horse_dealt_hole_cards WHERE hand_id='" + uid(label) + "';")

        r = command([PG / 'initdb', '-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale'])
        if r.returncode:
            raise RuntimeError(r.stderr)
        r = command([PG / 'pg_ctl', '-D', data, '-l', Path(raw) / 'postgres.log', '-o',
                     f'-k {sock} -p {PORT} -c listen_addresses= -c fsync=off', '-w', 'start'])
        if r.returncode:
            raise RuntimeError(r.stderr)
        try:
            run("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;"
                " CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;"
                " CREATE SCHEMA smarter_private; GRANT USAGE ON SCHEMA smarter_private TO anon, authenticated, service_role;"
                " CREATE TABLE tables(id uuid PRIMARY KEY,club_id uuid);"
                " CREATE TABLE hand_atomic_commits(hand_id uuid PRIMARY KEY,table_id uuid,post_commit_payload jsonb);"
                " CREATE TABLE lightning_hand(hand_id uuid PRIMARY KEY,host_table_id uuid);"
                " CREATE TABLE hand_history(id uuid PRIMARY KEY,has_human boolean,created_at timestamptz DEFAULT now());"
                " CREATE TABLE profiles(id uuid PRIMARY KEY,is_horse boolean);"
                " CREATE TABLE hand_history_retention_policy(id boolean PRIMARY KEY,horse_retention_days integer);"
                " INSERT INTO hand_history_retention_policy VALUES (true,8);"
                " CREATE PUBLICATION supabase_realtime;"
                " CREATE TABLE ca_horse_fleet_state(horse_id uuid PRIMARY KEY,table_id uuid,last_action_at timestamptz,updated_at timestamptz);")
            run((FIXTURE / 'schema.sql').read_text())
            run((FIXTURE / 'add.sql').read_text())
            run((FIXTURE / 'projector-before.sql').read_text() + ';')
            validator = re.search(r'CREATE FUNCTION public\.fn_lightning_hand_stats_facts\(.*?AS \$function\$.*?\$function\$;',
                                  LIGHTNING.read_text(), re.S)
            run(validator.group(0))
            run('REVOKE ALL ON FUNCTION ca_project_hand_stats_facts(uuid) FROM PUBLIC,anon,authenticated;'
                ' GRANT EXECUTE ON FUNCTION ca_project_hand_stats_facts(uuid) TO service_role;')
            run(DAILY.read_text()); run(SEAT.read_text()); run(WITNESS.read_text())
            check('projector preimage is the production body',
                  run("SELECT md5(pg_get_functiondef('ca_project_hand_stats_facts(uuid)'::regprocedure));") == PROJECTOR_PRE)
            basis = re.search(r'CREATE FUNCTION smarter_private\.horse_compact_stats_basis\(.*?END \$function\$;',
                              BASIS.read_text(), re.S)
            run(basis.group(0)); run(BASIS_ROLLUPS.read_text())
            check('retention basis preimage is the production body',
                  run("SELECT md5(pg_get_functiondef('smarter_private.horse_compact_stats_basis(jsonb)'::regprocedure));") == BASIS_PRE)
            run("INSERT INTO tables VALUES ('" + TABLE + "','" + CLUB + "');"
                "INSERT INTO profiles VALUES ('" + HORSE + "',true),('" + HORSE2 + "',true),('" + HUMAN + "',false),('" + NOT_HORSE + "',false);")
            legacy = payload('legacy-basis', cards=False)
            legacy['horse_rollups'] = dict(version=1, nets=[], play=[])
            basis_before = run('SELECT smarter_private.horse_compact_stats_basis(' + literal(legacy) + ')::text;')
            check('old basis refuses the new key (the 2026-10-25 failure mode)',
                  'HORSE_STATS_BASIS_INVALID_SHAPE' in run('SELECT smarter_private.horse_compact_stats_basis(' + literal(payload('x')) + ');', False))

            basis_proof = re.search(r'^-- @live-proof: (.*)$', BASIS_KEY.read_text(), re.M).group(1)
            check('basis-key live proof is false on the old basis', run('SELECT ' + basis_proof + ';') == 'f')

            run(MIGRATION.read_text())
            check('migration cannot replay', 'HORSE_DEALT_HOLE_CARDS_ALREADY_INSTALLED' in run(MIGRATION.read_text(), False))
            post = run("SELECT md5(pg_get_functiondef('ca_project_hand_stats_facts(uuid)'::regprocedure));")
            check('projector postimage is the one the migration pins', post == PROJECTOR_POST)
            proof = re.search(r'^-- @live-proof: (.*)$', MIGRATION.read_text(), re.M).group(1)
            check('migration live proof is true once installed', run('SELECT ' + proof + ';') == 't')
            # Review B1: 20261120014240 leaves the basis alone, so the two install in either order.
            check('20261120014240 does not touch the retention basis',
                  run("SELECT md5(pg_get_functiondef('smarter_private.horse_compact_stats_basis(jsonb)'::regprocedure));") == BASIS_PRE)
            check('without 20261120025753 the basis still refuses the key (the engine must not send it)',
                  'HORSE_STATS_BASIS_INVALID_SHAPE' in run('SELECT smarter_private.horse_compact_stats_basis(' + literal(payload('x')) + ');', False))
            check('without 20261120025753 the engine has nothing to ask (its contract reads off)',
                  run("SELECT to_regprocedure('public.horse_stats_basis_accepted_keys()') IS NULL;") == 't')

            run(BASIS_KEY.read_text())
            run(BASIS_KEY.read_text())
            check('20261120025753 re-runs cleanly and renames the core once',
                  run("SELECT count(*) FROM pg_proc WHERE proname IN ('horse_compact_stats_basis','horse_compact_stats_basis_core');") == '2')
            check('basis-key live proof is true once installed', run('SELECT ' + basis_proof + ';') == 't')
            basis_post = run("SELECT md5(pg_get_functiondef('smarter_private.horse_compact_stats_basis(jsonb)'::regprocedure));")
            check('the engine contract lists both optional keys', json.loads(run(
                "SET ROLE service_role; SELECT public.horse_stats_basis_accepted_keys();").splitlines()[-1])
                == {'contract': 1, 'accepted': ['horse_hole_cards', 'horse_rollups']})
            check('no client role can ask the contract or run the basis', run(
                "SELECT bool_or(has_function_privilege(r,f,'execute')) FROM unnest(ARRAY['anon','authenticated']) r,"
                " unnest(ARRAY['public.horse_stats_basis_accepted_keys()','smarter_private.horse_compact_stats_basis(jsonb)',"
                "'smarter_private.horse_compact_stats_basis_core(jsonb)']) f;") == 'f')
            check('the contract refuses a client role (enforced)', 'permission denied' in command(
                [PG / 'psql', '-X', '-qAt', '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-c',
                 'SET ROLE anon; SELECT public.horse_stats_basis_accepted_keys();']).stderr)

            # Basis: same bytes without the key, no cards with it, refuses a non-array.
            check('basis without the key compacts to the same bytes',
                  run('SELECT smarter_private.horse_compact_stats_basis(' + literal(legacy) + ')::text;') == basis_before)
            compact = json.loads(run('SELECT smarter_private.horse_compact_stats_basis(' + literal(payload('basis')) + ');'))
            check('basis keeps no horse cards', 'horse_hole_cards' not in compact and 'As' not in json.dumps(compact))
            check('basis refuses a non-array list', 'HORSE_STATS_BASIS_INVALID_SHAPE' in run(
                'SELECT smarter_private.horse_compact_stats_basis(' + literal(payload('bad', horse_hole_cards={'a': 1})) + ');', False))

            # Horses only: the payload also names the human with cards; never kept.
            d = payload('hand')
            d['horse_hole_cards'].append(dict(user_id=HUMAN, seat=5, cards=['Qs', 'Qh', '9d', '8d']))
            accept('hand', d)
            res = project('hand')
            check('projection succeeds', res['ok'] is True and res['facts'] == 3)
            rows = json.loads(kept('hand'))
            check('both Horses kept with exact cards and seat, free fold included',
                  rows == [[HORSE, 2, ['As', 'Kd', 'Qh', 'Jc'], True, 'plo4'], [HORSE2, 7, ['2c', '3c', '4c', '5c'], True, 'plo4']])
            check('a human named in the payload is never kept',
                  run("SELECT count(*) FROM smarter_private.horse_dealt_hole_cards WHERE user_id='" + HUMAN + "';") == '0')
            project('hand')
            check('replay keeps exactly once', len(json.loads(kept('hand'))) == 2)

            # A profile flagged false, a seat that is not the Horse's, a Horse not dealt in.
            d = payload('forged')
            d['horse_hole_cards'] = [dict(user_id=NOT_HORSE, seat=2, cards=['As', 'Ad']),
                                     dict(user_id=HORSE, seat=3, cards=['As', 'Kd', 'Qh', 'Jc']),
                                     dict(user_id=uid('stranger'), seat=4, cards=['7s', '7d'])]
            accept('forged', d); project('forged')
            check('non-Horse profile, wrong seat and undealt user keep nothing', json.loads(kept('forged')) == [])

            # Malformed: nothing kept for that hand, the projection itself still succeeds.
            for label, bad in [('bad-card', ['As', 'Xx']), ('dup-card', ['As', 'As']), ('one-card', ['As']),
                               ('not-strings', [{'rank': 'A', 'suit': 'spades'}, 'Kd'])]:
                d = payload(label)
                d['horse_hole_cards'][0]['cards'] = bad
                accept(label, d)
                r2 = project(label)
                check(label + ': projection still succeeds', r2['ok'] is True)
                kept_rows = json.loads(kept(label))
                check(label + ': malformed entry is never kept', all(row[0] != HORSE for row in kept_rows))
            d = payload('bad-shape', horse_hole_cards='nope')
            accept('bad-shape', d)
            check('a non-array list never fails the projection', project('bad-shape')['ok'] is True and json.loads(kept('bad-shape')) == [])
            check('stats facts of a malformed hand are still projected',
                  run("SELECT count(*) FROM ca_hand_facts WHERE hand_id='" + uid('bad-shape') + "';") == '3')

            # Hand without any Horse cards: nothing, nothing else changes.
            accept('none', payload('none', cards=False)); project('none')
            check('a hand without the key keeps nothing', json.loads(kept('none')) == [])

            # Horse-only hand: has_human comes from hand_history.
            accept('horse-only', payload('horse-only'), has_human=False); project('horse-only')
            check('horse-only hand is marked for retention', all(row[3] is False for row in json.loads(kept('horse-only'))))

            # Lightning: the settler's validator passes the list through whole.
            lp = payload('lightning')
            passed = json.loads(run("SELECT fn_lightning_hand_stats_facts(" + literal({'_accepted_post_commit_facts': {'stats_facts': lp}})
                                    + ",'" + uid('lightning') + "','" + TABLE + "','" + CLUB + "');"))
            check('Lightning settler keeps the Horse card list intact', passed == {'stats_facts': lp})
            run("INSERT INTO lightning_hand VALUES ('" + uid('lightning') + "','" + TABLE + "');")
            accept('lightning', passed['stats_facts'], has_human=False); project('lightning')
            check('Lightning fast-fold Horse cards are kept', len(json.loads(kept('lightning'))) == 2)

            # Rollback: a later failure in the same projection keeps no cards.
            run("CREATE FUNCTION fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_receipt_failure'; END $$;"
                " CREATE TRIGGER injected BEFORE INSERT ON ca_hand_fact_projection_receipts FOR EACH ROW EXECUTE FUNCTION fixture_fail();")
            accept('rollback', payload('rollback'))
            check('fault is observable', 'injected_receipt_failure' in project('rollback', False))
            check('failed projection keeps no cards', json.loads(kept('rollback')) == [])
            run('DROP TRIGGER injected ON ca_hand_fact_projection_receipts;'); project('rollback')
            check('recovered projection keeps them once', len(json.loads(kept('rollback'))) == 2)

            # Privacy.
            check('anon and authenticated cannot read the table', run(
                "SELECT has_table_privilege('anon','smarter_private.horse_dealt_hole_cards','SELECT,INSERT,UPDATE,DELETE')"
                " OR has_table_privilege('authenticated','smarter_private.horse_dealt_hole_cards','SELECT,INSERT,UPDATE,DELETE');") == 'f')
            check('service role reads only', run(
                "SELECT has_table_privilege('service_role','smarter_private.horse_dealt_hole_cards','SELECT')"
                " AND NOT has_table_privilege('service_role','smarter_private.horse_dealt_hole_cards','INSERT,UPDATE,DELETE');") == 't')
            check('RLS on, no policy, no publication', run(
                "SELECT c.relrowsecurity AND NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid)"
                " AND NOT EXISTS(SELECT 1 FROM pg_publication_rel r WHERE r.prrelid=c.oid)"
                " FROM pg_class c WHERE c.oid='smarter_private.horse_dealt_hole_cards'::regclass;") == 't')
            check('no client or service role executes the writer or pruner', run(
                "SELECT bool_or(has_function_privilege(r,f,'execute')) FROM unnest(ARRAY['anon','authenticated','service_role']) r,"
                " unnest(ARRAY['smarter_private.project_horse_dealt_hole_cards(uuid,jsonb,uuid)','smarter_private.prune_horse_dealt_hole_cards(integer)']) f;") == 'f')
            check('no view or other function reads the table', run(
                "SELECT count(*) FROM pg_depend d JOIN pg_rewrite rw ON rw.oid=d.objid WHERE d.refobjid='smarter_private.horse_dealt_hole_cards'::regclass;") == '0'
                and run("SELECT string_agg(proname,',' ORDER BY proname) FROM pg_proc WHERE prosrc LIKE '%smarter_private.horse_dealt_hole_cards%';")
                == 'project_horse_dealt_hole_cards,prune_horse_dealt_hole_cards')
            check('anon cannot select (enforced)', 'permission denied' in command(
                [PG / 'psql', '-X', '-qAt', '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-c',
                 'SET ROLE anon; SELECT * FROM smarter_private.horse_dealt_hole_cards;']).stderr)

            # Retention matches hand_history.
            run("INSERT INTO smarter_private.horse_dealt_hole_cards(hand_id,user_id,seat,table_id,game_variant,hole_cards,played_at,has_human) VALUES"
                " ('" + uid('gone') + "','" + HORSE + "',1,'" + TABLE + "','nlh','{As,Kd}',now()-interval '9 days',false),"
                " ('" + uid('held') + "','" + HORSE + "',1,'" + TABLE + "','nlh','{As,Kd}',now()-interval '9 days',false),"
                " ('" + uid('keeper') + "','" + HORSE + "',1,'" + TABLE + "','nlh','{As,Kd}',now()-interval '9 days',false),"
                " ('" + uid('young') + "','" + HORSE + "',1,'" + TABLE + "','nlh','{As,Kd}',now()-interval '7 days',false),"
                " ('" + uid('human-hand') + "','" + HORSE + "',1,'" + TABLE + "','nlh','{As,Kd}',now()-interval '90 days',true);"
                "INSERT INTO hand_history(id,has_human) VALUES ('" + uid('held') + "',false),('" + uid('keeper') + "',true);")
            check('prune deletes only a past-window horse-only hand that hand_history let go',
                  run('SELECT smarter_private.prune_horse_dealt_hole_cards(100);') == '1')
            left = run("SELECT string_agg(hand_id::text||':'||has_human,',' ORDER BY hand_id) FROM smarter_private.horse_dealt_hole_cards"
                       " WHERE hand_id IN ('" + "','".join(uid(x) for x in ['gone', 'held', 'keeper', 'young', 'human-hand']) + "');")
            check('held, keeper (now kept), young and human hands remain',
                  left == ','.join(sorted([uid('held') + ':false', uid('keeper') + ':true', uid('young') + ':false', uid('human-hand') + ':true'])))
            check('prune is idempotent', run('SELECT smarter_private.prune_horse_dealt_hole_cards(100);') == '0')

            # Cost of the added projection step, post-commit (never on acceptance).
            timing = json.loads(run("""
DO $t$ DECLARE i int; t0 timestamptz; a numeric; b numeric; s jsonb; s0 jsonb; BEGIN
  s := (SELECT post_commit_payload#>'{accepted_hand_facts,stats_facts}' FROM hand_atomic_commits WHERE hand_id='""" + uid('hand') + """');
  s0 := s - 'horse_hole_cards';
  t0 := clock_timestamp();
  FOR i IN 1..2000 LOOP PERFORM smarter_private.project_horse_dealt_hole_cards(gen_random_uuid(), s0, '""" + TABLE + """'); END LOOP;
  a := extract(epoch FROM clock_timestamp()-t0)*1e6/2000;
  t0 := clock_timestamp();
  FOR i IN 1..2000 LOOP PERFORM smarter_private.project_horse_dealt_hole_cards(gen_random_uuid(), s, '""" + TABLE + """'); END LOOP;
  b := extract(epoch FROM clock_timestamp()-t0)*1e6/2000;
  PERFORM set_config('t.out', json_build_object('no_horse_us', round(a,1), 'two_horses_us', round(b,1))::text, false);
  DELETE FROM smarter_private.horse_dealt_hole_cards WHERE hand_id NOT IN (SELECT hand_id FROM hand_atomic_commits) AND played_at > now()-interval '1 day';
END $t$; SELECT current_setting('t.out');""").splitlines()[-1])
            check('projection step measured', timing['two_horses_us'] > 0)
        finally:
            command([PG / 'pg_ctl', '-D', data, '-m', 'immediate', '-w', 'stop'])
    print(json.dumps(dict(passed=True, checks=checks, projector_postimage_md5=post, basis_postimage_md5=basis_post,
                          projection_cost=timing,
                          migration_sha256=hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),
                          basis_key_migration_sha256=hashlib.sha256(BASIS_KEY.read_bytes()).hexdigest(),
                          production_mutations=False), indent=2))


if __name__ == '__main__':
    main()
