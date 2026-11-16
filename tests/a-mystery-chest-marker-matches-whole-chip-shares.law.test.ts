import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('LAW: the shared Mystery marker has retained native regression coverage', () => {
  it('runs the actual PostgreSQL marker and acknowledgement proof in the required accounting shard', () => {
    const native = readFileSync('scripts/ci/test-mystery-whole-chip-marker.py', 'utf8');
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(workflow).toContain(
      'Shared mystery chests retain exact whole-chip and legacy settlement proof'
    );
    expect(workflow).toMatch(
      /Shared mystery chests retain exact whole-chip and legacy settlement proof\s+if: matrix\.shard == 2\s+env:\s+PG_BIN: \/usr\/lib\/postgresql\/17\/bin\s+TMPDIR: \$\{\{ runner\.temp \}\}\s+run: python3 -B scripts\/ci\/test-mystery-whole-chip-marker\.py/
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
