/**
 * AN OPEN CHAIR IS OFFERED TO THE LIST (2026-11-07).
 *
 * A game's waiting list was only offered a seat when someone cashed out, so a
 * chair that was already open (a new second table, a short table, an empty
 * game) never reached the person waiting, and the lobby printed "Waitlist 1"
 * beside open seats. The cluster tick now offers every live table's open
 * unreserved chairs through the platform's own fn_offer_open_seat each tick.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const FILE = '20261107163937_an_open_chair_is_offered_to_the_game_list_every_tick.sql';
const SQL = readFileSync(join(DIR, FILE), 'utf8');

describe('an open chair is offered to the list', () => {
  it('the tick offers open unreserved chairs through the one offer door, before OPEN', () => {
    const step = SQL.slice(
      SQL.indexOf('AN OPEN CHAIR IS OFFERED TO THE LIST'),
      SQL.indexOf('-- ── 3. OPEN (18.3)$insert$')
    );
    expect(step).toContain("w.status = 'waiting'");
    expect(step).toContain('c.open_unreserved > 0');
    expect(step).toContain('NOT c.breaking');
    expect(step).toContain('PERFORM public.fn_offer_open_seat(t.id);');
  });

  it('an offer that refuses can never fail the tick', () => {
    expect(SQL).toMatch(
      /BEGIN\s+PERFORM public\.fn_offer_open_seat\(t\.id\);\s+EXCEPTION WHEN OTHERS THEN/
    );
  });

  it('no later migration drops the step from the tick', () => {
    for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql') && f > FILE)) {
      const text = readFileSync(join(DIR, f), 'utf8');
      if (
        !/fn_cash_cluster_tick\(uuid,\s*integer\)/.test(text) ||
        !/EXECUTE patched|CREATE OR REPLACE FUNCTION public\.fn_cash_cluster_tick/.test(text)
      )
        continue;
      expect(text, f).not.toMatch(/replace\([^;]*AN OPEN CHAIR IS OFFERED TO THE LIST[^;]*''\)/);
    }
  });
});
