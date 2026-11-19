/**
 * A LIGHTNING TIMEOUT FOLD KEEPS THE DISCONNECT CLOCK (2026-11-19).
 *
 * Production incident (2026-11-19, PLO5 1.00/2.00 Lightning Games):
 * A player disconnected mid-hand, stamping lightning_pool_session.disconnected_at.
 * When their turn timed out 49s later, LightningHandHost.afterFold() called
 * fn_lightning_fast_fold(..., 'normal', ...), which unconditionally cleared
 * disconnected_at = NULL and emitted a bogus player_reconnected event. Because
 * the engine still knew the player was disconnected, the matcher kept withholding
 * them while fn_lightning_reap_expired_disconnects could no longer see them.
 *
 * This law pins BOTH halves of the contract so it cannot regress:
 *   1. Migration 20261119224600 guards fn_lightning_fast_fold presence self-heal
 *      to explicit player taps ('fast', 'fold_watch'), never 'normal', with exact
 *      preimage/postimage md5s, ACL invariants, and bounded timeouts.
 *   2. LightningHandHost.afterFold() defaults turn/timeout folds to 'normal' and
 *      relays that type to backend.fastFold(), never classifying a timeout as
 *      'fast' or 'fold_watch'.
 *   3. No later migration in supabase/migrations/ may touch fn_lightning_fast_fold
 *      and clear disconnected_at = NULL without excluding 'normal' folds.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sliceMethod } from './helpers/sourceWindow';

const ROOT = process.cwd();
const MIGRATIONS_DIR = resolve(ROOT, 'supabase/migrations');
const FIX_MIGRATION_NAME = '20261119224600_a_lightning_timeout_fold_keeps_the_disconnect_clock.sql';
const FIX_MIGRATION_PATH = resolve(MIGRATIONS_DIR, FIX_MIGRATION_NAME);
const HAND_HOST_PATH = resolve(ROOT, 'server/src/lightning/LightningHandHost.ts');

describe('a Lightning timeout fold keeps the disconnect clock', () => {
  const sql = readFileSync(FIX_MIGRATION_PATH, 'utf8');
  const hostSrc = readFileSync(HAND_HOST_PATH, 'utf8');

  it('pins the exact preimage and postimage md5s and live-proof ACLs', () => {
    expect(sql).toContain("v_preimage  constant text := '4b7a841a1e5baba34a1f5ccab702a455'");
    expect(sql).toContain("v_postimage constant text := 'acee3403a706ab22c0ef9ac14e901dc8'");
    expect(sql).toContain('-- @live-proof:');
    expect(sql).toContain("md5(pg_get_functiondef(p.oid)) = 'acee3403a706ab22c0ef9ac14e901dc8'");
    expect(sql).toContain("has_function_privilege('service_role', p.oid, 'EXECUTE')");
    expect(sql).toContain("NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')");
    expect(sql).toContain("NOT has_function_privilege('anon', p.oid, 'EXECUTE')");
    expect(sql).toContain("NOT has_function_privilege('public', p.oid, 'EXECUTE')");
  });

  it('guards presence self-heal to fast and fold_watch only, never normal folds', () => {
    expect(sql).toContain("WHERE p_fold_type IN ('fast', 'fold_watch')");
    expect(sql).not.toMatch(/p_fold_type\s+IN\s*\([^)]*'normal'/i);
  });

  it('uses bounded lock and statement timeouts', () => {
    expect(sql).toContain("SET LOCAL lock_timeout = '1s';");
    expect(sql).toContain("SET LOCAL statement_timeout = '5s';");
  });

  it('keeps LightningHandHost.afterFold defaulting turn and timeout folds to normal', () => {
    const body = sliceMethod(hostSrc, 'private afterFold(');
    expect(body).toContain("const type = requestedType ?? this.foldTypes.get(userId) ?? 'normal';");
    expect(body).toContain('this.deps.backend.fastFold(');
  });

  it('forbids any later migration from re-introducing an unguarded disconnected_at clear in fn_lightning_fast_fold', () => {
    const laterMigrations = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && f > FIX_MIGRATION_NAME)
      .sort();

    for (const file of laterMigrations) {
      const text = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
      if (!/fn_lightning_fast_fold/i.test(text)) continue;
      if (!/disconnected_at\s*=\s*NULL/i.test(text)) continue;
      // Any later migration that writes disconnected_at = NULL inside
      // fn_lightning_fast_fold must still gate on fast/fold_watch (never normal).
      expect(
        text,
        `${file} modifies fn_lightning_fast_fold and clears disconnected_at without guarding p_fold_type`
      ).toMatch(/p_fold_type\s+IN\s*\(\s*'fast'\s*,\s*'fold_watch'\s*\)/i);
    }
  });
});
