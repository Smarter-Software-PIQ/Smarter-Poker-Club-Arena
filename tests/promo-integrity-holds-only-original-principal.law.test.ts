import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Review holds preserve original custody independently of promo targets', () => {
  it('qualifies actual hand acceptance, financial consumers and concurrent review in the existing promo workflow', () => {
    const workflow = readFileSync('.github/workflows/promo-play-through.yml', 'utf8');
    for (const path of [
      'scripts/ci/test-promo-integrity.py',
      'scripts/ci/test-promo-integrity-accepted-hand.py',
      'scripts/ci/test-promo-fee-basis.py',
    ])
      expect(workflow).toContain(path);
    expect(workflow).toContain('supabase/migrations/*_suspect_promo_chip_dumping_*.sql');
    expect(workflow).toContain('artifacts/promo-integrity/RESULTS.json');
    expect(workflow).toContain('PG_ISOLATION_TESTER:');
    const hand = readFileSync('scripts/ci/test-promo-integrity-accepted-hand.py', 'utf8');
    expect(hand).toContain('roster.current_chain(root)');
    expect(hand).toContain('pg_temp.roster_commit');
    expect(hand).toContain('stalePinGuardSQL');
    const financial = readFileSync('scripts/ci/test-promo-fee-basis.py', 'utf8');
    expect(financial).toContain(
      'actual certified rakeback writer excludes H cash and entry funding'
    );
  });
});
