/**
 * SHORTER REBUY QUEUE WITHIN ONE EVENT
 * (2026-11-19, incident 075013fd, lane 4)
 *
 * Migration 20261119175942 shortens the exclusive R(id) rebuy queue by:
 *   1. Replaying immutable completed receipts (add-ons and explicit prompt
 *      tokens) BEFORE fn_ca_promo_fee_state_ensure and BEFORE R(id).
 *   2. Narrowing the pre-lane fn_ca_promo_fee_state_ensure to buyers who
 *      actually hold open-grant principal custody in player_wallet.
 *   3. Removing the duplicate fn_ca_promo_play_through_settle call in
 *      fn_ca_promo_custody_on_ledger when dest='event'.
 *   4. Skipping settle and fee-history scans in fn_ca_promo_fund_from_balance
 *      whenever open-grant principal custody at the source wallet is empty.
 *
 * Native PG proof: scripts/ci/test-shorter-rebuy-queue.py.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingProbes } from '../scripts/ci/migration-function-probes.mjs';
import { declaredProofs, proofIsRunnable } from '../scripts/ci/check-migrations-are-live.mjs';

const MIGRATION_PATH = join(
  __dirname,
  '..',
  'supabase/migrations/20261119175942_shorter_rebuy_queue_skips_redundant_promo_and_replay_work.sql'
);
const sql = readFileSync(MIGRATION_PATH, 'utf8');

describe('shorter rebuy queue skips redundant promo and replay work', () => {
  it('replays completed immutable receipts BEFORE promo ensure and BEFORE R(id)', () => {
    const blockStart = sql.indexOf('$n3$');
    const blockEnd = sql.indexOf('$n3$', blockStart + 4);
    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const block = sql.slice(blockStart + 4, blockEnd).replace(/--[^\n]*/g, '');

    const receiptRead = block.indexOf('FROM public.entry_purchase_idempotency_receipts r');
    const responseGuard = block.indexOf('AND r.response IS NOT NULL');
    const ensure = block.indexOf('fn_ca_promo_fee_state_ensure(tp.club_id,p_user_id)');
    const lane = block.indexOf(
      'PERFORM public.fn_ca_share_tournament_lane_for_rebuy(p_tournament_id,p_user_id);'
    );

    expect(receiptRead).toBeGreaterThan(-1);
    expect(responseGuard).toBeGreaterThan(receiptRead);
    expect(ensure).toBeGreaterThan(responseGuard);
    expect(lane).toBeGreaterThan(ensure);
  });

  it('narrows pre-lane ensure and fn_ca_promo_fund_from_balance to holders with open wallet principal custody', () => {
    expect(sql).toContain("AND c.kind='player_wallet'");
    expect(sql).toContain('AND c.kind=l.from_type');
    expect(sql).toContain('AND c.amount>0');
    expect(sql).toContain("IF dest<>'event' THEN");
  });

  it('declares a runnable @live-proof and satisfies the install-time probe law', () => {
    const proofs = declaredProofs(sql);
    expect(proofs.length).toBeGreaterThanOrEqual(1);
    for (const p of proofs) {
      expect(proofIsRunnable(p)).toBe(true);
    }
    expect(missingProbes(sql)).toEqual([]);
  });
});
