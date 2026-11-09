/**
 * A SATELLITE'S NAME SURVIVES THE WEEKLY TERMS.
 *
 * Dan 2026-11-08: "If its a satellite, it should say 'Satellite Into 40 Chip
 * Freezeout'", and an event with no guarantee never says "0 GTD".
 *
 * Both rules live in fn_ca_tournament_copy_never_says_zero_guarantee. On
 * INSERT, tournaments_creation_guard stamps a Midway weekly row with its
 * catalog terms (NEW := jsonb_populate_record(NEW, fn_ca_midway_weekly_terms(...))),
 * name included, and triggers fire in name order. The copy trigger that sorts
 * BEFORE the guard was overwritten by it, so the first weekly satellites spawned
 * after the rename were stored as "40 Chip Bounty Freezeout - 0 GTD (NLH)
 * Satellite 5" and "Sunday Deep Stack Satellite 30" (2026-11-09).
 *
 * This law pins that the copy function also runs on INSERT from a trigger
 * that sorts after the creation guard, so the catalog's terms are applied
 * first and the copy rules apply to what they produce.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve(__dirname, '../supabase/migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

function lastCreateTrigger(name: string): string | null {
  let found: string | null = null;
  const re = new RegExp(`CREATE TRIGGER\\s+${name}\\b[\\s\\S]*?;`, 'g');
  for (const f of files) {
    const sql = readFileSync(resolve(MIGRATIONS, f), 'utf8');
    for (const m of sql.matchAll(re)) found = m[0];
  }
  return found;
}

describe("a satellite's name survives the weekly terms", () => {
  it('the creation guard that stamps the weekly terms runs on INSERT', () => {
    const guard = lastCreateTrigger('tournaments_creation_guard');
    expect(guard, 'tournaments_creation_guard is created by a migration').toBeTruthy();
    expect(guard).toMatch(/BEFORE\s+INSERT/i);
  });

  it('the copy rules run on INSERT from a trigger that sorts after the creation guard', () => {
    const name = 'tournaments_d_copy_follows_the_weekly_terms';
    const trigger = lastCreateTrigger(name);
    expect(trigger, `${name} is created by a migration`).toBeTruthy();
    expect(trigger).toMatch(/BEFORE\s+INSERT\s+ON\s+public\.tournaments/i);
    expect(trigger).toContain('fn_ca_tournament_copy_never_says_zero_guarantee()');
    // Postgres fires same-kind triggers in name order (C collation).
    expect(name > 'tournaments_creation_guard').toBe(true);
    expect(name < 'tournaments_guarantee_affordable_ins').toBe(true);
  });

  it('the first copy trigger still covers UPDATE', () => {
    const trigger = lastCreateTrigger('ac_tournament_copy_never_says_zero_guarantee');
    expect(trigger).toMatch(/BEFORE\s+INSERT\s+OR\s+UPDATE\s+OF\s+name/i);
  });
});
