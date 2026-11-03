"""Original terminal intent qualification inside the existing private PG owner."""
import json
import re
from pathlib import Path
from ordinary_terminal_transport import compose, DATA, relation_name
from breakfast_fixture import function
from satellite_qualifier_fixture import sha

MIGRATION = 'supabase/migrations/20261103115836_terminal_original_request_is_durable_before_settlement.sql'


def qualify(e, root, output, satellite_template=None, satellite_probe=None, qualifier_probe=None):
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
    for scenario in ['commit-replay', 'close-queued-send', 'adopt-original']:
        database = e.database(template)
        result = output / (scenario + '.json')
        e.run('original-terminal-' + scenario,
              [root / 'server/node_modules/.bin/tsx', script, e.socket, e.port, database, scenario, result], seconds=45)
        proof = json.loads(result.read_text())
        if proof.get('passed') is not True or proof.get('scenario') != scenario:
            raise RuntimeError('original terminal native proof missing')
        proofs.append(proof)
        e.discard(database)
    e.discard(template)
    transport_script = root / 'server/scripts/qualify-terminal-intent-transport.ts'
    transport_inputs = [transport_script, root / 'server/src/tournament/terminalDurableRequest.ts', root / 'server/src/tournament/terminalRequestIdentity.ts', root / 'server/src/services/supabase/client.ts',
        root / 'server/src/tournament/terminalSettlementRpc.ts', root / 'server/src/tournament/satelliteSettlementRpc.ts',
        root / 'server/src/tournament/satelliteQualifierRpc.ts', root / 'server/src/services/supabase/dataActorContext.ts']
    hashes.update({str(p.relative_to(root)): sha(p) for p in transport_inputs})
    transport_proofs = []
    def run_transport(database, kind, event, winner):
        e.sql(database, file=custody, label='durable-' + kind + '-custody')
        e.sql(database, file=candidate, label='durable-' + kind + '-migration')
        result = output / ('transport-' + kind + '.json')
        e.run('durable-http-' + kind, [root / 'server/node_modules/.bin/tsx', transport_script,
            e.socket, e.port, database, result, event, winner, kind], seconds=60)
        proof = json.loads(result.read_text())
        if proof.get('passed') is not True or proof.get('format') != kind:
            raise RuntimeError('durable manager HTTP proof missing: ' + kind)
        transport_proofs.append(proof)
        e.discard(database)
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
    scope_path = root / 'supabase/migrations/20260910055955_stage_b_current_postimage_contraction.sql.pending'
    scope = re.findall(r'(CREATE OR REPLACE FUNCTION public\.fn_assert_tournament_manager_write_scope\(.*?AS (\$[^$]*\$).*?\2;)', scope_path.read_text(), re.S)
    if len(scope) != 1:
        raise RuntimeError('exact manager scope source missing')
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
        e.sql(database, scope[0][0], label='durable-' + kind + '-exact-manager-scope')
        e.sql(database, file=expansion, label='durable-' + kind + '-consent-expansion')
        if kind == 'PROPOSAL_DEAL':
            e.sql(database, file=activation, label='durable-proposal-activation')
            e.sql(database, file=consent, label='durable-real-participant-consent')
        else:
            e.sql(database, file=legacy_votes, label='durable-legacy-consent')
        run_transport(database, kind, '92010000-0000-0000-0000-000000000001', '')
    if satellite_template is not None:
        # Satellite's structural fixture predates manager lease/F06 owners.
        # Add the exact captured current dependencies, never a fake lease grant.
        captured = json.loads((root / DATA / 'current-catalog.json').read_text())
        lease_tables = {'smarter_private.f06_generation_aborts', 'smarter_private.f06_unsettled_hand_aborts',
          'smarter_private.f06_mixed_abort_generations', 'smarter_private.f06_mixed_aborts',
          'smarter_private.f06_manager_custody_transfers', 'smarter_private.f06_manager_custody_completions'}
        selected = [r for r in captured['relations'] if r['identity'] in lease_tables]
        if len(selected) != 6:
            raise RuntimeError('manager lease relation inventory differs')
        overlay = ''
        for r in selected:
            overlay += 'CREATE TABLE ' + relation_name(r['identity']) + '(' + ','.join(c['name'] + ' ' + c['type'] + (' DEFAULT ' + c['default'] if c['default'] else '') + (' NOT NULL' if c['notnull'] else '') for c in r['columns']) + ');\n'
        for f in captured['functions']:
            if f['identity'].startswith(('claim_tournament_lease_v2(', 'fn_engine_lease_stale_seconds(', 'smarter_private.f06_')):
                overlay += function({**f, 'signature': f['identity'], 'acl': f['acl'].strip('{}').split(',') if f['acl'] else []})
        for r in selected:
            name = relation_name(r['identity'])
            for c in r['constraints'] or []:
                if not c['definition'].startswith(('TRIGGER', 'FOREIGN KEY')):
                    overlay += 'ALTER TABLE ' + name + ' ADD CONSTRAINT ' + c['name'] + ' ' + c['definition'] + ';\n'
            overlay += 'ALTER TABLE ' + name + ' OWNER TO ' + r['owner'] + ';\n'
            overlay += 'ALTER TABLE ' + name + (' ENABLE' if r['rls'] else ' DISABLE') + ' ROW LEVEL SECURITY;\n'
            if r['force_rls']: overlay += 'ALTER TABLE ' + name + ' FORCE ROW LEVEL SECURITY;\n'
            overlay += 'REVOKE ALL ON ' + name + ' FROM PUBLIC,anon,authenticated,service_role;\n'
            rights = {'a':'INSERT','r':'SELECT','w':'UPDATE','d':'DELETE','D':'TRUNCATE','x':'REFERENCES','t':'TRIGGER','m':'MAINTAIN'}
            for acl in (r['acl'] or '{}').strip('{}').split(','):
                who, privileges = acl.split('=')
                if who != r['owner']: overlay += 'GRANT ' + ','.join(rights[c] for c in privileges.split('/')[0]) + ' ON ' + name + ' TO ' + (who or 'PUBLIC') + ';\n'
            if r['policies']: raise RuntimeError('lease overlay policy needs original owner')
            for trigger in r['triggers'] or []:
                if trigger['enabled'] != 'O': raise RuntimeError('lease overlay trigger disabled')
                overlay += trigger['definition'] + ';\n'
        for r in selected:
            for c in r['constraints'] or []:
                if c['definition'].startswith('FOREIGN KEY'):
                    overlay += 'ALTER TABLE ' + relation_name(r['identity']) + ' ADD CONSTRAINT ' + c['name'] + ' ' + c['definition'] + ';\n'
        for index in captured['indexes']:
            if index['relation'] in lease_tables and not index['constraint_owned']:
                overlay += index['definition'] + ';\n'
        lease_overlay = output / 'satellite-manager-lease.sql'
        lease_overlay.write_text(overlay)
        marker = 'CREATE FUNCTION pg_temp.satellite_full_assert('
        if satellite_probe.count(marker) != 1:
            raise RuntimeError('durable satellite opening seam differs')
        seed = output / 'satellite-opening.sql'
        seed.write_text(satellite_probe.split(marker)[0] + 'SET CONSTRAINTS ALL IMMEDIATE; COMMIT;\n')
        database = e.database(satellite_template)
        e.sql(database, file=lease_overlay, label='durable-satellite-manager-lease')
        e.sql(database, file=seed, label='durable-satellite-opening', seconds=90)
        run_transport(database, 'SATELLITE', 'd3000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002')
        source = qualifier_probe.read_text()
        marker = "SELECT 'SATELLITE_QUALIFIER_NATIVE_EVIDENCE='"
        if source.count(marker) != 1:
            raise RuntimeError('durable qualifier opening seam differs')
        seed = output / 'qualifier-opening.sql'
        seed.write_text(source.split(marker)[0] + "SELECT pg_temp.qualifier_case('durable',2,false); SET CONSTRAINTS ALL IMMEDIATE; COMMIT;\n")
        database = e.database(satellite_template)
        e.sql(database, file=lease_overlay, label='durable-satellite-manager-lease')
        e.sql(database, file=seed, label='durable-qualifier-opening', seconds=90)
        _, event, _ = e.sql(database, "SELECT id FROM public.tournaments WHERE name='Native Qualifier Source durable';", label='durable-qualifier-event')
        run_transport(database, 'QUALIFIERS', event.strip(), '')
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
