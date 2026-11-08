"""Funded qualifier ownership transfer on the original PostgreSQL settlement request."""
import json
from ordinary_terminal_transport import DATA, relation_name
from breakfast_fixture import function

MIGRATION = 'supabase/migrations/20261103115836_terminal_original_request_is_durable_before_settlement.sql'


def transport(e, root, output, database, kind, event, winner):
    custody = root / "scripts/ci/fixtures/terminal-original-request/custody-preimage.sql"
    candidate = root / MIGRATION
    transport_script = root / "server/scripts/qualify-terminal-intent-transport.ts"
    e.sql(database, file=custody, label='durable-' + kind + '-custody')
    e.sql(database, file=candidate, label='durable-' + kind + '-migration')
    result = output / ('transport-' + kind + '.json')
    e.run('durable-http-' + kind, [root / 'server/node_modules/.bin/tsx', transport_script,
        e.socket, e.port, database, result, event, winner, kind], seconds=60)
    proof = json.loads(result.read_text())
    if proof.get('passed') is not True or proof.get('format') != kind:
        raise RuntimeError('durable manager HTTP proof missing: ' + kind)
    e.discard(database)
    return proof


def satellite_lease_overlay(root, output):
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
    return lease_overlay


def bubble_handoff(e, root, output, satellite_template, qualifier_probe, lease_overlay=None):
    lease_overlay = lease_overlay or satellite_lease_overlay(root, output)
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
    return transport(e, root, output, database, 'QUALIFIERS', event.strip(), '')
