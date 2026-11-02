/**
 * Verification 2026-11-02: the Rake Treasury log was 886,610.25 short from
 * 2026-10-01, because the 2026-10-01/02 rakeback runs wrote their union wallet
 * outs with no from_label and the classifier only knew labels.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIG = readFileSync(
  'supabase/migrations/20261102090856_union_treasury_log_reads_unlabeled_union_wallet_legs.sql',
  'utf8'
);

describe('union treasury log reads unlabeled union wallet legs', () => {
  it('names an unlabeled out by the one wallet the union debited in that transaction', () => {
    expect(MIG).toContain("WHEN l.from_type = 'union_wallet' AND l.from_label IS NULL THEN");
    expect(MIG).toMatch(/u\.direction = 'debit'\s+HAVING count\(DISTINCT u\.wallet\) = 1/);
  });

  it('names an unlabeled in by the one wallet the union credited, never by a guess', () => {
    expect(MIG).toContain("WHEN l.to_type = 'union_wallet' AND l.to_label IS NULL THEN");
    expect(MIG).toMatch(/u\.direction = 'credit'\s+HAVING count\(DISTINCT u\.wallet\) = 1/);
  });

  it('keeps the labelled path and the promo sweep branch ahead of the lookup', () => {
    const sweep = MIG.indexOf("l.to_label IS NULL AND l.category = 'promo' THEN 'promo'");
    const lookup = MIG.indexOf("WHEN l.to_type = 'union_wallet' AND l.to_label IS NULL THEN");
    expect(sweep).toBeGreaterThan(0);
    expect(lookup).toBeGreaterThan(sweep);
  });

  it('derives the affected days again from the ledger, changing no ledger row', () => {
    expect(MIG).toContain('DELETE FROM public.ca_union_treasury_hours_done');
    expect(MIG).not.toMatch(/(UPDATE|DELETE FROM|INSERT INTO)\s+public\.chip_ledger/i);
    expect(MIG).not.toMatch(/(UPDATE|DELETE FROM|INSERT INTO)\s+public\.union_wallet/i);
  });
});
