/**
 * A CHAIR SEATED AFTER A FROZEN HAND DOES NOT BLOCK ITS OPERATOR CANCELLATION
 * (2026-11-05).
 *
 * Midnight Free Buy (6429087f) could never finish the owner-ordered closure:
 * its frozen original hand on table fe4237f3 was captured with eight chairs,
 * and the balancer later seated a ninth player who was never dealt into it.
 * fn_ca_cancel_tournament_abort_unsettled_hand refused every live chair that
 * was missing from the capsule, so the cancellation answered
 * operator_abort_retained_original_unproven for ever.
 *
 * The migration narrows that ONE condition to chairs seated at or before the
 * capsule was retained, and leaves every other check byte-identical. These
 * assertions pin the exact change, its pre/post images and that nothing else
 * in the function moved.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const MIGRATION = join(
  ROOT,
  'supabase/migrations/20261105183850_a_chair_seated_after_a_frozen_hand_does_not_block_its_operat.sql'
);
const ORIGINAL = join(
  ROOT,
  'supabase/migrations/20261101005048_operator_closure_records_a_stopped_unsettled_hand_dispositio.sql'
);

const OLD_CONDITION =
  "AND a.left_at IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.payload::jsonb->'seats') z WHERE a.id=(z->>'seat_id')::uuid AND a.user_id=(z->>'user_id')::uuid))))";
const NEW_CONDITION =
  "AND a.left_at IS NULL AND a.joined_at<=c.created_at AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.payload::jsonb->'seats') z WHERE a.id=(z->>'seat_id')::uuid AND a.user_id=(z->>'user_id')::uuid))))";

function body(sql: string, marker: string): string {
  const start = sql.indexOf(marker);
  const end = sql.indexOf('END $fn$;', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(sql.indexOf('AS $fn$', start), end);
}

describe('a chair seated after a frozen hand does not block its operator cancellation', () => {
  const migration = readFileSync(MIGRATION, 'utf8');
  const original = readFileSync(ORIGINAL, 'utf8');

  it('asserts the installed pre-image and pins the post-image', () => {
    expect(migration).toContain("IS DISTINCT FROM '2eb90c4b5312f3d2bca312f09410f4e0'");
    expect(migration).toContain("IS DISTINCT FROM '9ec2ae80a060a9ebffeb127e39be14cb'");
    expect(migration.split('\n')[0]).toMatch(
      /^-- @live-proof: .*'9ec2ae80a060a9ebffeb127e39be14cb'/
    );
  });

  it('changes exactly one condition and nothing else', () => {
    const before = body(
      original,
      'CREATE FUNCTION public.fn_ca_cancel_tournament_abort_unsettled_hand'
    );
    const after = body(
      migration,
      'CREATE OR REPLACE FUNCTION public.fn_ca_cancel_tournament_abort_unsettled_hand'
    );
    expect(before.split(OLD_CONDITION)).toHaveLength(2);
    expect(after.split(NEW_CONDITION)).toHaveLength(2);
    expect(after).toBe(before.replace(OLD_CONDITION, NEW_CONDITION));
  });

  it('keeps the service-only grant and one transaction', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_cancel_tournament_abort_unsettled_hand(uuid,uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_cancel_tournament_abort_unsettled_hand(uuid,uuid,uuid,uuid,uuid,text,jsonb) TO service_role;'
    );
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.match(/^COMMIT;$/gm)).toHaveLength(1);
  });
});
