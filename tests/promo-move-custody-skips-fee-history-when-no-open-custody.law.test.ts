/**
 * LAW: fn_ca_promo_move_custody NEVER SCANS PROMO FEE HISTORY WHEN NO OPEN
 * GRANT HOLDS CUSTODY AT THE SOURCE (2026-11-20).
 *
 * Cashouts (table_cashout -> zzz_ca_promo_custody -> fn_ca_promo_move_custody)
 * took 2.2-7.7 seconds whenever a player/horse had a closed historical promo
 * grant, because fn_ca_promo_move_custody called fn_ca_promo_play_through_state
 * unconditionally before checking whether any open grant held positive custody
 * at (p_from, p_from_id).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const ALL_MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

describe('LAW: fn_ca_promo_move_custody checks open custody before scanning fee history', () => {
  it('latest definition short-circuits on open ca_promo_principal_custody before fn_ca_promo_play_through_state', () => {
    const defining = ALL_MIGRATIONS.filter((f) =>
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?fn_ca_promo_move_custody\s*\(/i.test(
        readFileSync(join(MIGRATIONS_DIR, f), 'utf8')
      )
    );
    expect(defining.length).toBeGreaterThanOrEqual(1);
    const latestFile = defining[defining.length - 1];
    const sql = readFileSync(join(MIGRATIONS_DIR, latestFile), 'utf8');

    const fnStart = sql.search(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?fn_ca_promo_move_custody\s*\(/i
    );
    const fnEnd = sql.indexOf('REVOKE ALL ON FUNCTION public.fn_ca_promo_move_custody', fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);

    const body = sql.slice(fnStart, fnEnd);
    const custodyCheckIdx = body.indexOf('ca_promo_principal_custody');
    const closedAtIdx = body.indexOf('closed_at IS NULL');
    const stateCallIdx = body.indexOf('fn_ca_promo_play_through_state');

    expect(custodyCheckIdx).toBeGreaterThan(-1);
    expect(closedAtIdx).toBeGreaterThan(-1);
    expect(stateCallIdx).toBeGreaterThan(custodyCheckIdx);
    expect(stateCallIdx).toBeGreaterThan(closedAtIdx);

    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_promo_move_custody\(uuid,uuid,text,uuid,text,uuid,numeric,text\)\s+FROM PUBLIC,\s*anon,\s*authenticated,\s*service_role;/i
    );
  });
});
