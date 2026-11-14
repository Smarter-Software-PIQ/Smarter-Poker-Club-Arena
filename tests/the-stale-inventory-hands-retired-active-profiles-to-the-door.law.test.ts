/**
 * THE STALE INVENTORY HANDS RETIRED, STILL-ACTIVE PROFILES TO THE DOOR (2026-11-14)
 *
 * Dan, 2026-11-14: "REMOVE ANY AND ALL POSTDEPLOY TEST ACCOUNTS ACROSS THE
 * POKER ARENA." The cleanup door now finishes a retired test identity by
 * marking its profile deleted. Identities retired before that change kept an
 * active profile, and the inventory skipped them because their Auth record was
 * already retired, so nothing would ever finish them. The inventory now lists
 * every reserved post-deploy profile that is not deleted.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const name = readdirSync(dir).filter((file) =>
  file.endsWith('_the_stale_inventory_hands_retired_active_profiles_to_the_doo.sql')
);
if (name.length !== 1) throw new Error('Expected One Stale Inventory Retired Profiles Migration');
const sql = readFileSync(`${dir}/${name[0]}`, 'utf8');
const code = sql.replace(/^--[^\n]*$/gm, '');

describe('the stale inventory hands retired active profiles to the door', () => {
  it('is one transaction, guarded by the body it replaces', () => {
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(code).toContain("'93294e56aaea15f40526c13c39b52c88'");
  });

  it('lists every reserved post-deploy profile that is not deleted, retired or not', () => {
    expect(code).toContain(
      "WHERE p.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'"
    );
    expect(code).toContain("AND p.status IS DISTINCT FROM 'deleted'");
    const body = code.slice(code.indexOf('AS $function$'), code.lastIndexOf('$function$;'));
    expect(body).not.toContain('fn_ca_certification_identity_retired');
    expect(code).toContain('STALE_INVENTORY_RETIRED_INSTALL_MISMATCH');
  });

  it('stays callable by the service role only', () => {
    expect(code).toContain("ARRAY['postgres','service_role']::text[]");
  });
});
