import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('An original promo grant keeps one target through its custody', () => {
  it('executes both principal accounting and the actual accepted-hand integration', () => {
    const workflow = read('.github/workflows/promo-play-through.yml');
    for (const script of ['test-promo-custody.py', 'test-promo-custody-accepted-hand.py']) {
      expect(workflow).toContain(`scripts/ci/${script}`);
      expect(workflow).toContain(`python3 -B scripts/ci/${script}`);
    }
    expect(workflow.indexOf('name: Retain the regression evidence')).toBeGreaterThan(
      workflow.indexOf('name: Promo custody runs in the original accepted hand')
    );
  });

  it('keeps the maintained full money authority closure in the integration proof', () => {
    const proof = read('scripts/ci/test-promo-custody-accepted-hand.py');
    expect(proof).toContain('hs.prepare(root,out)');
    expect(proof).toContain('roster.current_chain(root)');
    expect(proof).toContain('pg_temp.roster_commit(');
    expect(proof).toContain("'actual-accepted-cash-hand-and-replay'");
    expect(proof).toContain("e.report['status']='passed'");
  });
});
