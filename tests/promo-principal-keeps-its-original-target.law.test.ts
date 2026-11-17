import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('An original promo grant keeps one target through its custody', () => {
  it('binds baseline owners separately from the history-aware activation proof', () => {
    const baseline = read('scripts/ci/test-promo-play-through.py');
    expect(baseline).toContain('BASE_MIGRATION_FILES = (');
    for (const name of [
      '20261115210559_promo_play_through_lock_ledger_and_fee_meter.sql',
      '20261115225224_promo_play_through_records_a_grant_at_the_promo_ledger_row.sql',
      '20261115235049_promo_play_through_refuses_locked_chips_at_the_exits.sql',
      '20261116013806_promo_play_through_never_locks_real_chips.sql',
      '20261116145205_promo_play_through_scopes_real_credits_to_their_transaction_.sql',
    ])
      expect(baseline).toContain(name);
    expect(baseline).not.toContain('*_promo_play_through_*.sql');
    for (const name of [
      'test-promo-custody-accepted-hand.py',
      'test-promo-integrity-accepted-hand.py',
      'test-promo-profit-accepted-hand.py',
      'test-promo-principal-returns.py',
      'test-promo-profit-bbj-financial.py',
    ]) {
      const consumer = read(`scripts/ci/${name}`);
      expect(consumer).toContain(
        "module(root/'scripts/ci/test-promo-play-through.py','promo_baseline')"
      );
      expect(consumer).toContain(
        "base_migrations=[root/'supabase/migrations'/name for name in baseline.BASE_MIGRATION_FILES]"
      );
      expect(consumer).not.toContain('*_promo_play_through_*.sql');
      expect(consumer).toMatch(/for (?:f|file) in base_migrations/);
    }
    expect(read('.github/workflows/promo-play-through.yml')).toContain(
      'python3 -B scripts/ci/test-promo-activation.py --pg-bin /usr/lib/postgresql/17/bin'
    );
  });

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

  it('preserves the actual inventory funding authority and its protected applier check', () => {
    const proof = read('scripts/ci/test-promo-custody.py');
    expect(proof).toContain('stalePinGuardSQL');
    expect(proof).toContain('migration_left_a_stale_pin');
    expect(proof).toContain("inventory['funding_owners']");
    expect(proof).toContain('inventory guard retains its original private owner and ACL');
    expect(read('.github/workflows/promo-play-through.yml')).toContain(
      'tests/fixtures/promo-custody-inventory-pin.json'
    );
  });
});
