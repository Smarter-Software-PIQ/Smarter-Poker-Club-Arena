/**
 * LAW - NO RUNTIME CODE CREDITS A WALLET THROUGH THE RAW CREDIT RPC
 *
 * atomic_credit_wallet_and_log credits a player's wallet and accepts a null
 * idempotency key, so a retried call from application code can pay twice.
 * Every engine refund and cashout runs inside a keyed SQL function instead
 * (resolve_pending_addon keys its refund `addon_refund:<row id>`). The last
 * caller in runtime code, the engine's _refundAddOnToWallet helper, had no
 * callers and took its key as optional; it was removed on 2026-11-26. This law
 * keeps runtime code from calling the raw credit RPC again, so a wallet credit
 * is always written by a function that owns its own key.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const RUNTIME_ROOTS = ['src', 'server/src', 'supabase/functions'];
const SKIP_DIR = /^(node_modules|dist|__tests__|test-support)$/;
const SOURCE = /\.(ts|tsx|js|jsx|mjs)$/;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/;
// Comments may name the RPC; only code counts.
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return SKIP_DIR.test(name) ? [] : walk(full);
    return SOURCE.test(name) && !TEST_FILE.test(name) ? [full] : [];
  });
}

describe('LAW: no runtime code credits a wallet through the raw credit RPC', () => {
  it(
    'no client, engine or edge function calls atomic_credit_wallet_and_log',
    { timeout: 60_000 },
    () => {
      const callers = RUNTIME_ROOTS.flatMap((r) => walk(join(ROOT, r)))
        .filter((f) =>
          /\.rpc\(\s*['"`]atomic_credit_wallet_and_log['"`]/.test(code(readFileSync(f, 'utf8')))
        )
        .map((f) => relative(ROOT, f));
      expect(
        callers,
        'credit a wallet inside a keyed SQL function, never from runtime code'
      ).toEqual([]);
    }
  );

  it('the dead engine refund helper stays gone', () => {
    const seating = readFileSync(
      join(ROOT, 'server/src/engine/ServerTableEngineSeating.ts'),
      'utf8'
    );
    expect(seating).not.toMatch(/_refundAddOnToWallet/);
  });
});
