/**
 * THE STALE CERTIFICATION INVENTORY SKIPS RETIRED PROFILES (2026-11-14)
 *
 * Dan, 2026-11-14: "REMOVE ANY AND ALL POSTDEPLOY TEST ACCOUNTS ACROSS THE
 * POKER ARENA." Every Club Create Certification cleanup and the Cert Residue
 * Sweep timed out on fn_ca_stale_certification_accounts (10.96 s against its
 * 8 s limit): it evaluated the retirement predicate on ~1,250 already-retired
 * profiles, and 39 profiles no door will ever retire filled its LIMIT 21, so no
 * newer stale identity was reached. A deleted profile has been through
 * retirement; the inventory no longer lists it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const name = readdirSync(dir).filter((file) =>
  file.endsWith('_the_stale_certification_inventory_skips_retired_profiles.sql')
);
if (name.length !== 1) throw new Error('Expected One Stale Certification Inventory Migration');
const sql = readFileSync(`${dir}/${name[0]}`, 'utf8');
const code = sql.replace(/^--[^\n]*$/gm, '');

describe('the stale certification inventory skips retired profiles', () => {
  it('is one transaction, guarded by the body it replaces', () => {
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(code).toContain("'d0ab035f530057448cc8b1b8bad3888c'");
    expect(code).toContain('STALE_INVENTORY_PREIMAGE_CHANGED');
  });

  it('lists only reserved identities that are not deleted and not retired', () => {
    expect(code).toContain(
      "WHERE p.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'"
    );
    expect(code).toContain("AND p.status IS DISTINCT FROM 'deleted'");
    expect(code).toContain('AND NOT public.fn_ca_certification_identity_retired(p.id)');
    expect(code).toContain('ORDER BY p.created_at, p.id LIMIT 21');
    expect(code).toContain("SET statement_timeout TO '8s'");
  });

  it('stays callable by the service role only', () => {
    expect(code).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_stale_certification_accounts(timestamptz) FROM PUBLIC, anon, authenticated;'
    );
    expect(code).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_stale_certification_accounts(timestamptz) TO service_role;'
    );
    expect(code).toContain("ARRAY['postgres','service_role']::text[]");
  });
});
