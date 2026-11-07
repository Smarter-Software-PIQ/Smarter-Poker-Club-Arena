/**
 * THE CRITICAL PAGER CAN FINISH ITS SCAN.
 *
 * 2026-11-07: fn_sp_critical_scan() timed out (service role 8 s) on 270 of
 * 288 five-minute calls in a day (edge_logs), and on at least 483 calls back
 * to 2026-11-06 00:50 UTC. The cause was one read inside
 * fn_sp_midway_free_buy_watch(): the 7-day promo runway sum over chip_ledger,
 * 4.6 s alone, because the only usable index was to_entity_id and the union's
 * wallet row receives ~628k unrelated legs a week.
 *
 * 20261107203405 adds a partial index over exactly the runway's three leg
 * shapes and refuses to install unless EXPLAIN of the runway read names it.
 * This test keeps the index and the read in step: change the read's leg
 * shapes and this fails until the index (and its proof) are revisited.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20261107203405_the_critical_pager_scan_reads_promo_runway_by_index.sql',
  'utf8'
);
const watch = readFileSync(
  'supabase/migrations/20261105233756_the_midway_free_buy_watch_reads_the_schedule_not_event_ids.sql',
  'utf8'
);
const flat = (s: string) => s.replace(/\s+/g, ' ');

const SHAPES = [
  "l.from_label = 'union_wallets.promo_wallet'",
  "l.to_label = 'union_wallets.promo_wallet'",
  "l.to_label IS NULL AND l.from_type = 'bbj_pool' AND l.to_type = 'union_wallet'",
];

describe('the critical pager can finish its scan', () => {
  it('the runway read still uses exactly the three leg shapes the index covers', () => {
    for (const shape of SHAPES) expect(flat(watch)).toContain(shape);
  });

  it('the index is partial on those three shapes, built concurrently, keyed by created_at', () => {
    const create = flat(
      migration.slice(migration.indexOf('CREATE INDEX CONCURRENTLY'), migration.indexOf('BEGIN;'))
    );
    expect(create).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chip_ledger_union_promo_runway_legs ON public.chip_ledger (created_at)'
    );
    for (const shape of SHAPES) expect(create).toContain(shape.replace(/\bl\./g, ''));
    // Covering: the read never needs the heap.
    for (const col of [
      'amount',
      'category',
      'from_label',
      'to_label',
      'from_entity_id',
      'to_entity_id',
    ])
      expect(create).toMatch(new RegExp(`INCLUDE \\([^)]*\\b${col}\\b`));
  });

  it('refuses a missing or INVALID build and refuses unless the runway plan uses the index', () => {
    expect(migration).toContain('the CREATE INDEX CONCURRENTLY preamble did not run');
    expect(migration).toContain('exists but is INVALID');
    expect(migration).toContain(
      "position('idx_chip_ledger_union_promo_runway_legs' IN coalesce(v_plan, '')) = 0"
    );
    expect(migration).toMatch(/@live-proof: .*idx_chip_ledger_union_promo_runway_legs/);
  });

  it('fixes the read, not the pager: nothing is scheduled and the scan is not rewritten', () => {
    const body = migration.slice(migration.indexOf('BEGIN;'));
    expect(body).not.toMatch(
      /cron\.schedule|CREATE OR REPLACE FUNCTION|statement_timeout\s*=\s*'[0-9]+(min|s)'.*service_role/i
    );
  });
});
