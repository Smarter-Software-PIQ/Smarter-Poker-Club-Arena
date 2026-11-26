/**
 * A SPIN POOL LOOKUP NEVER WRITES AN EXISTING POOL (2026-11-26).
 *
 * rpc/fn_spin_draw_and_settle_atomic answered 500 nine times in the 24 hours
 * to 2026-11-26 21:45 UTC, every one a lock timeout on a clubs row taken FOR
 * KEY SHARE by fn_guard_retired_club_mutation, the BEFORE ROW INSERT trigger
 * on spin_bonus_pools. fn_spin_reserve_pool is a lookup ("which pool owns this
 * club") that also made sure the pool row existed with an INSERT ... ON
 * CONFLICT DO NOTHING. Postgres fires BEFORE ROW INSERT triggers before it
 * detects the conflict, so every lookup of a pool that already existed still
 * ran the retired-club guard and queued behind whoever held that club row.
 * fn_spin_draw_multiplier calls the lookup once per spin tournament row.
 *
 * The law: migration 20261126215837 returns the owner without writing when the
 * pool row exists, and inserts only a missing pool. The grants stay exactly as
 * they were (service_role only) and the body is executed by a probe before
 * COMMIT.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20261126215837_the_spin_reserve_pool_lookup_writes_only_a_missing_pool.sql'
);
const sql = readFileSync(FILE, 'utf8');
const body = (() => {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_spin_reserve_pool(p_club_id uuid)');
  const end = sql.indexOf('$function$;', start);
  return sql.slice(start, end);
})();

describe('a spin pool lookup never writes an existing pool', () => {
  it('redefines the lookup inside one transaction with a short lock_timeout', () => {
    expect(body.length).toBeGreaterThan(0);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).toMatch(/SET LOCAL lock_timeout = '1s';/);
  });

  it('returns the owner before any INSERT when the pool row exists', () => {
    const exists = body.search(
      /IF EXISTS \(SELECT 1 FROM public\.spin_bonus_pools p WHERE p\.club_id = v_owner\) THEN\s+RETURN v_owner;\s+END IF;/
    );
    const insert = body.indexOf('INSERT INTO public.spin_bonus_pools');
    expect(exists).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(exists);
    expect(body.match(/INSERT INTO public\.spin_bonus_pools/g)?.length).toBe(1);
  });

  it('still resolves the owner through fn_spin_reserve_owner and still creates a missing pool', () => {
    expect(body).toContain('v_owner := public.fn_spin_reserve_owner(p_club_id);');
    expect(body).toContain('ON CONFLICT (club_id) DO NOTHING;');
  });

  it('keeps the live grants: service_role only', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.fn_spin_reserve_pool(uuid) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.fn_spin_reserve_pool(uuid) TO service_role;');
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_spin_reserve_pool\(uuid\) TO (anon|authenticated|PUBLIC)/);
  });

  it('pins the preimage it replaces and probes the new body before COMMIT', () => {
    expect(sql).toContain('-- @replaces-md5: public.fn_spin_reserve_pool(uuid)=d3596faa39ba012e437d769386f8a057');
    expect(sql).toContain('-- @probe-for: public.fn_spin_reserve_pool');
    expect(sql).toContain("RAISE EXCEPTION 'probe-unwind';");
    expect(sql.indexOf('-- @probe-for:')).toBeLessThan(sql.lastIndexOf('COMMIT;'));
  });
});
