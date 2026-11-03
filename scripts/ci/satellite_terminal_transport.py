"""Real HTTP loss + current satellite authority, inside the owning native runner."""
import json
from pathlib import Path
from satellite_qualifier_fixture import sha


def qualify(e, root, template, output, probe):
    # Reuse the current runner's authenticated funded opening and exact seat keys.
    marker = 'CREATE FUNCTION pg_temp.satellite_full_assert('
    if probe.count(marker) != 1:
        raise ValueError('current satellite transport opening seam differs')
    opening = probe.split(marker)[0]
    if opening.count('BEGIN;') != 1 or 'ROLLBACK;' in opening or 'COMMIT;' in opening:
        raise ValueError('satellite transport opening must have one original transaction')
    opening += 'SET CONSTRAINTS ALL IMMEDIATE;\nCOMMIT;\n'
    seed = output / 'transport-opening.sql'
    seed.write_text(opening)
    script = root / 'server/scripts/qualify-satellite-terminal-transport.ts'
    inputs = [Path(__file__), script, root / 'server/src/tournament/satelliteSettlementRpc.ts',
              root / 'server/src/tournament/satelliteSettlementReceipt.ts',
              root / 'server/src/services/supabase/client.ts']
    hashes = {str(p.relative_to(root)): sha(p) for p in inputs}
    proofs = []
    for scenario in ['committed-response-lost', 'inflight-commit', 'inflight-rollback', 'unresolved']:
        db = e.database(template)
        e.sql(db, file=seed, label='transport-' + scenario + '-funded-opening', seconds=90)
        result = output / ('transport-' + scenario + '.json')
        e.run('transport-' + scenario,
              [root / 'server/node_modules/.bin/tsx', script, e.socket, e.port, db, scenario, result],
              seconds=45)
        proof = json.loads(result.read_text())
        if proof.get('passed') is not True or proof.get('scenario') != scenario:
            raise RuntimeError('actual satellite transport proof missing: ' + scenario)
        proofs.append(proof)
        e.discard(db)
    for path, expected in hashes.items():
        if sha(root / path) != expected:
            raise RuntimeError('transport input changed during qualification: ' + path)
    e.report['satellite_terminal_transport'] = {'passed': True, 'cases': proofs,
      'limits': ['Current captured single-winner satellite authority; no historical Stage-B activation.',
                 'Real TypeScript maintenance client and TCP HTTP loss; local shim is not PostgREST.',
                 'Runtime manager teardown/re-admission and MTT/Spin/SNG/deal transport are separate gates.']}
    return hashes
