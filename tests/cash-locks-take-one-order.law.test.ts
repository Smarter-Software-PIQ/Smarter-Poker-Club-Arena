/**
 * LAW: CASH LOCKS TAKE ONE ORDER (2026-11-22).
 *
 * Read from the Postgres log for the 24 hours to 2026-11-23 01:20 UTC: a
 * player's cash-out (fn_cashout_seat_occupancy) deadlocked three times and the
 * cash-out was cancelled each time; the stay-clock evaluation
 * (fn_cash_session_evaluate) deadlocked five times with a Lightning
 * settlement. Each was two paths taking the same rows in opposite orders:
 *
 *  1. fn_cash_session_evaluate locked one cash_player_session row per entry in
 *     the caller's order; the Lightning trigger sends player_id order, the
 *     engine seat order (20261123024428: the loop walks player_id order).
 *  2. The cash-out locked its seat, credited the wallet (which upserts the
 *     table's club_table_daily row) and took the tables row last; the dealt
 *     manifest and a buy-in hold the table and then want the seat or that
 *     reporting row (20261123024433: both cash-out functions take a cash
 *     table's row before the seat, parent before child, as they already do
 *     for a tournament's game row and a diamond table).
 *  3. A horse buyer took the table only at its last statement, after its
 *     reporting rows; a human buyer took it with the chair. Horses are
 *     players: every buyer now takes it right after its chair insert.
 *  4. The seat-exit trigger locked add-ons an open hand envelope owns before
 *     skipping them, while that hand's post-commit held the add-on and waited
 *     for the seat; they are skipped before the lock now.
 *
 * Nothing moves money differently. The native proof
 * scripts/dev/prove-cash-locks-take-one-order.sh runs the byte-identical live
 * bodies, reproduces each deadlock, and shows each pair committing after.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const EVALUATE = '20261123024428_a_cash_session_evaluation_locks_its_players_in_one_order.sql';
const EXIT = '20261123024433_a_cash_exit_locks_its_table_before_its_seat.sql';
const evaluateSql = readFileSync(resolve(DIR, EVALUATE), 'utf8');
const exitSql = readFileSync(resolve(DIR, EXIT), 'utf8');

/** The replacement text ($r$ ... $r$) of the edit block a DO tag names. */
function replacement(sql: string, tag: string): string {
  const start = sql.indexOf(`DO $${tag}$`);
  expect(start, `the ${tag} edit block exists`).toBeGreaterThan(-1);
  const end = sql.indexOf(`$${tag}$;`, start + tag.length + 4);
  const block = sql.slice(start, end);
  const r = block.indexOf('$r$');
  return block.slice(r + 3, block.indexOf('$r$', r + 3));
}

/** Later migrations that mention a function, for the no-regression pins. */
function laterMentioning(after: string, fn: RegExp): Array<{ file: string; source: string }> {
  return readdirSync(DIR)
    .filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > after)
    .map((file) => ({ file, source: readFileSync(resolve(DIR, file), 'utf8') }))
    .filter(({ source }) => fn.test(source));
}

describe('1. a cash session evaluation locks its players in player_id order', () => {
  const loop = replacement(evaluateSql, 'order_players');

  it('replaces the caller-order loop with one ordered by the player uuid, then position', () => {
    expect(evaluateSql).toContain(
      "$o$  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_entries, '[]'::jsonb)) LOOP$o$"
    );
    expect(loop).toContain('WITH ORDINALITY AS e(value, ord)');
    expect(loop).toMatch(
      /ORDER BY CASE WHEN pg_input_is_valid\(e\.value->>'user_id', 'uuid'\)\s+THEN \(e\.value->>'user_id'\)::uuid END NULLS LAST,\s+e\.ord LOOP$/
    );
    expect(loop).not.toContain('SELECT * FROM jsonb_array_elements');
  });

  it('the Lightning trigger it must agree with sorts by player_id', () => {
    // fn_lightning_cash_clock_at_settlement builds each table's entries
    // "ORDER BY hp.player_id" (uuid); the loop sorts by the same uuid.
    expect(evaluateSql).toContain('ORDER BY player_id');
  });

  it('refuses to install twice and verifies the installed loop', () => {
    expect(evaluateSql).toContain('already orders its players: re-read before editing');
    expect(evaluateSql).toContain('entry loop anchor was expected exactly once');
    expect(evaluateSql).toContain(
      'the ordered player loop did not install in fn_cash_session_evaluate'
    );
    expect(evaluateSql).toMatch(
      /-- @live-proof: \(SELECT pg_get_functiondef\('public\.fn_cash_session_evaluate\(uuid,jsonb\)'/
    );
  });

  it('no later migration walks the entries in the caller order again', () => {
    for (const { file, source } of laterMentioning(EVALUATE, /fn_cash_session_evaluate/)) {
      expect(source, `${file} restores the caller-order loop`).not.toContain(
        "FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_entries, '[]'::jsonb)) LOOP"
      );
    }
  });
});

describe('2. a cash-out locks its table before its seat', () => {
  const wrapper = replacement(exitSql, 'wrapper_table');
  const canonical = replacement(exitSql, 'cashout_table');

  it('the engine wrapper takes a chip cash table after the diamond branch, before the seat', () => {
    expect(exitSql).toContain(
      '$o$    PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;\n  END IF;\n$o$'
    );
    expect(wrapper).toMatch(
      /^ {4}PERFORM 1 FROM public\.profiles WHERE id=p_user_id FOR UPDATE;\n {2}ELSIF v_tournament IS NULL THEN\n[\s\S]*\n {4}PERFORM 1 FROM public\.tables WHERE id=p_table_id FOR NO KEY UPDATE;\n {2}END IF;\n$/
    );
    expect(exitSql).toContain(
      "IF v_table = 0 OR v_seat = 0 OR v_table > v_seat THEN\n    RAISE EXCEPTION 'the cash-out wrapper does not lock its table before its seat'"
    );
  });

  it('the canonical cash-out takes a cash table where it takes a tournament game: before the seat', () => {
    expect(exitSql).toContain(
      '$o$    PERFORM 1 FROM tournaments WHERE id = v_tournament FOR NO KEY UPDATE;\n  END IF;\n$o$'
    );
    expect(canonical).toMatch(
      /^ {4}PERFORM 1 FROM tournaments WHERE id = v_tournament FOR NO KEY UPDATE;\n {2}ELSE\n[\s\S]*\n {4}PERFORM 1 FROM tables WHERE id = p_table_id FOR NO KEY UPDATE;\n {2}END IF;\n$/
    );
    // verified in the installed body: game < table < seat < credit
    expect(exitSql).toContain('NOT (v_game < v_table AND v_table < v_seat AND v_seat < v_credit)');
  });

  it('takes the lock its own current_players UPDATE takes, never a stronger one', () => {
    for (const text of [wrapper, canonical]) {
      expect(text).toContain('FOR NO KEY UPDATE;');
      expect(text).not.toMatch(/tables WHERE id ?= ?p_table_id FOR UPDATE/);
    }
  });

  it('no later migration takes the seat before the cash table again', () => {
    const oldCanonical =
      /FROM tournaments WHERE id = v_tournament FOR NO KEY UPDATE;\s*END IF;\s*IF p_seat_number IS NOT NULL/;
    const oldWrapper =
      /PERFORM 1 FROM public\.profiles WHERE id=p_user_id FOR UPDATE;\s*END IF;\s*SELECT id,seat_number,occupancy_id INTO v_seat/;
    for (const { file, source } of laterMentioning(
      EXIT,
      /atomic_seat_cashout_locked|fn_cashout_seat_occupancy/
    )) {
      expect(source, `${file} locks the seat before the table again`).not.toMatch(oldCanonical);
      expect(source, `${file} locks the seat before the table again`).not.toMatch(oldWrapper);
    }
  });
});

describe('3. every buyer takes its table with its chair, before its money', () => {
  const buyin = replacement(exitSql, 'buyin_table');

  it('locks the table right after the chair insert, for horse and human alike', () => {
    expect(buyin).toMatch(
      /^ {2}INSERT INTO table_seats \(table_id, seat_number, user_id, stack, status, auto_rebuy, club_id\)\n {7}VALUES \(p_table_id, p_seat_number, p_user_id, p_amount, 'active', p_auto_rebuy, v_seat_club\);\n\n[\s\S]*\n {2}PERFORM 1 FROM tables WHERE id = p_table_id FOR NO KEY UPDATE;\n$/
    );
    expect(buyin).not.toMatch(/is_horse/);
    expect(exitSql).toContain('NOT (v_insert < v_table AND v_table < v_journal)');
  });

  it('no later migration journals a buy-in before its table again', () => {
    const oldBuyin =
      /VALUES \(p_table_id, p_seat_number, p_user_id, p_amount, 'active', p_auto_rebuy, v_seat_club\);\s*-- CHIP CONTINUITY: the session opens with the seat/;
    for (const { file, source } of laterMentioning(
      EXIT,
      /atomic_table_buyin_before_maintenance_announcement_gate/
    )) {
      expect(source, `${file} drops the buy-in table lock`).not.toMatch(oldBuyin);
    }
  });
});

describe('4. a seat exit never waits for an add-on its hand owns', () => {
  const exitLoop = replacement(exitSql, 'exit_addons');

  it('skips owned add-ons in the locking query and keeps the check after the lock', () => {
    const skip = exitLoop.indexOf('AND NOT EXISTS (');
    const lock = exitLoop.indexOf('FOR UPDATE');
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(lock);
    expect(exitLoop).toContain('oc.post_commit_completed_at IS NULL');
    expect(exitLoop).toContain("(oc.post_commit_payload #> '{pending_addons,ids}') ? a.id::text");
    expect(exitSql).toContain('has no post-lock ownership check: re-read before editing');
    expect(exitSql).toContain('NOT (v_skip < v_lock AND v_lock < v_recheck)');
  });

  it('no later migration locks owned add-ons before skipping them again', () => {
    const oldLoop = /AND a\.resolved_at IS NULL\s*ORDER BY a\.created_at, a\.id\s*FOR UPDATE/;
    for (const { file, source } of laterMentioning(EXIT, /fn_record_ended_seat_occupancy/)) {
      expect(source, `${file} waits on owned add-ons again`).not.toMatch(oldLoop);
    }
  });
});

describe('the two files change lock order and nothing else', () => {
  it('each is one bounded transaction whose functions are proved before commit', async () => {
    const mod = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    );
    for (const sql of [evaluateSql, exitSql]) {
      expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
      expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
      expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
      expect(sql).not.toMatch(/@install-window/);
      expect(mod.missingProbes(sql)).toEqual([]);
    }
    expect(exitSql.match(/^-- @live-proof: /gm)).toHaveLength(4);
  });

  it('neither moves a chip: no balance or journal write outside the function texts', () => {
    for (const sql of [evaluateSql, exitSql]) {
      const outside = sql.replace(/\$[or]\$[\s\S]*?\$[or]\$/g, '');
      expect(outside).not.toMatch(
        /^\s*UPDATE public\.(club_members|wallets|club_wallets|union_wallets|clubs|table_seats)\b/m
      );
      expect(outside).not.toMatch(
        /^\s*INSERT INTO public\.(wallet_transactions|chip_ledger|table_seats)\b/m
      );
    }
  });

  it('the native proof reproduces every deadlock and commits every pair after', () => {
    const proof = readFileSync(
      resolve(ROOT, 'scripts/dev/prove-cash-locks-take-one-order.sh'),
      'utf8'
    );
    expect(proof).toContain(
      '[ "$A" = deadlock ] && [ "$B" = deadlock ] && [ "$C" = deadlock ] && [ "$D" = deadlock ]'
    );
    expect(proof).toContain(
      '[ "$A" = committed ] && [ "$B" = committed ] && [ "$H" = committed ] && [ "$C" = committed ] && [ "$D" = committed ]'
    );
    expect(proof).toContain(
      '[ "$H" = deadlock ] || { echo \'PROOF FAILED: the old buy-in did not deadlock with the new cash-out\''
    );
    expect(proof).toContain('is not the production body');
    expect(proof).toContain(EVALUATE.slice(0, 14));
    expect(proof).toContain(EXIT.slice(0, 14));
  });
});
