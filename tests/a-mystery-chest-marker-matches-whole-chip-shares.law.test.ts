import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('LAW: the shared Mystery marker has retained native regression coverage', () => {
  it('runs the marker and acknowledgement proof through the required Mystery native entry point', () => {
    const native = readFileSync('scripts/ci/test-mystery-whole-chip-marker.py', 'utf8');
    const runner = readFileSync('scripts/ci/test-mystery-award-page-order.py', 'utf8');
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(workflow).toContain(
      'python3 -B scripts/ci/test-mystery-award-page-order.py --pg-bin "$PG_BIN" --scratch "${{ runner.temp }}"'
    );
    expect(runner).toMatch(
      /subprocess\.run\(\s*\[sys\.executable, str\(ROOT \/ 'scripts\/ci\/test-mystery-whole-chip-marker\.py'\)\],\s*env=dict\(os\.environ, PG_BIN=str\(pg\), TMPDIR=str\(args\.scratch\.resolve\(\)\)\),\s*check=True/
    );
    expect(native).toContain("'fn_ack_bounty_obligation_from_award'");
    expect(native).toContain("'fn_bounty_obligation_has_complete_marker'");
    expect(native).toContain('AFTER INSERT OR UPDATE OF status');
    for (const proof of [
      'wrong remainder',
      'wrong sum',
      'outsider',
      'unpaid zero recipient',
      'missing zero recipient',
      'mixed unit cut',
      'incorrect PKO half',
      'fractional Diamond half',
    ]) {
      expect(native).toContain(proof);
    }
    expect(native).toContain('migration changed financial evidence');
    expect(native).toContain('repeated acknowledgement changed settled evidence');
    expect(native).toContain('PostgreSQL 17 required');
  });
});
