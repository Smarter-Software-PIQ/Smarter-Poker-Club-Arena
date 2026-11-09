/**
 * A SATELLITE'S NAME SURVIVES THE WEEKLY TERMS.
 *
 * Dan 2026-11-08: "If its a satellite, it should say 'Satellite Into 40 Chip
 * Freezeout'", and an event with no guarantee never says "0 GTD".
 *
 * Both rules live in fn_ca_tournament_copy_never_says_zero_guarantee. On
 * INSERT, Midway weekly rows are restamped with their catalog terms, name
 * included (NEW := jsonb_populate_record(NEW, fn_ca_midway_weekly_terms(...))),
 * and BEFORE triggers fire in name order. Twice the copy trigger sat in front
 * of such a restamp and was overwritten:
 *
 *  - 2026-11-09 02:02Z, behind tournaments_creation_guard (fixed 20261109023856);
 *  - 2026-11-09 17:15Z and 18:00Z, behind tournaments_lock_level_clock, which
 *    the first fix did not look for: "40 Chip Freezeout - 0 GTD (NLH)
 *    Satellite 5" was stored (fixed 20261109180446).
 *
 * So this law no longer names the rewriters. It reads every BEFORE INSERT
 * trigger on public.tournaments from the migrations, finds each one whose
 * function (latest definition) rebuilds NEW or assigns its name, and requires
 * the INSERT copy trigger to sort after all of them.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve(__dirname, '../supabase/migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const sources = files.map((f) => readFileSync(resolve(MIGRATIONS, f), 'utf8'));

const COPY = 'tournaments_lz_copy_follows_the_level_clock';
const COPY_FN = 'fn_ca_tournament_copy_never_says_zero_guarantee';

/** Latest CREATE TRIGGER per name on public.tournaments, unless dropped after it. */
function liveTournamentTriggers(): Map<string, string> {
  const live = new Map<string, string>();
  const event = /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)\s+([\s\S]*?);|DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ON\s+(?:public\.)?tournaments\b/gi;
  for (const sql of sources) {
    for (const m of sql.matchAll(event)) {
      if (m[1]) {
        if (/\sON\s+(?:public\.)?tournaments\s/i.test(m[2])) live.set(m[1], m[2]);
      } else if (m[3]) {
        live.delete(m[3]);
      }
    }
  }
  return live;
}

/** Latest body of a public function, by name. */
function latestBody(fn: string): string | null {
  let body: string | null = null;
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:"?\\w+"?\\.)?"?${fn}"?\\s*\\([\\s\\S]*?AS\\s+(\\$\\w*\\$)([\\s\\S]*?)\\1`,
    'gi'
  );
  for (const sql of sources) for (const m of sql.matchAll(re)) body = m[2];
  return body;
}

// A wholesale restamp of NEW, or a write of the name. (zz_freerolls_are_free_buy
// sets a fixed Free Buy short description that never states a zero guarantee.)
const REWRITES_NEW = /(NEW\s*:=|NEW\.name\s*:?=)/i;

describe("a satellite's name survives the weekly terms", () => {
  const live = liveTournamentTriggers();

  it('the copy rules run on INSERT from their own trigger', () => {
    const def = live.get(COPY);
    expect(def, `${COPY} is created by a migration`).toBeTruthy();
    expect(def).toMatch(/BEFORE\s+INSERT\s+ON\s+public\.tournaments/i);
    expect(def).toContain(`${COPY_FN}()`);
    expect(live.has('tournaments_d_copy_follows_the_weekly_terms')).toBe(false);
  });

  it('no BEFORE INSERT trigger that rewrites the row sorts after the copy trigger', () => {
    const rewriters: string[] = [];
    for (const [name, def] of live) {
      if (!/BEFORE\s+INSERT/i.test(def)) continue;
      const fn = def.match(/EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:\w+\.)?(\w+)\s*\(/i)?.[1];
      if (!fn || fn === COPY_FN) continue;
      const body = latestBody(fn);
      if (body && REWRITES_NEW.test(body)) rewriters.push(name);
    }
    // The detector must see the two rewriters that caused the defects, or it proves nothing.
    expect(rewriters).toEqual(
      expect.arrayContaining(['tournaments_creation_guard', 'tournaments_lock_level_clock'])
    );
    // Postgres fires same-kind triggers in name order (C collation).
    const late = rewriters.filter((n) => n > COPY).sort();
    expect(late, `these rewrite the row after ${COPY}`).toEqual([]);
  });

  it('the first copy trigger still covers UPDATE', () => {
    expect(live.get('ac_tournament_copy_never_says_zero_guarantee')).toMatch(
      /BEFORE\s+INSERT\s+OR\s+UPDATE\s+OF\s+name/i
    );
  });
});
