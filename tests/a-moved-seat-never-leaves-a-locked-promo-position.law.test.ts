/**
 * LAW: A MOVED SEAT NEVER LEAVES A LOCKED PROMO POSITION BEHIND (2026-11-21).
 *
 * Incidents bb04ee5f, e542fbd7 and 887c0008: a cash seat move left locked
 * promo positions keyed to the table the player had left, and a later hand on
 * that table was refused until its engine had been rebuilt for six hours.
 * 20261121143259 fixed the mover itself. This law pins the database-side rule
 * added by 20261121182315 so a FUTURE seat mover that forgets the follow call
 * cannot commit:
 *   1. a DEFERRED constraint trigger on public.table_seats, queued only when a
 *      LIVE occupancy ends (never on a stack update, never for a chair row
 *      whose occupant had already left);
 *   2. it refuses with promo_position_left_behind_by_seat_move (23514) only
 *      when the player is seated at ANOTHER table and still holds a locked
 *      position (open-grant principal, locked-gate winnings, unreleased
 *      integrity) on the table left; a plain exit is never refused;
 *   3. the trigger is declared in ca_declared_money_triggers;
 *   4. no later migration drops it or makes it non-deferred.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(__dirname, '../supabase/migrations');
const FILE = '20261121182315_a_moved_seat_never_leaves_a_locked_promo_position.sql';
const sql = readFileSync(resolve(DIR, FILE), 'utf8');
const TRIGGER = 'zz_moved_seat_leaves_no_locked_promo_position';
const FN = 'smarter_private.fn_moved_seat_leaves_no_locked_promo_position';

const body = (() => {
  const m =
    /CREATE OR REPLACE FUNCTION smarter_private\.fn_moved_seat_leaves_no_locked_promo_position\(\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$/.exec(
      sql
    );
  if (!m) throw new Error('function body not found');
  return m[1];
})();
const trigger = (() => {
  const m = new RegExp(
    `CREATE CONSTRAINT TRIGGER ${TRIGGER}([\\s\\S]*?)EXECUTE FUNCTION ([\\w.]+)\\(\\)`
  ).exec(sql);
  if (!m) throw new Error('constraint trigger not found');
  return { spec: m[1], fn: m[2] };
})();

describe('a moved seat never leaves a locked promo position', () => {
  it('is one transaction with a live proof', () => {
    expect(sql.startsWith('-- @live-proof:')).toBe(true);
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toMatch(/SET LOCAL lock_timeout = '\d+s'/);
  });

  it('is a deferred constraint trigger on table_seats that fires only when a live occupancy ends', () => {
    expect(trigger.fn).toBe(FN);
    expect(trigger.spec).toMatch(
      /AFTER UPDATE OF user_id, occupancy_id, left_at, table_id ON public\.table_seats/
    );
    expect(trigger.spec).toMatch(/DEFERRABLE INITIALLY DEFERRED/);
    expect(trigger.spec).toMatch(/FOR EACH ROW/);
    expect(trigger.spec).toMatch(/OLD\.user_id IS NOT NULL AND OLD\.left_at IS NULL/);
    // A stack update is the hot path and must never queue the check.
    expect(trigger.spec).not.toMatch(/\bstack\b/);
  });

  it('refuses only a move to another table that left a LOCKED position behind', () => {
    expect(body).toMatch(
      /s\.table_id = t AND s\.user_id = u AND s\.left_at IS NULL[\s\S]*?RETURN NULL/
    );
    expect(body).toMatch(
      /IF NOT EXISTS \(SELECT 1 FROM public\.table_seats s\s+WHERE s\.user_id = u AND s\.left_at IS NULL AND s\.table_id <> t\) THEN\s+RETURN NULL/
    );
    expect(body).toMatch(/g\.closed_at IS NULL/);
    expect(body).toMatch(/w\.unlocked_at IS NULL/);
    expect(body).toMatch(/ca_promo_integrity_releases/);
    expect(body).toMatch(
      /RAISE EXCEPTION 'promo_position_left_behind_by_seat_move'\s+USING ERRCODE = '23514'/
    );
  });

  it('is declared as a money trigger and revoked from every client role', () => {
    expect(sql).toMatch(
      new RegExp(`ca_declared_money_triggers[\\s\\S]*'table_seats', '${TRIGGER}'`)
    );
    expect(sql).toMatch(
      new RegExp(
        `REVOKE ALL ON FUNCTION ${FN.replace('.', '\\.')}\\(\\) FROM PUBLIC, anon, authenticated, service_role`
      )
    );
  });

  it('is never dropped or loosened by a later migration', () => {
    const later = readdirSync(DIR).filter((f) => f.endsWith('.sql') && f > FILE);
    for (const f of later) {
      const text = readFileSync(resolve(DIR, f), 'utf8');
      if (
        !text.includes(TRIGGER) &&
        !text.includes('fn_moved_seat_leaves_no_locked_promo_position')
      )
        continue;
      expect(text, `${f} drops the trigger`).not.toMatch(
        new RegExp(
          `DROP TRIGGER[^;]*${TRIGGER}[^;]*;(?![\\s\\S]*CREATE CONSTRAINT TRIGGER ${TRIGGER})`
        )
      );
      expect(text, `${f} drops the function`).not.toMatch(
        /DROP FUNCTION[^;]*fn_moved_seat_leaves_no_locked_promo_position/
      );
    }
  });
});
