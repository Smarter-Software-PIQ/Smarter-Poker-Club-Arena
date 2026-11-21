/**
 * A CERTIFICATION IDENTITY'S RETIRED-CLUB ROW IS REMOVED THROUGH THE GATE
 * (2026-11-20, 20261120213250).
 *
 * The Cert Residue Sweep of 2026-11-20 21:28 UTC left six stale identities
 * unrecovered: cleanup_reserved_certification_account's final branch ran a bare
 * DELETE on club_members, and a zero-balance player row in a RETIRED Cert club
 * made the retired-club guard refuse the whole removal (55000 CLUB_RETIRED).
 * Probed in a rolled-back transaction against 00205f11: the live door refused,
 * the patched door returned success and closed the gate again.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261120213250_certification_cleanup_removes_a_retired_club_row_through_the.sql'
  ),
  'utf8'
);
const replacement = sql.slice(sql.indexOf('c_new constant text'), sql.indexOf('v_def text'));

describe('certification cleanup and a retired club row', () => {
  it('patches exactly the bare membership delete, against a pinned preimage, in one transaction', () => {
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).toContain("IS DISTINCT FROM '31f1f64019f3869630a2de7dcdcd8dde'");
    expect(sql).toContain('CERTIFICATION_RETIRED_ROW_PATCH_MISMATCH');
    expect(sql).toContain('CERTIFICATION_RETIRED_ROW_INSTALL_MISMATCH');
  });

  it('opens the retirement gate only around the retired-club delete and always closes it', () => {
    const open = replacement.indexOf("''app.club_retirement_maintenance'', ''on''");
    const gated = replacement.indexOf("rc.lifecycle_status = ''retired''");
    const close = replacement.indexOf('COALESCE(v_previous_final_retirement_maintenance');
    const onError = replacement.indexOf('EXCEPTION WHEN OTHERS THEN');
    const plain = replacement.lastIndexOf('DELETE FROM public.club_members WHERE user_id = p_user_id;');
    expect(open).toBeGreaterThan(0);
    expect(gated).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(gated);
    expect(onError).toBeGreaterThan(close);
    // The ungated delete for live clubs runs only after the gate is closed.
    expect(plain).toBeGreaterThan(onError);
  });

  it('never removes chips: only zero-balance player rows of a retired club pass the gate', () => {
    for (const column of ['chip_balance', 'promo_balance', 'held_chips', 'locked_chips']) {
      expect(replacement).toContain(`COALESCE(${column}, 0) = 0`);
    }
    expect(replacement).toContain("AND role = ''player''");
  });
});
