"""Original terminal intent qualification inside the existing private PG owner."""
import json
import re
from pathlib import Path
from ordinary_terminal_transport import compose, DATA
from satellite_bubble_handoff import MIGRATION, transport, satellite_lease_overlay, bubble_handoff, install_original_request

# The final-deal doors' manager scope check, as production installs it.
# Until 2026-11-15 this fixture read the never-installed Stage-B body from
# 20260910055955_stage_b_current_postimage_contraction.sql.pending and emulated
# a hook marker (app.smarter_manager_request_fenced) production never sets, so
# the proposal deal passed here while production raised 42883 at every door.
SCOPE_MIGRATION = 'supabase/migrations/20261115052022_the_final_deal_manager_scope_resolves_and_the_v2_place_branc.sql'
SCOPE_REVOKE = ('REVOKE ALL ON FUNCTION public.fn_assert_tournament_manager_write_scope(uuid)\n'
                '  FROM PUBLIC, anon, authenticated, service_role;')
from satellite_qualifier_fixture import sha


def qualify(e, root, output, satellite_template=None, satellite_probe=None, qualifier_probe=None, maintenance_only=False):
    output = output / 'original-terminal-request'
    output.mkdir()
    schema, hashes = compose(root)
    foundation = output / 'catalog.sql'
    foundation.write_text(schema)
    template = e.database()
    e.sql(template, file=foundation, label='original-terminal-catalog', seconds=180)
    opening = root / DATA / 'sng-opening.sql'
    custody = root / 'scripts/ci/fixtures/terminal-original-request/custody-preimage.sql'
    candidate = root / MIGRATION
    script = root / 'server/scripts/qualify-terminal-intent.ts'
    for path in [Path(__file__), opening, custody, candidate, script]:
        hashes[str(path.relative_to(root))] = sha(path)
    e.sql(template, file=opening, label='original-terminal-funded-sng', seconds=90)
    e.sql(template, file=custody, label='original-terminal-custody-preimage')
    e.sql(template, file=candidate, label='original-terminal-migration')
    live_proofs = [line.removeprefix('-- @live-proof: ') for line in candidate.read_text().splitlines() if line.startswith('-- @live-proof: ')]
    if len(live_proofs) != 1:
        raise RuntimeError('exact original terminal live proof missing')
    _, proof, _ = e.sql(template, 'SELECT (' + live_proofs[0] + ');', label='original-terminal-live-proof')
    if proof.strip() != 't':
        raise RuntimeError('declared original terminal live proof refused')
    _, raw, _ = e.sql(template, """SELECT jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','smarter_private') AND p.proname IN
      ('fn_prepare_tournament_terminal_request','fn_read_tournament_terminal_request',
       'fn_resolve_tournament_terminal_request','fn_adopt_tournament_terminal_request',
       'fn_execute_tournament_terminal_request','fn_close_uncommitted_tournament_terminal_request',
       'fn_f06_assert_drained_manager_custody','assert_terminal_request_generation',
       'lock_terminal_request_lane','terminal_request_identity_valid',
       'terminal_request_identity_is_immutable','resolve_terminal_request','terminal_receipt_requires_original_request');""", label='original-terminal-installed-identities')
    identities = json.loads(raw)
    if len(identities) != 13:
        raise RuntimeError('original terminal installed identity inventory differs')
    proofs = []
    for scenario in ['commit-replay', 'close-queued-send', 'adopt-original', 'maintenance-before', 'maintenance-after', 'reservation-before', 'reservation-after']:
        database = e.database(template)
        if scenario.startswith(('maintenance-', 'reservation-')):
            capture = root / 'scripts/ci/fixtures/terminal-original-request/maintenance-owners.json'
            hashes[str(capture.relative_to(root))] = sha(capture)
            for owner in json.loads(capture.read_text()):
                e.sql(database, owner['definition']+';REVOKE ALL ON FUNCTION '+owner['signature']+' FROM PUBLIC,anon,authenticated,service_role;', label='actual-maintenance-'+owner['signature'].split('(')[0])
                _, actual, _ = e.sql(database, "SELECT md5(pg_get_functiondef('"+owner['signature']+"'::regprocedure));", label='maintenance-original-source-pin')
                if actual.strip()!=owner['md5']: raise RuntimeError('actual maintenance source changed')
                if 'service_role=X/postgres' in owner['acl']:
                    e.sql(database,'GRANT EXECUTE ON FUNCTION '+owner['signature']+' TO service_role;',label='maintenance-original-acl')
            patch = root / 'supabase/migrations/20261117100849_terminal_settlement_takes_the_existing_maintenance_lane.sql'
            hashes[str(patch.relative_to(root))] = sha(patch)
            if scenario == 'maintenance-after' or scenario.startswith('reservation-'):
                capped_path=root/'supabase/migrations/20261108154158_capped_frozen_satellite_cohort_awards.sql'
                hashes[str(capped_path.relative_to(root))]=sha(capped_path)
                capped=capped_path.read_text();marker='CREATE FUNCTION public.fn_execute_capped_satellite_terminal_request('
                e.sql(database,capped[capped.index(marker):].removesuffix('COMMIT;\n'),label='original-capped-terminal-wrapper')
                _, old_definition, _=e.sql(database,"SELECT pg_get_functiondef('public.fn_execute_tournament_terminal_request(uuid,uuid)'::regprocedure);",label='terminal-original-definition')
                e.sql(database,patch.read_text().replace('COMMIT;','ROLLBACK;'),label='terminal-maintenance-ddl-rollback')
                _, rollback_definition, _=e.sql(database,"SELECT pg_get_functiondef('public.fn_execute_tournament_terminal_request(uuid,uuid)'::regprocedure);",label='terminal-ddl-rollback-identity')
                if rollback_definition!=old_definition:raise RuntimeError('terminal maintenance DDL rollback changed original')
                e.sql(database, file=patch, label='terminal-maintenance-admission')
                declared=[line.removeprefix('-- @live-proof: ') for line in patch.read_text().splitlines() if line.startswith('-- @live-proof: ')]
                if len(declared)!=1:raise RuntimeError('terminal maintenance exact postimage proof missing')
                _, postimage_ok, _=e.sql(database,'SELECT ('+declared[0]+');',label='terminal-maintenance-exact-postimage')
                if postimage_ok.strip()!='t':raise RuntimeError('terminal maintenance postimage/ACL/config mismatch')
                _, actual, _=e.sql(database,"SELECT md5(pg_get_functiondef(p.oid)),p.proacl::text,p.proconfig::text FROM pg_proc p WHERE p.oid='public.fn_execute_tournament_terminal_request(uuid,uuid)'::regprocedure;",label='terminal-maintenance-postimage')
                (output/'maintenance-postimage.txt').write_text(actual)
                if '{postgres=X/postgres,service_role=X/postgres}' not in actual or 'lock_timeout=8s' not in actual or 'statement_timeout=45s' not in actual:raise RuntimeError('original terminal metadata changed')
        if scenario == 'reservation-after':
            reservation=root/'supabase/migrations/20261117112838_terminal_settlement_reserves_existing_maintenance_admission_.sql'
            hashes[str(reservation.relative_to(root))]=sha(reservation)
            drift=reservation.read_text().replace('BEGIN;','BEGIN; REVOKE EXECUTE ON FUNCTION public.fn_execute_tournament_terminal_request(uuid,uuid) FROM service_role;',1)
            refused, _, error=e.sql(database,drift,label='terminal-reservation-rejects-original-acl-drift',check=False)
            if not refused or 'TERMINAL_RESERVATION_ORIGINAL_OWNER_CHANGED' not in error:raise RuntimeError('terminal reservation must refuse original metadata drift')
            e.sql(database,reservation.read_text().replace('COMMIT;','ROLLBACK;'),label='terminal-reservation-ddl-rollback')
            _, rollback_pin, _=e.sql(database,"SELECT md5(pg_get_functiondef('public.fn_execute_tournament_terminal_request(uuid,uuid)'::regprocedure));",label='terminal-reservation-rollback-pin')
            if rollback_pin.strip()!='3628dcabd106aeb79bdefc748d65d11e':raise RuntimeError('terminal reservation rollback changed installed owner')
            e.sql(database,file=reservation,label='terminal-reservation-admission')
            declared=[line.removeprefix('-- @live-proof: ') for line in reservation.read_text().splitlines() if line.startswith('-- @live-proof: ')]
            if len(declared)!=1:raise RuntimeError('terminal reservation postimage proof missing')
            _, valid, _=e.sql(database,'SELECT ('+declared[0]+');',label='terminal-reservation-exact-postimage')
            if valid.strip()!='t':raise RuntimeError('terminal reservation postimage/ACL/config mismatch')
            _, final_pin, _=e.sql(database,"SELECT md5(pg_get_functiondef(p.oid)),p.proacl::text,p.proconfig::text FROM pg_proc p WHERE p.oid='public.fn_execute_tournament_terminal_request(uuid,uuid)'::regprocedure;",label='terminal-reservation-postimage')
            (output/'reservation-postimage.txt').write_text(final_pin)
        result = output / (scenario + '.json')
        e.run('original-terminal-' + scenario,
              [root / 'server/node_modules/.bin/tsx', script, e.socket, e.port, database, scenario, result], seconds=45)
        proof = json.loads(result.read_text())
        if proof.get('passed') is not True or proof.get('scenario') != scenario:
            raise RuntimeError('original terminal native proof missing')
        proofs.append(proof)
        e.discard(database)
    e.discard(template)
    if maintenance_only:
        e.report['terminal_maintenance'] = proofs
        return hashes
    transport_script = root / 'server/scripts/qualify-terminal-intent-transport.ts'
    transport_inputs = [transport_script, root / 'server/src/tournament/terminalDurableRequest.ts', root / 'server/src/tournament/terminalRequestIdentity.ts', root / 'server/src/services/supabase/client.ts',
        root / 'server/src/tournament/terminalSettlementRpc.ts', root / 'server/src/tournament/satelliteSettlementRpc.ts',
        root / 'server/src/tournament/satelliteQualifierRpc.ts', root / 'server/src/services/supabase/dataActorContext.ts']
    hashes.update({str(p.relative_to(root)): sha(p) for p in transport_inputs})
    transport_proofs = []
    def run_transport(database, kind, event, winner, installed=False):
        transport_proofs.append(transport(e, root, output, database, kind, event, winner, installed))
    for kind in ['mtt', 'sng', 'spin']:
        database = e.database()
        e.sql(database, file=foundation, label='durable-' + kind + '-catalog', seconds=180)
        seed = root / DATA / (kind + '-opening.sql')
        hashes[str(seed.relative_to(root))] = sha(seed)
        e.sql(database, file=seed, label='durable-' + kind + '-opening', seconds=90)
        event = 'd3000000-0000-4000-8000-000000000002' if kind == 'mtt' else '92010000-0000-0000-0000-000000000001'
        winner_sql = "'d1000000-0000-4000-8000-000000000001'::uuid" if kind == 'mtt' else "md5('zero-default-spin-launch-user:" + ('2' if kind == 'sng' else '3') + "')::uuid"
        _, winner, _ = e.sql(database, 'SELECT ' + winner_sql + ';', label='durable-winner-' + kind)
        run_transport(database, kind.upper(), event, winner.strip())
    # Reuse the real funded SNG opening with two live equal stacks. Only the
    # synthetic final roster changes; entry debits and current payers are intact.
    deal_seed = (root / DATA / 'sng-opening.sql').read_text()
    begin = 'UPDATE public.tournament_players SET chips=CASE'
    end = 'SET LOCAL session_replication_role=origin;'
    if deal_seed.count(begin) != 1:
        raise RuntimeError('funded deal opening seam differs')
    start = deal_seed.index(begin)
    stop = deal_seed.index(end, start)
    deal_seed = deal_seed[:start] + """UPDATE public.tournament_players SET chips=1000,status='playing',position=NULL,elimination_sequence=NULL,eliminated_at=NULL WHERE tournament_id='92010000-0000-0000-0000-000000000001';
UPDATE public.tournaments SET current_players=2,status='RUNNING',started_at=now()-interval '1 hour',prize_pool_finalized=true,entry_contract_locked=true,final_table_deal_enabled=true WHERE id='92010000-0000-0000-0000-000000000001';
""" + deal_seed[stop:]
    deal_opening = output / 'deal-opening.sql'
    deal_opening.write_text(deal_seed)
    scope_path = root / SCOPE_MIGRATION
    scope_source = scope_path.read_text()
    scope = re.findall(r'(CREATE FUNCTION public\.fn_assert_tournament_manager_write_scope\(.*?AS (\$[^$]*\$).*?\2;)', scope_source, re.S)
    if len(scope) != 1 or scope_source.count(SCOPE_REVOKE) != 1:
        raise RuntimeError('exact manager scope source missing')
    if 'smarter_manager_request_fenced' in scope[0][0] or \
            'smarter_private.assert_terminal_request_generation(p_tournament_id, v_generation)' not in scope[0][0]:
        raise RuntimeError('manager scope must assert the durable terminal door authority')
    expansion = root / 'scripts/deploy/phase-three-versioned-final-deal.sql'
    activation = root / 'scripts/deploy/phase-three-activate-versioned-final-deal.sql'
    consent = root / 'scripts/ci/fixtures/terminal-original-request/deal-consent.sql'
    legacy_votes = root / 'scripts/ci/fixtures/terminal-original-request/legacy-deal-votes.sql'
    for path in [scope_path, expansion, activation, consent, legacy_votes]:
        hashes[str(path.relative_to(root))] = sha(path)
    for kind in ['LEGACY_DEAL', 'PROPOSAL_DEAL']:
        database = e.database()
        e.sql(database, file=foundation, label='durable-' + kind + '-catalog', seconds=180)
        e.sql(database, file=deal_opening, label='durable-' + kind + '-funded-opening', seconds=90)
        install_original_request(e, root, database, kind)
        e.sql(database, scope[0][0] + '\n' + SCOPE_REVOKE, label='durable-' + kind + '-exact-manager-scope')
        e.sql(database, file=expansion, label='durable-' + kind + '-consent-expansion')
        if kind == 'PROPOSAL_DEAL':
            e.sql(database, file=activation, label='durable-proposal-activation')
            e.sql(database, file=consent, label='durable-real-participant-consent')
        else:
            e.sql(database, file=legacy_votes, label='durable-legacy-consent')
        run_transport(database, kind, '92010000-0000-0000-0000-000000000001', '', installed=True)
    if satellite_template is not None:
        lease_overlay = satellite_lease_overlay(root, output)
        marker = 'CREATE FUNCTION pg_temp.satellite_full_assert('
        if satellite_probe.count(marker) != 1:
            raise RuntimeError('durable satellite opening seam differs')
        seed = output / 'satellite-opening.sql'
        seed.write_text(satellite_probe.split(marker)[0] + 'SET CONSTRAINTS ALL IMMEDIATE; COMMIT;\n')
        database = e.database(satellite_template)
        e.sql(database, file=lease_overlay, label='durable-satellite-manager-lease')
        e.sql(database, file=seed, label='durable-satellite-opening', seconds=90)
        run_transport(database, 'SATELLITE', 'd3000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002')
        transport_proofs.append(bubble_handoff(e, root, output, satellite_template, qualifier_probe, lease_overlay))
    expected_formats = ['MTT', 'SNG', 'SPIN', 'LEGACY_DEAL', 'PROPOSAL_DEAL', 'SATELLITE', 'QUALIFIERS'] if satellite_template is not None else ['MTT', 'SNG', 'SPIN', 'LEGACY_DEAL', 'PROPOSAL_DEAL']
    if [proof['format'] for proof in transport_proofs] != expected_formats:
        raise RuntimeError('durable transport format inventory differs')
    e.report['durable_terminal_transport'] = {'passed': True, 'all_tournament_formats': satellite_template is not None, 'cases': transport_proofs}
    for path, expected in hashes.items():
        if sha(root / path) != expected:
            raise RuntimeError('original terminal input changed: ' + path)
    e.report['original_terminal_request'] = {'passed': True, 'cases': proofs,
        'installed_function_md5': identities,
        'limits': ['Actual paid SNG, original canonical payer, protocol-2 generations and PostgreSQL locks.',
                   'Synthetic final roster and isolated clock advance model the crash; no production hand-continuity claim.',
                   'All five request kinds execute their original financial owners through the durable HTTP wrapper.']}
    return hashes
