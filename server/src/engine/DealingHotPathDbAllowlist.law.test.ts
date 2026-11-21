/**
 * LAW: DEALING HOT-PATH DB ALLOWLIST (2026-11-21).
 *
 * Every direct `supabase.from(...)` and `supabase.rpc(...)` call inside
 * `ServerTableEngineDealing.ts` must appear on an explicit allowlist. Any new
 * database call introduced in the dealing loop fails CI immediately until it
 * is either moved off the inter-hand hot path, proven to ride under the rest
 * window, or explicitly documented here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blankNonCode } from '../testHelpers/sourceWindow.js';

const DEALING = readFileSync(
  fileURLToPath(new URL('./ServerTableEngineDealing.ts', import.meta.url)),
  'utf8'
);

const ALLOWED_DIRECT_TABLES: ReadonlySet<string> = new Set([
  // Hand-1 heads-up tournament button persistence (fire-and-forget)
  // and bomb-pot schedule/manual-push updates (cash/bomb-pot only).
  'tables',
  // Cash-only expired bust-window check for pending addons.
  'table_pending_addons',
  // Cash-only bust-window recovery on first unseen busted seat.
  'hand_atomic_commits',
  'engine_maintenance_thaws',
  // Mid-hand Pineapple discard persistence.
  'hand_discards',
]);

const ALLOWED_DIRECT_RPCS: ReadonlySet<string> = new Set([
  // Mid-hand hole-card batch persistence (with retry).
  'insert_hole_cards',
]);

describe('dealing hot-path direct supabase allowlist', () => {
  it('every direct supabase.from(...) in ServerTableEngineDealing.ts is allowlisted', () => {
    const code = blankNonCode(DEALING);
    const found = new Set<string>();
    for (const m of code.matchAll(/supabase\s*\.\s*from\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
      found.add(m[1]);
    }
    const unexpected = [...found].filter((t) => !ALLOWED_DIRECT_TABLES.has(t)).sort();
    expect(
      unexpected,
      'Move new dealing-loop DB reads off the inter-hand hot path or explicitly allowlist them'
    ).toEqual([]);
  });

  it('every direct supabase.rpc(...) in ServerTableEngineDealing.ts is allowlisted', () => {
    const code = blankNonCode(DEALING);
    const found = new Set<string>();
    for (const m of code.matchAll(/supabase\s*\.\s*rpc\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
      found.add(m[1]);
    }
    const unexpected = [...found].filter((r) => !ALLOWED_DIRECT_RPCS.has(r)).sort();
    expect(
      unexpected,
      'Move new dealing-loop RPCs off the inter-hand hot path or explicitly allowlist them'
    ).toEqual([]);
  });
});
