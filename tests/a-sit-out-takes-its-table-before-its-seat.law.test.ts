/**
 * LAW: A SIT-OUT OR A DEPARTURE TAKES ITS TABLE BEFORE ITS SEAT (2026-11-22).
 *
 * A tournament hand's continuation journal (fn_f06_retain_hand_continuation ->
 * fn_ca_f06_share_table_lane) and the engine's sit-out of a person at the same
 * table (fn_cash_seat_sitout) deadlocked twice on 2026-11-22. The lane takes
 * the table row FOR UPDATE and then the table's seats in id order, the order
 * every hand lane uses. The sit-out took the seat first, and its UPDATE of
 * is_sitting_out fires zz_note_human_seat_seen, which updates the table row
 * (last_human_seen_at): seat, then table. fn_request_seat_departure has the
 * same shape. Migration 20261123024034 makes both take the table row FOR NO
 * KEY UPDATE (the mode that trigger's UPDATE takes) before the seat. Proved
 * natively by scripts/dev/prove-a-sit-out-takes-its-table-before-its-seat.sh,
 * which replays the logged interleaving on production's own text.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const MIGRATION = '20261123024034_a_sit_out_takes_its_table_before_its_seat.sql';
const sql = readFileSync(resolve(DIR, MIGRATION), 'utf8');
const TABLE_LOCK = 'PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE;';
const SEAT_LOCK = {
  fn_cash_seat_sitout: 'SELECT * INTO seat FROM public.table_seats ts WHERE ts.table_id=p_table_id',
  fn_request_seat_departure: 'SELECT id INTO v_seat_id FROM public.table_seats',
} as const;

/** The replacement text ($r$ ... $r$) of the edit block for one function. */
function replacement(fn: keyof typeof SEAT_LOCK): string {
  const block = sql.indexOf(`v_def text := pg_get_functiondef('public.${fn}(`);
  expect(block, `${fn} has an edit block`).toBeGreaterThan(-1);
  const start = sql.indexOf('$r$', block);
  const end = sql.indexOf('$r$', start + 3);
  return sql.slice(start + 3, end);
}

const stripComments = (text: string) => text.replace(/--[^\n]*/g, '');

describe('a seat writer that fires the table stamp takes the table row first', () => {
  it('puts the table lock immediately before the seat lock in both functions', () => {
    for (const fn of Object.keys(SEAT_LOCK) as (keyof typeof SEAT_LOCK)[]) {
      const body = stripComments(replacement(fn));
      const table = body.indexOf(TABLE_LOCK);
      const seat = body.indexOf(SEAT_LOCK[fn]);
      expect(table, `${fn} takes its table`).toBeGreaterThan(-1);
      expect(seat, `${fn} still takes its seat`).toBeGreaterThan(table);
      expect(body.split(TABLE_LOCK)).toHaveLength(2);
    }
  });

  it('takes the table in the mode the trigger write needs, and no other', () => {
    // The trigger runs UPDATE public.tables SET last_human_seen_at (not a key
    // column): FOR NO KEY UPDATE. Weaker would have to be upgraded after the
    // seat is held; FOR UPDATE would also block every foreign key check.
    const code = stripComments(sql);
    expect(code).not.toMatch(
      /FROM public\.tables WHERE id=p_table_id FOR (UPDATE|SHARE|KEY SHARE)\b/
    );
    const trigger = readFileSync(
      resolve(DIR, '20261112022000_a_table_remembers_its_last_human.sql'),
      'utf8'
    );
    expect(trigger).toContain(
      'UPDATE public.tables SET last_human_seen_at = now() WHERE id = tid;'
    );
    expect(trigger).toMatch(
      /AFTER INSERT OR DELETE OR UPDATE OF leave_pending, is_sitting_out ON public\.table_seats/
    );
  });

  it('anchors each edit exactly once and refuses a second application', () => {
    expect(sql).toContain(
      "RAISE EXCEPTION 'fn_cash_seat_sitout seat lock anchor was expected exactly once'"
    );
    expect(sql).toContain(
      "RAISE EXCEPTION 'fn_request_seat_departure seat lock anchor was expected exactly once'"
    );
    expect(sql).toContain('already takes its table before its seat: re-read before editing');
    expect(sql.match(/EXECUTE replace\(v_def,v_old,v_new\);/g)).toHaveLength(2);
    expect(sql).toContain(
      "<= position('FROM public.tournaments WHERE id=v_tournament FOR NO KEY UPDATE' IN pg_get_functiondef('public.fn_request_seat_departure(uuid,uuid,integer,uuid,text)'::regprocedure))"
    );
    expect(sql).toContain(
      'the departure table lock did not install exactly once between its tournament and seat locks'
    );
    expect(sql).toContain(
      'the sit-out table lock did not install exactly once before its seat lock'
    );
  });

  it('treats every seat the same: nothing in the change reads is_horse', () => {
    expect(stripComments(sql)).not.toMatch(/is_horse/);
  });

  it('is one bounded transaction with a probe after each definition', async () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql).not.toMatch(/@install-window/);
    expect(sql.match(/^-- @live-proof: \(SELECT /gm)).toHaveLength(2);
    const mod = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    );
    expect(mod.missingProbes(sql)).toEqual([]);
  });

  it('no later migration takes either seat before its table again', () => {
    const later = readdirSync(DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIGRATION);
    for (const file of later) {
      const source = readFileSync(resolve(DIR, file), 'utf8');
      for (const fn of Object.keys(SEAT_LOCK) as (keyof typeof SEAT_LOCK)[]) {
        const head = source.search(
          new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`, 'i')
        );
        if (head >= 0) {
          const body = stripComments(source.slice(head));
          const seat = body.indexOf(SEAT_LOCK[fn]);
          const table = body.indexOf(TABLE_LOCK);
          expect(table, `${file} redefines ${fn} without its table lock`).toBeGreaterThan(-1);
          expect(seat, `${file} takes the ${fn} seat before its table`).toBeGreaterThan(table);
        }
        if (source.includes(fn) && source.includes('pg_get_functiondef')) {
          expect(
            stripComments(source),
            `${file} rewrites ${fn} and strips its table lock`
          ).not.toMatch(
            /replace\([^)]*PERFORM 1 FROM public\.tables WHERE id=p_table_id FOR NO KEY UPDATE/
          );
        }
      }
    }
  });

  it('the native proof replays the logged deadlock and its fix on production text', () => {
    const proof = readFileSync(
      resolve(ROOT, 'scripts/dev/prove-a-sit-out-takes-its-table-before-its-seat.sh'),
      'utf8'
    );
    expect(proof).toContain(`"\${PSQL[@]}" -f "$MIGRATION"`);
    expect(proof).toContain('grep -q \'DEADLOCK\' <<<"$b1"');
    expect(proof).toContain("grep -q 'writer: committed | lane: committed'");
    for (const fx of [
      'fn_ca_f06_share_table_lane',
      'fn_note_human_seat_seen',
      'fn_cash_seat_sitout',
      'fn_request_seat_departure',
    ]) {
      expect(
        existsSync(
          resolve(
            ROOT,
            `scripts/dev/fixtures/a-sit-out-takes-its-table-before-its-seat/${fx}.preimage.sql`
          )
        )
      ).toBe(true);
    }
  });
});
