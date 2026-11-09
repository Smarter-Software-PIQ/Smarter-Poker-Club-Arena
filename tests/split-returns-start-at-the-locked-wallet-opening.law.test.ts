import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
const base = 'scripts/ci/fixtures/split-late-return/wallet-opening/';
const before = readFileSync(base + 'stage-before.sql', 'utf8');
const after = readFileSync(base + 'stage-after.sql', 'utf8');
it('measures only return deltas after the same locked opening, including repeated calls', () => {
  expect(createHash('md5').update(before).digest('hex')).toBe('23dae39efbca9d472bc519161c10196f');
  expect(createHash('md5').update(after).digest('hex')).toBe('21409a0d24523597e10b5da44c252840');
  expect(after.indexOf('FOR NO KEY UPDATE OF cm')).toBeLessThan(
    after.indexOf('CREATE TEMP TABLE IF NOT EXISTS _routed_split_return_openings')
  );
  expect(after).toContain('TRUNCATE pg_temp._routed_split_return_openings');
  expect(after).toContain('sum(lr.amount)-b.returned');
  expect(after).not.toContain('lr.returned_at >= transaction_timestamp()');
  expect(after).toContain("RAISE EXCEPTION 'routed_rakeback_final_balance_incorrect'");
});
it('keeps the connected native regression on the existing trigger route', () => {
  const native = readFileSync(base + 'qualify-postgres.py', 'utf8');
  expect(native).toContain("before_lock('old-return-commits-before-wallet-opening',True)");
  expect(native).toContain("before_lock('new-return-commits-before-wallet-opening')");
  expect(native).toContain('new-earlier-call-in-same-transaction');
  expect(native).toContain('new-receipt-without-matching-wallet-move-still-refused');
  expect(native).toContain('replay_refused');
  expect(readFileSync('scripts/ci/test-split-late-return-postgres.py', 'utf8')).toContain(
    'wallet-opening/qualify-postgres.py'
  );
  expect(readFileSync('.github/workflows/weekly-refusal-cover.yml', 'utf8')).toContain(
    'scripts/ci/fixtures/split-late-return/**'
  );
});
