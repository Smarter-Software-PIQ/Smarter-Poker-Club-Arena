/**
 * A RETIRED CLUB LEAVES THE CLUSTER TICK WORKLIST (2026-11-11)
 *
 * fn_cash_clusters_to_tick() admitted a must-move game while it was enabled
 * or had any table non-terminal by either liveness field, and never asked
 * whether the game's club could be written at all. fn_guard_retired_club_mutation
 * makes every gameplay record of a retired club read-only, so every tick of
 * such a game is refused (55000 CLUB_RETIRED). A disabled game is due every
 * pass, so 36 games of four retired certification fixtures produced ~5
 * controller_tick_error rows a second and kept ClusterPassErrors firing
 * (operational_alert_events 376546). Migration 20261111055020 excludes a
 * retired club's games from the worklist.
 *
 * This pins the cause: the latest literal definition of the worklist refuses
 * a retired club, the guard it defers to still covers the rows a tick writes,
 * and the pass still takes its games from this worklist (so the exclusion
 * governs every pass).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve(__dirname, '..', 'supabase', 'migrations');

const sources = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((file) => ({ file, source: readFileSync(resolve(MIGRATIONS, file), 'utf8') }));

/** The body of the last migration that defines public.<fn>(...), in version order. */
function latestBody(fn: string): { file: string; body: string } {
  const marker = `CREATE OR REPLACE FUNCTION public.${fn}(`;
  let latest: { file: string; body: string } | null = null;
  for (const { file, source } of sources) {
    const start = source.lastIndexOf(marker);
    if (start < 0) continue;
    const tail = source.slice(start);
    const opening = /\bAS\s+(\$[A-Za-z0-9_]*\$)/.exec(tail);
    if (!opening) continue;
    const bodyStart = opening.index + opening[0].length;
    const bodyEnd = tail.indexOf(opening[1], bodyStart);
    if (bodyEnd < 0) continue;
    latest = { file, body: tail.slice(bodyStart, bodyEnd) };
  }
  if (!latest) throw new Error(`No migration defines ${fn}`);
  return latest;
}

/** SQL with its line comments removed, so commentary cannot satisfy a pin. */
function code(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

describe('a retired club leaves the cluster tick worklist', () => {
  it('the worklist refuses a game whose club is retired', () => {
    const { body } = latestBody('fn_cash_clusters_to_tick');
    const where = code(body).replace(/\s+/g, ' ');
    expect(where).toMatch(
      /AND NOT EXISTS \( ?SELECT 1 FROM public\.clubs c WHERE c\.id = g\.club_id AND c\.lifecycle_status = 'retired' ?\)/
    );
  });

  it('the worklist still admits a disabled game on either liveness field', () => {
    const where = code(latestBody('fn_cash_clusters_to_tick').body).replace(/\s+/g, ' ');
    expect(where).toContain('WHERE g.must_move');
    expect(where).toMatch(/g\.enabled OR EXISTS/);
    expect(where).toMatch(/t\.lifecycle <> 'closed'/);
  });

  it('the pass ticks only what the worklist admits', () => {
    const pass = code(latestBody('fn_cash_clusters_tick_all').body);
    expect(pass).toMatch(/FROM public\.fn_cash_clusters_to_tick\(\) l/);
    expect(pass).toMatch(/public\.fn_cash_cluster_tick\(w\.game_id/);
  });

  it('the fixing migration gates its pre-image and asserts its postimage', () => {
    const fix = sources.find((s) =>
      s.file.endsWith('_a_retired_club_leaves_the_cluster_tick_worklist.sql')
    );
    expect(fix, 'fixing migration is present').toBeDefined();
    const sql = fix!.source;
    expect(sql).toContain("'41a70819e205ce35986b60066f0ef484'");
    expect(sql).toMatch(/still admits % game\(s\) of a retired club/);
    expect(sql).toMatch(/^-- @live-proof: .*lifecycle_status/m);
    expect(sql).not.toMatch(/@install-window/);
  });
});
