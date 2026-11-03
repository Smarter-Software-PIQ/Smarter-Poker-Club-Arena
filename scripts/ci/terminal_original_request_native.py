"""Original terminal intent qualification inside the existing private PG owner."""
import json
from pathlib import Path
from ordinary_terminal_transport import compose, DATA
from satellite_qualifier_fixture import sha

MIGRATION = 'supabase/migrations/20261103115836_terminal_original_request_is_durable_before_settlement.sql'


def qualify(e, root, output):
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
    for path, expected in hashes.items():
        if sha(root / path) != expected:
            raise RuntimeError('original terminal input changed: ' + path)
    e.report['original_terminal_request'] = {'passed': True, 'cases': proofs,
        'installed_function_md5': identities,
        'limits': ['Actual paid SNG, original canonical payer, protocol-2 generations and PostgreSQL locks.',
                   'Synthetic final roster and isolated clock advance model the crash; no production hand-continuity claim.',
                   'All five request-kind manager dispatches have separate focused runtime regressions.']}
    return hashes
