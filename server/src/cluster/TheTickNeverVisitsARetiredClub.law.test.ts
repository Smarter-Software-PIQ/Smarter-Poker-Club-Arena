/**
 * THE CASH TICK NEVER VISITS A RETIRED CLUB (2026-11-13).
 *
 * Live 2026-11-13: 36 of the 84 games on the tick worklist belonged to four
 * retired clubs. A retired club is read-only (fn_guard_retired_club_mutation
 * raises CLUB_RETIRED), so every pass tried a write that could never succeed
 * and filed a controller_tick_error row for each: 25,884 an hour.
 * Migration 20261113124849 leaves a retired club's games off the list. This
 * law keeps the LATEST definition of fn_cash_clusters_to_tick doing so, and
 * keeps both tick passes reading that one list.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = new URL('../../../supabase/migrations/', import.meta.url);
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

/** The last migration's CREATE of `name(`, through the close of its dollar-quoted body. */
function latestBody(name: string): { file: string; body: string } {
  const head = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, 'i');
  for (const f of [...files].reverse()) {
    const sql = readFileSync(new URL(f, DIR), 'utf8');
    const m = head.exec(sql);
    if (!m) continue;
    const start = m.index;
    // The body's own dollar tag ($function$, $fn$, $$ ...), then its close.
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(start));
    if (!tag) throw new Error(`${f}: no body for public.${name}`);
    const open = start + tag.index + tag[0].length;
    const close = sql.indexOf(tag[1], open);
    return { file: f, body: sql.slice(start, close + tag[1].length) };
  }
  throw new Error(`no migration defines public.${name}`);
}

describe('the cash tick never visits a retired club', () => {
  it('the latest worklist leaves out every game of a retired club', () => {
    const { file, body } = latestBody('fn_cash_clusters_to_tick');
    expect(file >= '20261113124849').toBe(true);
    const code = body.replace(/--[^\n]*/g, '');
    expect(code).toMatch(
      /AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.clubs\s+c\s+WHERE\s+c\.id\s*=\s*g\.club_id\s+AND\s+c\.lifecycle_status\s*=\s*'retired'\s*\)/i
    );
    // Everything else the list promised still holds.
    expect(code).toContain('public.fn_cash_cluster_front_table(g.id)');
    expect(code).toMatch(/WHERE\s+g\.must_move/);
    expect(code).toMatch(/ORDER BY g\.created_at/);
  });

  it('both tick passes read that one list, so both engines skip a retired club', () => {
    const { body } = latestBody('fn_cash_clusters_tick_all');
    expect(body).toMatch(/FROM public\.fn_cash_clusters_to_tick\(\) l/);
    // The _uncapped twin is production's own fn_cash_clusters_tick_all with
    // only its header and per-game call swapped (20261112154904), so it reads
    // the same list. Pin that construction: it is copied from the original and
    // never rewrites the worklist line.
    const twin = readFileSync(
      new URL(files.find((f) => f.startsWith('20261112154904'))!, DIR),
      'utf8'
    );
    expect(twin).toContain(
      "pg_get_functiondef('public.fn_cash_clusters_tick_all(jsonb)'::regprocedure) INTO original"
    );
    expect(twin).not.toMatch(/fn_cash_clusters_to_tick/);
  });

  it('the guard this list mirrors still names the same retired state', () => {
    const guard = latestBody('fn_guard_retired_club_mutation');
    expect(guard.body).toMatch(/c\.lifecycle_status\s*=\s*'retired'/);
    expect(guard.body).toContain('CLUB_RETIRED: gameplay and cashier records are read-only');
  });
});
