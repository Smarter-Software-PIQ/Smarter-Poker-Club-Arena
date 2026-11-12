import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const migration = read(
  'supabase/migrations/20261112050118_agent_promo_sends_are_capped_at_fifty_chips_per_downline_in_.sql'
);

describe('Every downline shares 50 promo chips across all uplines for seven days', () => {
  it('installs at the existing authoritative core and retains its exact preimage', () => {
    expect(migration).toContain('fn_promo_wallet_send_core_20261004');
    expect(migration).toContain('9902bccc4d422766b3611e050eeec770');
    expect(migration).toContain("v_actor_role in ('super_agent', 'agent', 'sub_agent')");
    expect(migration).toContain("interval '168 hours'");
    expect(migration).toContain('50::numeric - v_sent');
    const sum = migration.slice(
      migration.indexOf('select coalesce(sum'),
      migration.indexOf('v_remaining :=')
    );
    expect(sum).toContain('t.to_user_id = p_to_user_id');
    expect(sum).toContain('t.club_id = p_club_id');
    expect(sum).not.toMatch(/t\.from_user_id\s*=/);
    expect(sum).not.toContain('destination');
    expect(sum).not.toMatch(/is_reversed|clawed_back/);
  });
  it('keeps the public and batch consumers on the protected core', () => {
    expect(read('src/components/agent/AgentPromoPanel.tsx')).toContain(
      "supabase.rpc('fn_promo_wallet_send'"
    );
    for (const path of [
      'src/components/agent/AgentPromoPanel.tsx',
      'src/components/wallet/WalletCashierModal.tsx',
      'src/pages/CashierTradePage.tsx',
    ]) {
      expect(read(path)).toContain(
        'Each Downline Can Receive 50 Promo Chips Total From All Agents In Any 7 Days'
      );
    }
  });
  it('runs actual PostgreSQL concurrency coverage in the required accounting job', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('run: python3 scripts/ci/test-cashier-authority-exact-intent-postgres.py');
    expect(read('scripts/ci/test-cashier-authority-exact-intent-postgres.py')).toContain(
      'scripts/ci/test-promo-downline-limit-postgres.py'
    );
    const proof = read('scripts/ci/test-promo-downline-limit-postgres.py');
    expect(proof).toContain('concurrent uplines cannot exceed 50');
    expect(proof).toContain('batch returns same limit refusal');
    expect(proof).toContain('original retry replays at exhausted cap');
  });
});
