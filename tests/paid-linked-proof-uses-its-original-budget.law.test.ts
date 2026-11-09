import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
const base = 'scripts/ci/fixtures/weekly-fee-preparation/linked-batch/';
const owners = JSON.parse(readFileSync(base + 'actual-owners.json', 'utf8'));
const migration = readFileSync(
  'supabase/migrations/20261109152937_batch_linked_proof_in_its_original_paid_book_budget.sql',
  'utf8'
);
it('batches only the existing paid linked phase without changing canonical proofs', () => {
  expect(createHash('md5').update(owners.coordinator).digest('hex')).toBe(owners.before_md5);
  expect(createHash('md5').update(owners.eligibility).digest('hex')).toBe(
    owners.eligibility_before_md5
  );
  expect(migration).toContain(
    "v_postpaid_quality->'issues'='[\"union_pnl_certification_in_progress\"]'::jsonb"
  );
  expect(migration).toContain("p.kind='pnl_linked_window'");
  expect(migration).toContain("interval '120 seconds'");
  expect(migration).toContain("interval '60 seconds'");
  expect(migration).toContain("longest_step+interval '5 seconds'>=batch_stop");
  expect(migration).toContain('EXIT WHEN next_proof IS NOT DISTINCT FROM prior_proof');
  expect(migration).toContain('EXIT WHEN advance_result IS DISTINCT FROM false');
  expect(migration).toContain('original_inventory_basis_generation() IS DISTINCT FROM generation');
  expect(migration).not.toMatch(
    /CREATE.*FUNCTION|ALTER.*cron|UPDATE public\.|INSERT INTO public\.|stale-pin-ok/i
  );
});
it('runs exact installation and whole coordinator behavior on its existing native route', () => {
  const native = readFileSync(base + 'qualify-postgres.py', 'utf8');
  for (const proof of [
    'stale pin was accepted',
    'metadata changed',
    'canonical reader changed',
    'replay accepted',
    'fast bounded batch',
    'later step slows admission',
    'statement reserve',
    'shorter scope reserve',
    'no progress stops',
    'canonical completion stops',
    'reader refusal rolls back',
    'other phase preserved',
  ])
    expect(native).toContain(proof);
  expect(readFileSync('scripts/ci/test-weekly-fee-preparation-postgres.py', 'utf8')).toContain(
    'linked-batch/qualify-postgres.py'
  );
  expect(
    readFileSync('.github/workflows/unpaid-lightning-funding-contracts.yml', 'utf8')
  ).toContain('scripts/ci/fixtures/weekly-fee-preparation/**');
});
