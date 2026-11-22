/**
 * LAW: A CLUSTER TICK NEVER BLOCKS A WAITING-LIST JOIN (2026-11-22).
 *
 * A waiting-list join and the cluster pass deadlocked 2 to 10 times an hour
 * (98 of 112 deadlocks in the 24 hours to 23:25 UTC on 2026-11-22). The join's
 * side was always the foreign key check of cash_game_waitlist_game_id_fkey,
 * FOR KEY SHARE on the cash_games row, waiting on fn_cash_cluster_tick, which
 * took that row FOR UPDATE: the one row lock that conflicts with a foreign key
 * check. The tick never deletes a game and never changes a key a foreign key
 * can use, so it takes FOR NO KEY UPDATE (migration 20261122232612). The
 * behaviour is proved natively by
 * scripts/dev/prove-a-cluster-tick-never-blocks-a-waiting-list-join.sh.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const MIGRATION = '20261122232612_a_cluster_tick_never_blocks_a_waiting_list_join.sql';
const sql = readFileSync(resolve(DIR, MIGRATION), 'utf8');
const OLD_LOCK = /cash_games WHERE id = p_game_id FOR UPDATE( SKIP LOCKED)?;/;

describe('the tick takes its game row with the lock its writes need, and no stronger', () => {
  it('replaces exactly the two FOR UPDATE takes, wake and pass, and nothing else', () => {
    expect(sql).toContain(
      '$o$    SELECT * INTO g FROM public.cash_games WHERE id = p_game_id FOR UPDATE SKIP LOCKED;$o$'
    );
    expect(sql).toContain(
      '$r$    SELECT * INTO g FROM public.cash_games WHERE id = p_game_id FOR NO KEY UPDATE SKIP LOCKED;$r$'
    );
    expect(sql).toContain(
      '$o$    SELECT * INTO g FROM public.cash_games WHERE id = p_game_id FOR UPDATE;$o$'
    );
    expect(sql).toContain(
      '$r$    SELECT * INTO g FROM public.cash_games WHERE id = p_game_id FOR NO KEY UPDATE;$r$'
    );
    expect(sql).toContain('was expected exactly once');
    expect(sql).toContain('the cluster tick lock did not install exactly');
  });

  it('refuses to lighten the lock if the tick ever deletes a game', () => {
    expect(sql).toContain("position('DELETE FROM public.cash_games' IN v_def)>0");
  });

  it('is one bounded transaction with a probe after the definition', async () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql).not.toMatch(/@install-window/);
    const mod = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    );
    expect(mod.missingProbes(sql)).toEqual([]);
  });

  it('no later migration puts the old lock back in the tick', () => {
    const later = readdirSync(DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIGRATION);
    for (const file of later) {
      const source = readFileSync(resolve(DIR, file), 'utf8');
      if (!/fn_cash_cluster_tick\s*\(/.test(source)) continue;
      expect(source, `${file} takes the tick's game row FOR UPDATE again`).not.toMatch(OLD_LOCK);
    }
  });

  it('the native proof checks the join, the wake and the FOR SHARE readers', () => {
    const proof = readFileSync(
      resolve(ROOT, 'scripts/dev/prove-a-cluster-tick-never-blocks-a-waiting-list-join.sh'),
      'utf8'
    );
    expect(proof).toContain("grep -q 'join: committed'");
    expect(proof).toContain("grep -q 'wake: skipped'");
    expect(proof).toContain("grep -q 'share reader: .*lock timeout'");
  });
});
