"""Funded MTT/SNG/Spin transport faults in the existing private PG17 owner."""
import hashlib
import json
import re
from pathlib import Path

from breakfast_fixture import compose as foundation, function
from satellite_qualifier_fixture import sha

DATA = Path('scripts/ci/fixtures/ordinary-terminal-transport')
CATALOG_SHA = '7d606e35a3097323890fb4cc45518f6a0aa39307f8ee143c08beb252b92f469b'
SCENARIOS = ['committed-response-lost', 'inflight-commit', 'inflight-rollback', 'unresolved']


def relation_name(name):
    name = name if '.' in name else 'public.' + name
    if not re.fullmatch(r'(public|smarter_private)\.[a-z_][a-z_0-9]*', name):
        raise ValueError('unexpected captured relation identity')
    return name


def compose(root):
    path = root / DATA / 'current-catalog.json'
    if sha(path) != CATALOG_SHA:
        raise ValueError('current terminal transport catalog changed without qualification')
    captured = json.loads(path.read_text())
    base, hashes = foundation(root)  # Schema/owners only. Never Breakfast's historical opening.
    # Roles belong to the private cluster, so the existing satellite database
    # has already created them. Reuse only the identical least-privilege roles.
    roles = 'CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE ROLE supabase_auth_admin;'
    if base.count(roles) != 1:
        raise ValueError('maintained financial role construction changed')
    reuse = "DO $roles$ DECLARE name text; expected_bypass boolean; BEGIN "
    reuse += "FOREACH name IN ARRAY ARRAY['anon','authenticated','service_role','supabase_auth_admin'] LOOP "
    reuse += "expected_bypass := name='service_role'; IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=name) THEN "
    reuse += "IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=name AND rolbypassrls=expected_bypass AND NOT rolsuper AND NOT rolcanlogin AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication) THEN RAISE EXCEPTION 'private fixture role differs: %',name; END IF; "
    reuse += "ELSE EXECUTE format('CREATE ROLE %I %s',name,CASE WHEN expected_bypass THEN 'BYPASSRLS' ELSE '' END); END IF; END LOOP; END $roles$;"
    base = base.replace(roles, reuse)
    existing = {'tournament_launch_receipts', 'smarter_private.f06_prepared_hand_cancellations'}
    relations = [r for r in captured['relations'] if r['identity'] not in existing]
    sql = 'ALTER TABLE public.tournaments ADD COLUMN format_contract text;\n'
    capacity_path = root / 'supabase/migrations/20260917065000_mtt_dual_creation_preparation.sql'
    capacity = re.search(r'ALTER TABLE public\.tournaments ALTER COLUMN max_players DROP NOT NULL;\nALTER TABLE public\.tournaments ADD CONSTRAINT tournaments_recorded_entry_capacity CHECK \([\s\S]*?\n\);', capacity_path.read_text())
    if capacity is None:
        raise ValueError('authoritative unlimited MTT capacity schema is missing')
    sql += capacity.group() + '\n'
    hashes[str(capacity_path.relative_to(root))] = sha(capacity_path)
    sql += 'ALTER TABLE public.tournament_launch_receipts ADD COLUMN launch_player_ids uuid[];\n'
    for row in relations:
        if any(c['identity'] or c['generated'] for c in row['columns']):
            raise ValueError('captured column needs its original identity owner')
        sql += 'CREATE TABLE ' + relation_name(row['identity']) + '(' + ','.join(
            c['name'] + ' ' + c['type'] + (' DEFAULT ' + c['default'] if c['default'] else '')
            + (' NOT NULL' if c['notnull'] else '') for c in row['columns']) + ');\n'
    for row in captured['functions']:
        if hashlib.md5(row['definition'].encode()).hexdigest() != row['definition_md5']:
            raise ValueError('captured original function differs: ' + row['identity'])
        sql += function({**row, 'signature': row['identity'],
                         'acl': row['acl'].strip('{}').split(',') if row['acl'] else []})
    for row in relations:
        name = relation_name(row['identity'])
        for constraint in row['constraints'] or []:
            if not constraint['definition'].startswith(('TRIGGER', 'FOREIGN KEY')):
                sql += 'ALTER TABLE ' + name + ' ADD CONSTRAINT ' + constraint['name'] + ' ' + constraint['definition'] + ';\n'
        sql += 'ALTER TABLE ' + name + ' OWNER TO ' + row['owner'] + ';\n'
        sql += 'ALTER TABLE ' + name + (' ENABLE' if row['rls'] else ' DISABLE') + ' ROW LEVEL SECURITY;\n'
        if row['force_rls']:
            sql += 'ALTER TABLE ' + name + ' FORCE ROW LEVEL SECURITY;\n'
        sql += 'REVOKE ALL ON ' + name + ' FROM PUBLIC,anon,authenticated,service_role;\n'
        rights = {'a': 'INSERT', 'r': 'SELECT', 'w': 'UPDATE', 'd': 'DELETE',
                  'D': 'TRUNCATE', 'x': 'REFERENCES', 't': 'TRIGGER', 'm': 'MAINTAIN'}
        for acl in (row['acl'] or '{}').strip('{}').split(','):
            who, privileges = acl.split('=')
            if who != row['owner']:
                sql += 'GRANT ' + ','.join(rights[c] for c in privileges.split('/')[0]) + ' ON ' + name + ' TO ' + (who or 'PUBLIC') + ';\n'
        for policy in row['policies'] or []:
            sql += 'CREATE POLICY "' + policy['policyname'] + '" ON ' + name + ' AS ' + policy['permissive'] + ' FOR ' + policy['cmd'] + ' TO ' + ','.join(policy['roles'])
            sql += (' USING (' + policy['qual'] + ')' if policy['qual'] else '')
            sql += (' WITH CHECK (' + policy['with_check'] + ')' if policy['with_check'] else '') + ';\n'
        for trigger in row['triggers'] or []:
            if trigger['enabled'] != 'O':
                raise ValueError('new captured dependency trigger state needs explicit composition')
            sql += trigger['definition'] + ';\n'
    for row in relations:
        for constraint in row['constraints'] or []:
            if constraint['definition'].startswith('FOREIGN KEY'):
                sql += 'ALTER TABLE ' + relation_name(row['identity']) + ' ADD CONSTRAINT ' + constraint['name'] + ' ' + constraint['definition'] + ';\n'
    for index in captured['indexes']:
        if not index['valid'] or not index['ready']:
            raise ValueError('captured dependency index is not usable')
        if not index['constraint_owned'] and index['relation'] not in existing:
            sql += index['definition'] + ';\n'
    sql += ('CREATE TRIGGER zzzzzzz_tournaments_record_format BEFORE INSERT OR UPDATE OF '
            'format_contract,tournament_type,variant,max_players,min_players,table_size,'
            'satellite_target_id,satellite_target,club_id,union_id ON public.tournaments '
            'FOR EACH ROW EXECUTE FUNCTION public.fn_ca_guard_tournament_format();\n')
    # Verify exactly what was reconstructed, not just that CREATE succeeded.
    literal = json.dumps(captured['functions']).replace("'", "''")
    sql += "DO $owners$ DECLARE r jsonb; BEGIN FOR r IN SELECT value FROM jsonb_array_elements('" + literal + "'::jsonb) LOOP IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r->>'identity') AND md5(pg_get_functiondef(p.oid))=r->>'definition_md5' AND pg_get_userbyid(p.proowner)=r->>'owner' AND p.proacl::text IS NOT DISTINCT FROM r->>'acl' AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM r->'config') THEN RAISE EXCEPTION 'native captured terminal owner differs: %',r->>'identity'; END IF; END LOOP; END $owners$;\n"
    seam = 'CREATE EVENT TRIGGER ab_ca_money_rpc_registered'
    if base.count(seam) != 1:
        raise ValueError('maintained financial foundation seam changed')
    hashes[str(path.relative_to(root))] = sha(path)
    hashes[str(Path(__file__).relative_to(root))] = sha(Path(__file__))
    return base.replace(seam, sql + seam), hashes


def qualify(e, root, output):
    output = output / 'ordinary-transport'
    output.mkdir()
    sql, hashes = compose(root)
    schema = output / 'current-catalog.sql'
    schema.write_text(sql)
    template = e.database()
    e.sql(template, file=schema, label='ordinary-current-catalog', seconds=180)
    script = root / 'server/scripts/qualify-ordinary-terminal-transport.ts'
    for path in [script, root / 'server/src/tournament/terminalSettlementRpc.ts',
                 root / 'server/src/tournament/completionSettlementReceipt.ts',
                 root / 'server/src/services/supabase/client.ts']:
        hashes[str(path.relative_to(root))] = sha(path)
    proofs = []
    for kind in ['mtt', 'sng', 'spin']:
        opening = root / DATA / (kind + '-opening.sql')
        hashes[str(opening.relative_to(root))] = sha(opening)
        funded = e.database(template)
        e.sql(funded, file=opening, label='ordinary-' + kind + '-real-funded-opening', seconds=90)
        source = 'd3000000-0000-4000-8000-000000000002' if kind == 'mtt' else '92010000-0000-0000-0000-000000000001'
        winner_sql = "'d1000000-0000-4000-8000-000000000001'::uuid" if kind == 'mtt' else "md5('zero-default-spin-launch-user:" + ('2' if kind == 'sng' else '3') + "')::uuid"
        _, raw, _ = e.sql(funded, 'SELECT ' + winner_sql + ';', label='ordinary-' + kind + '-winner')
        winner = raw.strip()
        amount = '300' if kind == 'mtt' else '2'
        if kind == 'spin':
            _, raw, _ = e.sql(funded, "SELECT round((receipt->>'prize_pool')::numeric*(receipt->'payout_structure'->0->>'percentage')::numeric/100,2) FROM public.spin_draw_receipts WHERE tournament_id='" + source + "';", label='ordinary-spin-draw-oracle')
            amount = raw.strip()
        for scenario in SCENARIOS:
            db = e.database(funded)
            result = output / (kind + '-' + scenario + '.json')
            e.run('ordinary-' + kind + '-' + scenario,
                  [root / 'server/node_modules/.bin/tsx', script, e.socket, e.port, db,
                   scenario, result, source, winner, amount, kind.upper()], seconds=45)
            proof = json.loads(result.read_text())
            if proof.get('passed') is not True or proof.get('scenario') != scenario:
                raise RuntimeError('actual ordinary transport proof missing')
            proofs.append(proof)
            e.discard(db)
        e.discard(funded)
    e.discard(template)
    for path, expected in hashes.items():
        if sha(root / path) != expected:
            raise RuntimeError('ordinary transport input changed: ' + path)
    e.report['ordinary_terminal_transport'] = {'passed': True, 'cases': proofs,
        'limits': ['Synthetic opening capital, agreements and final roster/seat topology; no engine hand-continuity claim.',
                   'Real MTT three-entry and SNG two-entry zero-fee funding; Spin three-entry fee/reserve/draw authorities.',
                   'Current captured terminal owners on maintained financial schema; captured Stage B activation remains disabled.',
                   'Real TypeScript maintenance client and HTTP loss; local shim is not PostgREST or protocol-2 lease certification.',
                   'Runtime manager recovery, final-table deals and production adoption remain separate gates.']}
    return hashes
