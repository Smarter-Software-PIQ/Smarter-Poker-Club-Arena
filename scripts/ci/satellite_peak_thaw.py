"""Two funded feeders settle to the same target during the measured post-thaw hand workload."""
from concurrent.futures import ThreadPoolExecutor
import json
import time
from threading import Barrier

from satellite_qualifier_fixture import module, sha

AWARD_BUDGET_SECONDS = 148


def qualify(execution, root, db, output, probe):
    from tournament_peak_thaw import qualify as qualify_hands

    hand = module(root / 'scripts/ci/test-hand-submission.py', 'satellite_peak_hand_fixture')
    directory = output / 'peak-hands'
    directory.mkdir()
    manifest = hand.prepare(root, directory)
    execution.report['source_sha256'].update(manifest['source_sha256'])
    closure = (directory / 'current-authorities.sql').read_text()
    # The satellite bootstrap has already installed and verified the same money
    # DDL guard. Preserve its active trigger when adding the hand authorities.
    trigger = "CREATE EVENT TRIGGER ab_ca_money_rpc_registered ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION') EXECUTE FUNCTION public.fn_ca_money_rpc_registry_guard();"
    if closure.count(trigger) != 1:
        raise ValueError('hand closure money trigger identity changed')
    execution.sql(db, closure.replace(trigger, ''), label='peak-hand-authorities', seconds=120)
    execution.sql(db, file=root / hand.MIGRATION, label='peak-hand-admission')
    lane = root / 'supabase/migrations/20261107190137_a_blocked_satellite_target_releases_the_shared_finish_lane.sql'
    execution.sql(db, file=lane, label='peak-isolated-settlement-lane')
    seed = probe.read_text().split("SELECT 'SATELLITE_QUALIFIER_NATIVE_EVIDENCE='")[0]
    _, raw, _ = execution.sql(db, seed + """
        SELECT pg_temp.qualifier_case('race',2,false);
        COMMIT; BEGIN;
        SELECT pg_temp.qualifier_case('peer',1,false,'race');
        DROP TRIGGER native_qualifier_final_close ON public.tables;
        COMMIT;""", label='peak-fund-original-cohorts', seconds=120)
    cases = [json.loads(line) for line in raw.splitlines() if line.startswith('{')]
    if len(cases) != 2 or cases[0]['target_id'] != cases[1]['target_id']:
        raise ValueError('two funded sources for one target required')

    # The shared historical hand template predates recorded format. Give the
    # finite synthetic MTT opening its original, capacity-bearing identity.
    execution.sql(db, """BEGIN; SET LOCAL session_replication_role=replica;
        UPDATE public.tournaments SET tournament_type='MTT', variant='freezeout', format_contract='mtt-v1'
        WHERE id='30000000-0000-0000-0000-000000000001' AND name='Atomic Probe Template';
        COMMIT;""", label='peak-original-hand-format')
    start_together = Barrier(2, timeout=15)

    def settle(case):
        start_together.wait()
        start = time.monotonic()
        source, target = case['tournament_id'], case['target_id']
        qualifiers = ','.join("'" + x + "'::uuid" for x in sorted(case['qualifier_ids']))
        _, raw, _ = execution.sql(db, f"""BEGIN;
            SET LOCAL ROLE service_role;
            SELECT set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
            SELECT clock_timestamp();
            SELECT public.fn_settle_satellite_qualifiers('{source}',ARRAY[{qualifiers}]);
            COMMIT;
            SELECT clock_timestamp();""", label='peak-award-'+source, seconds=AWARD_BUDGET_SECONDS)
        received = raw.strip().splitlines()
        began, receipt, committed = received[-3], json.loads(received[-2]), received[-1]
        if receipt.get('fully_settled') is not True or receipt.get('receipt_version') != 3:
            raise RuntimeError('original funded settlement receipt invalid: '+source)
        _, raw, _ = execution.sql(db, f"""SELECT jsonb_build_object(
            'awards', (SELECT count(*) FROM public.tournament_satellite_awards WHERE tournament_id='{source}' AND delivery_kind='seat'),
            'usableAwards', (SELECT count(*) FROM public.tournament_satellite_awards a
              JOIN public.tournament_players p ON p.id=a.registration_id AND p.user_id=a.user_id AND p.source_satellite_id=a.tournament_id
              JOIN public.tournaments t ON t.id=p.tournament_id
              WHERE a.tournament_id='{source}' AND a.delivery_kind='seat' AND t.id='{target}' AND t.status='REGISTERING'
                AND p.status='registered' AND p.is_satellite_qualifier),
            'escrowClosed', (SELECT prize_balance=0 AND prize_out=105 AND closed_at IS NOT NULL
              FROM public.tournament_escrow WHERE tournament_id='{source}'));""",
            label='peak-funded-award-witness-'+source)
        result = json.loads(raw)
        elapsed = time.monotonic() - start
        if result != {'awards': 2, 'usableAwards': 2, 'escrowClosed': True} or elapsed > AWARD_BUDGET_SECONDS:
            raise RuntimeError(f'funded target receipts {source}: {result} after {elapsed:.3f}s')
        return dict(result, beganAt=began, committedAt=committed, elapsedSeconds=elapsed, sourceId=source, targetId=target, qualifiers=len(case['qualifier_ids']))

    def concurrent_awards():
        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(settle, cases))
        since = max(row['beganAt'] for row in results)
        until = min(row['committedAt'] for row in results)
        _, raw, _ = execution.sql(db, f"""SELECT jsonb_build_object('handId',h.hand_id,'committedAt',h.committed_at)
            FROM public.hand_atomic_commits h JOIN public.tables t ON t.id=h.table_id
            JOIN public.tournaments e ON e.id=t.tournament_id
            WHERE e.name ~ '^Peak [0-9]+$' AND h.committed_at BETWEEN '{since}'::timestamptz AND '{until}'::timestamptz
            ORDER BY h.committed_at LIMIT 1;""", label='peak-award-hand-overlap')
        if not raw.strip():
            raise RuntimeError('no actual peak hand commit inside both original funded finish intervals')
        return {'targetId': cases[0]['target_id'], 'sources': results,
                'overlapWitness': json.loads(raw)}

    for path in [lane, probe, root / 'scripts/ci/satellite_peak_thaw.py']:
        execution.report['source_sha256'][str(path.relative_to(root))] = sha(path)
    return qualify_hands(execution, db, directory, root, alongside=concurrent_awards)
