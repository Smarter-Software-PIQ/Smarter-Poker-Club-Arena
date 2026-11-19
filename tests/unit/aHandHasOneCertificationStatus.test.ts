/**
 * A HAND HAS ONE CERTIFICATION STATUS (2026-11-19).
 *
 * cash_hand_provenance_receipts.status reads 'uncertified' for every Lightning
 * hand by design; those hands are certified by a proven lightning_pool
 * resolution. On 2026-11-18 that raw column was read as "about 70% of cash
 * hands lack seating proof". smarter_private.cash_hand_certification is the
 * one answer. These cases pin its precedence and its privacy.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FILE = '20261119052600_a_hand_has_one_certification_status.sql';
const sql = readFileSync(join(resolve(__dirname, '../..'), 'supabase/migrations', FILE), 'utf8');
const view = sql.slice(sql.indexOf('CREATE OR REPLACE VIEW'));

describe('smarter_private.cash_hand_certification', () => {
  it('is one transaction', () => {
    expect(sql.trimStart().startsWith('--')).toBe(true);
    expect(sql).toMatch(/\nBEGIN;\n/);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('runs as the caller and is closed to the browser', () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW smarter_private\.cash_hand_certification\s+WITH \(security_invoker = true\)/);
    expect(sql).toMatch(/REVOKE ALL ON smarter_private\.cash_hand_certification FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT SELECT ON smarter_private\.cash_hand_certification TO service_role;/);
  });

  it('certifies a captured receipt or a proven Lightning pool resolution, nothing else', () => {
    expect(sql).toContain("(p.status = 'captured' OR r.table_id IS NOT NULL) AS certified");
    expect(sql).toContain("x.roster_source = 'lightning_pool'");
    expect(sql).toContain("x.proof->>'status' = 'proven'");
  });

  it('orders the basis dealt manifest, Lightning pool, explained gap, uncertified', () => {
    const order = ["'dealt_manifest'", "'lightning_pool'", "'explained_gap'", "'uncertified'"].map((s) =>
      view.indexOf(s)
    );
    order.forEach((i) => expect(i).toBeGreaterThan(0));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('an explained gap is still not certified', () => {
    expect(sql).toMatch(/WHEN g\.table_id IS NOT NULL THEN 'explained_gap'/);
    expect(sql).not.toMatch(/OR g\.table_id IS NOT NULL\) AS certified/);
  });
});
