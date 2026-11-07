/**
 * A NEW TABLE FILLS FROM ITS LIST ONE NAME AT A TIME, AND AN UNPICKED SECOND
 * TABLE IS BROKEN, NOT DRAINED (owner 2026-11-07).
 *
 * fn_cash_cluster_tick's open-chair offer step calls a table's next name only
 * once the last one has sat (no live hold) and 20 seconds have passed since
 * the last arrival; its BREAK step breaks a game's newest table when the game
 * holds more live tables than its cap (which carries the second-table pick),
 * provided every person fits on the rest. Both changes are pinned to the
 * production preimage and keep the tick's existing contracts.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const FILE = '20261107195847_a_new_table_fills_from_its_list_one_name_at_a_time_and_an_un.sql';
const SQL = readFileSync(join(DIR, FILE), 'utf8');

describe('a new table fills from its list and a table breaks visibly', () => {
  it('is one transaction, pinned to the production preimage, never a replay', () => {
    expect(SQL).toMatch(/^BEGIN;$/m);
    expect(SQL).toMatch(/^COMMIT;$/m);
    expect(SQL).toContain("md5(original) <> '43e5133f4fd48ec81878843301f243fa'");
    expect(SQL).toContain('EXECUTE patched;');
    // every anchor must have changed the text, or the migration refuses
    for (const anchor of ['declare', 'offer step', 'break fit', 'break event']) {
      expect(SQL).toContain(`RAISE EXCEPTION '${anchor} anchor absent'`);
    }
    expect(SQL).toContain('@live-proof:');
  });

  it('calls one name at a time: no new offer while a called name has not sat, and a gap after each arrival', () => {
    const step = SQL.slice(
      SQL.indexOf('-- 1. one name at a time'),
      SQL.indexOf('-- 2. an unpicked')
    );
    expect(step).toContain("h.status = 'notified'");
    expect(step).toContain(
      "coalesce(h.hold_expires_at, h.notified_at + interval '60 seconds') > v_now"
    );
    expect(step).toContain("ts.joined_at > v_now - interval '20 seconds'");
    // The order is still the platform's own FIFO door, for people and horses alike.
    expect(step).toContain('PERFORM public.fn_offer_open_seat(t.id);');
  });

  it('breaks a game held over its table cap through the ordinary BREAK path, only when every person fits', () => {
    const step = SQL.slice(
      SQL.indexOf('-- 2. an unpicked'),
      SQL.indexOf("IF position('fn_cash_game_never_moves_players(")
    );
    expect(step).toContain('> v_table_cap;');
    expect(step).toContain('NOT coalesce(p.is_horse, false)');
    expect(step).toContain('OR (v_over_cap AND v_people < v_remaining_capacity)) THEN');
    // The original fit is kept as the first arm; nothing else about BREAK changes.
    expect(step).toContain('(v_seated_total < v_remaining_capacity');
    expect(step).toContain("'over_cap', v_over_cap, 'people', v_people));");
    // A break moves, it never cashes anyone out.
    expect(SQL).not.toMatch(/atomic_cashout|cashout/i);
  });

  it('keeps the tick reading the one must-move, open-chair and second-table rules', () => {
    expect(SQL).toContain("position('fn_cash_game_never_moves_players(' IN patched) = 0");
    expect(SQL).toContain("position('AN OPEN CHAIR IS OFFERED TO THE LIST' IN patched) = 0");
    expect(SQL).toContain(
      "position('fn_cash_game_second_table_picked(g.id, v_now)' IN patched) = 0"
    );
    expect(SQL).toContain('TO service_role;');
  });

  it('no later migration drops either step from the tick', () => {
    for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql') && f > FILE)) {
      const text = readFileSync(join(DIR, f), 'utf8');
      if (!/fn_cash_cluster_tick\(uuid,\s*integer\)/.test(text)) continue;
      expect(text, f).not.toMatch(/replace\([^;]*ONE NAME AT A TIME[^;]*''\)/);
      expect(text, f).not.toMatch(/replace\([^;]*AN UNPICKED SECOND TABLE IS BROKEN[^;]*''\)/);
    }
  });
});
