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
 * This law pins the migration contract: fn_lightning_fast_fold only clears
 * disconnected_at on explicit player-initiated folds ('fast', 'fold_watch'),
 * never on 'normal' folds (which include engine timeout forced-folds).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20261119224600_a_lightning_timeout_fold_keeps_the_disconnect_clock.sql'
);

describe('a Lightning timeout fold keeps the disconnect clock', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

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
});
