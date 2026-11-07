"""Post-thaw hand submission on the Nov 7 observed 59-table / ten-event footprint.

Only called with the existing private PG17 rehearsal owner. All IDs and money
are fixture data. Elapsed times include the queue for the bounded worker pool.
"""
from concurrent.futures import ThreadPoolExecutor
import json
import time
from uuid import UUID, uuid5

NAMESPACE = UUID('8f9c28a4-2a43-48da-96b5-84a581b5eb37')
TABLES = 59
EVENTS = 10
# The slowest surviving table at the observed 19:00Z boundary took 157.966s.
FIRST_HAND_BUDGET_SECONDS = 158


def fixture_id(original, owner):
    return str(uuid5(NAMESPACE, f'{original}:{owner}'))


def qualify(execution, db, output, root, alongside=None):
    # Reuse the actual retained-hand request payload, authoritative fixture
    # opening and money RPC. Seed privately while all financial hooks are off;
    # every measured hand below runs with the normal triggers enabled.
    opening = (output / 'opening.sql').read_text()
    probe = (root / 'scripts/ci/probes/hand-submission-native.sql').read_text()
    request = probe[:probe.index('CREATE FUNCTION pg_temp.commit_submission')]
    _, raw, _ = execution.sql(db, 'BEGIN;\n' + opening + request +
        '\nSELECT pg_temp.submission_request(); COMMIT;', label='peak-template')
    template = json.loads(raw.strip().splitlines()[-1])
    # Read only the exact synthetic opening, including all constraints. Each
    # clone gets a unique physical table, seats, users and hand identity.
    event = template['p_hand_row']['tournament_id']
    table = template['p_table_id']
    generation = template['p_lease_generation']
    seed = []
    requests = []
    _, result, _ = execution.sql(db, """SELECT string_agg(quote_ident(attname),',' ORDER BY attnum)
        FROM pg_attribute WHERE attrelid='public.tables'::regclass AND attnum>0
          AND NOT attisdropped AND attgenerated='' AND attidentity='';""", label='peak-table-columns')
    table_columns = result.strip()
    for i in range(TABLES):
        replacements = {event: fixture_id(event, i % EVENTS),
                        generation: fixture_id(generation, i % EVENTS),
                        table: fixture_id(table, i)}
        old_hand = template['p_hand_row']['id']
        replacements[old_hand] = fixture_id(old_hand, i)
        for seat in template['p_stacks']:
            for key in ('seat_id', 'user_id'):
                old = seat[key]
                replacements[old] = fixture_id(old, i)
        def convert(value):
            for old, new in replacements.items():
                value = value.replace(old, new)
            return value.replace("8600001", str(8600001 + i))
        for original in ('86600000-0000-0000-0000-000000000001', '86700000-0000-0000-0000-000000000001'):
            replacements[original] = fixture_id(original, i)
        original_claim = probe.split('END $cash_successor$;')[1].split('DO $retained$')[0]
        payload = convert(json.dumps(template))
        requests.append((replacements[old_hand], replacements[generation], payload))
        if i < EVENTS:
            seed.append(f"""INSERT INTO public.tournaments SELECT (jsonb_populate_record(t,
                  jsonb_build_object('id','{replacements[event]}','name','Peak {i}',
                    'max_players',120,'current_players',{2 * len(range(i,TABLES,EVENTS))}))).*
                FROM public.tournaments t WHERE id='{event}';
                INSERT INTO public.engine_tournament_leases
                  (tournament_id,instance_id,engine_version,acquired_at,heartbeat_at,lease_generation,protocol_version)
                VALUES ('{replacements[event]}','atomic-hand-boundary-probe','probe',now(),now(),'{replacements[generation]}',2);""")
        seed.append(f"""INSERT INTO public.tables ({table_columns}) SELECT {table_columns} FROM (SELECT (jsonb_populate_record(b,jsonb_build_object(
              'id','{replacements[table]}','tournament_id','{replacements[event]}',
              'seat_game_scope','table:{replacements[table]}','seat_admission_key','tournament:{replacements[event]}'))).*
              FROM public.tables b WHERE id='{table}') AS seed_table;""")
        for index, seat in enumerate(template['p_stacks']):
            user, chair = seat['user_id'], seat['seat_id']
            new_user, new_chair = replacements[user], replacements[chair]
            registration = fixture_id(chair, f'registration-{i}')
            username = f'peak_{i}_{index}'
            seed.append(f"""INSERT INTO auth.users(id) VALUES ('{new_user}');
                INSERT INTO public.users(id,username) VALUES ('{new_user}','{username}');
                INSERT INTO public.profiles(id,username,display_name) VALUES ('{new_user}','{username}','{username}');
                INSERT INTO public.club_members(club_id,user_id,role,status,chip_balance)
                  SELECT club_id,'{new_user}','player','active',chip_balance FROM public.club_members WHERE user_id='{user}';
                INSERT INTO public.tournament_players SELECT (jsonb_populate_record(p,jsonb_build_object(
                  'id','{registration}','tournament_id','{replacements[event]}','table_id','{replacements[table]}',
                  'user_id','{new_user}','username','{username}'))).* FROM public.tournament_players p
                  WHERE tournament_id='{event}' AND user_id='{user}';
                INSERT INTO public.table_seats SELECT (jsonb_populate_record(s,jsonb_build_object(
                  'id','{new_chair}','occupancy_id',gen_random_uuid(),'table_id','{replacements[table]}','user_id','{new_user}',
                  'active_game_scope','table:{replacements[table]}','active_parent_key','tournament:{replacements[event]}'))).*
                  FROM public.table_seats s WHERE id='{chair}';""")
        seed.append(convert(original_claim))
    execution.sql(db, 'BEGIN; SET LOCAL session_replication_role=replica;\n' +
                  '\n'.join(seed) + '\nCOMMIT;', label='peak-field')
    # The retained request precedes the thaw. Every worker uses its exact ID
    # once; success requires a durable hand AND completed post-commit.
    for hand, _, payload in requests:
        execution.sql(db, f"SELECT public.fn_ca_retain_hand_submission('{payload}'::jsonb);",
                      label='peak-retain-' + hand)
    freeze = probe.split("DROP TRIGGER zz_submission_postcommit_fault ON public.hand_atomic_commits;", 1)[1]
    freeze = freeze[:freeze.index("denied:=false;")]
    first_table = json.loads(requests[0][2])['p_table_id']
    execution.sql(db, freeze + f"""
      DO $f$ BEGIN
        PERFORM set_config('request.jwt.claim.role','service_role',true);
        PERFORM public.fn_ca_resume_hand_submission('{first_table}',
          'atomic-hand-boundary-probe','{requests[0][1]}');
        RAISE EXCEPTION 'expected frozen platform refusal';
      EXCEPTION WHEN SQLSTATE '55000' THEN
        IF SQLERRM <> 'HAND_SUBMISSION_PLATFORM_FROZEN' THEN RAISE; END IF;
      END $f$;""", label='peak-freeze-refusal')
    execution.sql(db, "DELETE FROM public.engine_maintenance_break WHERE id;", label='peak-thaw')
    started = time.monotonic()
    def submit(item):
        hand, generation, _ = item
        _, result, _ = execution.sql(db, f"SELECT public.fn_ca_commit_hand_submission('{hand}',"
            f"'atomic-hand-boundary-probe','{generation}');", label='peak-hand-' + hand)
        accepted = json.loads(result)
        if not (accepted.get('atomic_hand_commit') is True and
                accepted.get('snapshot_completed') is True and accepted.get('history_id') == hand):
            raise RuntimeError(f'unconfirmed peak hand {hand}: {accepted}')
        _, result, _ = execution.sql(db,
            f"SET request.jwt.claim.role='service_role'; SELECT public.fn_ca_process_hand_post_commit_obligations('{hand}');",
            label='peak-obligations-' + hand)
        if json.loads(result).get('ok') is not True:
            raise RuntimeError('incomplete peak hand ' + hand)
        return time.monotonic() - started
    with ThreadPoolExecutor(max_workers=8) as pool:
        concurrent_work = pool.submit(alongside) if alongside is not None else None
        latency = list(pool.map(submit, requests))
        concurrent_result = concurrent_work.result() if concurrent_work else None
    ids = ','.join("'" + hand + "'" for hand, _, _ in requests)
    _, count, _ = execution.sql(db, f'SELECT count(*) FROM public.hand_atomic_commits WHERE hand_id IN ({ids}) AND post_commit_completed_at IS NOT NULL;', label='peak-postcommit')
    if int(count) != TABLES or max(latency) > FIRST_HAND_BUDGET_SECONDS:
        raise RuntimeError(f'peak post-commit witnesses={count.strip()}, slowest={max(latency):.3f}s')
    return {'concurrentResult': concurrent_result, 'events': EVENTS, 'tables': TABLES, 'postcommits': int(count), 'slowestSeconds': max(latency)}
