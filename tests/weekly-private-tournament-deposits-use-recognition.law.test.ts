import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    __dirname,
    '../supabase/migrations/20261108204901_scope_weekly_private_tournament_deposit_proof.sql'
  ),
  'utf8'
);

it('discovers private tournament deposits from the exact original recognition week', () => {
  const receiptRead = migration.split('$new_deposit$')[1];
  expect(receiptRead).toContain('f.union_id IS NULL AND f.net_rake>0');
  expect(receiptRead).toContain(
    'f.recognized_at>=period.start_at AND f.recognized_at<period.end_at'
  );
  expect(receiptRead).toContain('f.bank_club_id=period.club_id OR EXISTS');
  expect(receiptRead).toContain('s.tournament_id=f.tournament_id');
  expect(receiptRead).toContain('s.coordinator_union_id=period.union_id');
  expect(migration).toContain('WEEKLY_PAYABLE_RECOGNITION_CONTRACT_CHANGED');
});

it('keeps all payable sources for the exact tournament, including conflicting evidence', () => {
  const groupRead = migration.split('$new_group$')[1];
  expect(groupRead).toContain('CROSS JOIN LATERAL');
  expect(groupRead).toContain(
    "e.tournament_id=k.source_group AND e.source_type='tournament_fee_accrual'"
  );
  expect(groupRead).toContain('OFFSET 0');
  expect(groupRead).not.toContain('e.club_id=period.club_id');
  expect(groupRead).not.toContain('e.earned_at=k.banked_at');
  expect(groupRead).not.toContain('LIMIT');
});
