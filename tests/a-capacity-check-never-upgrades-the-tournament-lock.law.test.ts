import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Production alert 445924 (2026-11-19 23:02-23:29 UTC): nine deadlocks between
// a seatless rebuy and a hand commit. The rebuy's seat root holds the
// tournament row FOR NO KEY UPDATE; fn_ensure_late_registration_capacity asked
// for the same row FOR UPDATE - an upgrade that conflicts with the FOR KEY
// SHARE a hand commit's foreign-key check holds while that hand waits FOR
// SHARE on the rebuy. 20261119235115 makes the capacity lock FOR NO KEY
// UPDATE. Native proof: scripts/ci/test-rebuy-capacity-lock-order.py.

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
const FIX = '20261119235115_a_rebuy_never_upgrades_its_tournament_row_lock.sql';
const LOCK_FOR_UPDATE =
  /FROM public\.tournaments t\s+WHERE t\.id\s*=\s*p_tournament_id\s+FOR UPDATE\s*;/i;

describe('a capacity check never upgrades the tournament row lock', () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

  it('the fix is present and changes exactly the capacity row lock, md5-guarded', () => {
    expect(files).toContain(FIX);
    const sql = readFileSync(join(MIGRATIONS, FIX), 'utf8');
    expect(sql).toContain("fn_ensure_late_registration_capacity(uuid,integer)");
    expect(sql).toContain("   FOR UPDATE;\\n'");
    expect(sql).toContain("   FOR NO KEY UPDATE;\\n'");
    expect(sql).toContain("'a539fd43bb2992f8d75253f2d7a4dd7c'"); // production pre-image
    expect(sql).toContain("'c142f16547e8cde3ba10338c2bf6e6e4'"); // post-image live proof
    expect(sql).toMatch(/^-- @live-proof: md5\(pg_get_functiondef\('public\.fn_ensure_late_registration_capacity/m);
  });

  it('no later migration puts FOR UPDATE back on the capacity check', () => {
    const later = files.filter((f) => f > FIX);
    for (const f of later) {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
      const def = sql.match(
        /FUNCTION\s+public\.fn_ensure_late_registration_capacity\s*\([\s\S]*?\$function\$([\s\S]*?)\$function\$/i,
      );
      if (def) expect(def[1], `${f} redefines the capacity check with FOR UPDATE`).not.toMatch(LOCK_FOR_UPDATE);
    }
  });

  it('the native proof is gated in CI on the paths it proves', () => {
    const wf = readFileSync(
      join(__dirname, '..', '.github', 'workflows', 'rebuy-capacity-lock-order.yml'),
      'utf8',
    );
    expect(wf).toContain('scripts/ci/test-rebuy-capacity-lock-order.py');
    expect(wf).toContain(`supabase/migrations/${FIX}`);
  });
});
