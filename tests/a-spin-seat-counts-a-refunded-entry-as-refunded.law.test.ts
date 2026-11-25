import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * A SPIN SEAT COUNTS A REFUNDED ENTRY AS REFUNDED (2026-11-24, incident
 * 7e8dce13-9eb8-436e-ae0e-c0af116b5dba, alert SpinHumanWaitingForOpponents).
 *
 * A player bought into a 5-chip Spin, unregistered (refunded) and bought in
 * again. fn_spin_book_entry proved "three paid seats" from GROSS buy-in
 * debits: the player read as having paid 10, the board as holding four
 * debits for 20, so every horse offered for the third seat was refused with
 * three_paid_seats_required and the player sat at 2/3 for 13 minutes before
 * leaving. The board could never deal again, for a person or a horse.
 *
 * fn_spin_draw_and_settle_atomic already proved each player's entry net of
 * refunds; the booking gate and the legacy draw never did. The law: the
 * newest definition of both nets refund credits, and no function's newest
 * definition anywhere in the migrations may prove "paid" from buy-in debits
 * alone.
 */
const DIR = join(__dirname, '..', 'supabase', 'migrations');
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

const HEADER = /CREATE OR REPLACE FUNCTION\s+public\.(\w+)\s*\(/g;

/** Every public function body, keyed by name, as its newest migration wrote it. */
export function newestDefinitions(sources: Array<[string, string]>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, sql] of sources) {
    const heads = [...sql.matchAll(HEADER)];
    heads.forEach((m, i) => {
      const end = i + 1 < heads.length ? heads[i + 1].index! : sql.length;
      out.set(m[1], sql.slice(m.index!, end));
    });
  }
  return out;
}

/** "Paid" proven from buy-in debits alone: the shape that refused the seat. */
export const provesPaidFromGrossDebits = (body: string) =>
  /HAVING\s+round\(\s*sum\(\s*w\.amount\s*\)\s*,\s*2\s*\)\s*=\s*round\(\s*v_t\.buy_in_amount/i.test(
    body
  );

/** Paid net of refunds, per player and board-wide, with irregular nets refused. */
export const provesPaidNetOfRefunds = (body: string) =>
  body.includes("w.category IN ('refund','tournament_refund')") &&
  /HAVING round\(sum\(CASE WHEN w\.type = 'debit' THEN w\.amount ELSE -w\.amount END\),2\)/.test(
    body
  ) &&
  /OR v_net_irregular <> 0/.test(body) &&
  !provesPaidFromGrossDebits(body);

describe('a Spin seat counts a refunded entry as refunded', () => {
  const all = newestDefinitions(files.map((f) => [f, read(f)]));

  for (const fn of ['fn_spin_book_entry', 'fn_spin_draw_and_settle']) {
    it(`${fn} proves its three paid seats net of refunds`, () => {
      expect(all.has(fn)).toBe(true);
      expect(provesPaidNetOfRefunds(all.get(fn)!)).toBe(true);
    });
  }

  it('would have failed on the 2026-09-09 definitions the incident ran', () => {
    const before = newestDefinitions([
      ['x', read('20260909014433_spin_reserve_settlement_commits_its_journal_or_nothing.sql')],
    ]);
    expect(provesPaidFromGrossDebits(before.get('fn_spin_book_entry')!)).toBe(true);
    expect(provesPaidNetOfRefunds(before.get('fn_spin_book_entry')!)).toBe(false);
  });

  it('no function anywhere proves paid from gross buy-in debits', () => {
    const offenders = [...all]
      .filter(([, body]) => provesPaidFromGrossDebits(body))
      .map(([n]) => n);
    expect(offenders).toEqual([]);
  });

  it('the real-PostgreSQL before/after regression runs in CI', () => {
    const ci = readFileSync(join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('python3 -B scripts/ci/test-spin-books-net-of-refunds.py');
  });
});
