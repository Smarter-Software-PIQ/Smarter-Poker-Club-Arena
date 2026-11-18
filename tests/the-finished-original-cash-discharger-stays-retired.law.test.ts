/**
 * LAW: THE FINISHED ORIGINAL CASH DISCHARGER STAYS RETIRED (2026-11-18,
 * incident 075013fd lane Q).
 *
 * smarter_private.original_erased_cash_base_discharge(bigint,text) was the
 * one-shot writer for seven historical erased cash bases. All seven were
 * discharged on 2026-10-13 and their certificates are immutable, yet the writer
 * kept md5 pins on 46 core money functions, so it went inert (every call
 * refused) and its pins refused an unrelated incident fix at install (#11256).
 * 20261118155910 retires it: STABLE, no pins, replay of a certificate only.
 *
 * This law keeps it that way. A later migration may not give the writer back
 * a write path or money pins, and nobody may paper over a pin on it with
 * @stale-pin-ok: a finished one-shot holds no pins at all.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allowedStalePins } from '../scripts/ci/migration-stale-pins.mjs';

const DIR = resolve(process.cwd(), 'supabase/migrations');
const RETIREMENT =
  '20261118155910_the_finished_original_cash_discharger_retires_and_releases_i.sql';
const SQL = readFileSync(resolve(DIR, RETIREMENT), 'utf8');
const WRITER_HEAD =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+smarter_private\.original_erased_cash_base_discharge\s*\(\s*e\s+bigint\s*,\s*h\s+text\s*\)/gi;

function writerBodies(sql: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(WRITER_HEAD)) {
    const rest = sql.slice(m.index ?? 0);
    const tag = rest.match(/AS\s+(\$[A-Za-z_]*\$)/);
    if (!tag || tag.index === undefined) throw new Error('writer body has no dollar quote');
    const start = tag.index + tag[0].length;
    const end = rest.indexOf(tag[1], start);
    out.push(rest.slice(0, tag.index) + '\n' + rest.slice(start, end));
  }
  return out;
}

function assertRetired(body: string) {
  expect(body).toMatch(/LANGUAGE\s+plpgsql\s+STABLE\b/i);
  expect(body).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM)\b/i);
  expect(body).not.toMatch(/fn_ca_restore_erased_seat_credit|SET\s+CONSTRAINTS/i);
  expect(body).not.toMatch(/[0-9a-f]{32}/);
  expect(body).toContain('original_cash_discharge_retired');
  expect(body).toContain('original_erased_cash_base_discharge_receipt(e,h)');
  expect(body).toContain("jsonb_build_object('replayed',true,'financial_payment',false)");
}

describe('the finished original cash discharger stays retired', () => {
  it('is retired in one transaction that moves its one pin and declares none stale', () => {
    expect(SQL.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(SQL.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(allowedStalePins(SQL)).toEqual([]);
    expect(SQL).not.toMatch(/break_window_migration_override|@install-window/);
    expect(SQL).toMatch(/^-- @live-proof: .*original_inventory_proof_sources_match\(\) IS TRUE/m);
    expect(SQL).toContain("'9e6fcbf606004b81353a7704b50f072f'");
    expect(SQL).toContain(
      'DISCHARGER_RETIREMENT_REFUSED: the finite discharge set is not complete'
    );
    expect(SQL).toContain('the old writer body % is still pinned');
    const bodies = writerBodies(SQL);
    expect(bodies).toHaveLength(1);
    assertRetired(bodies[0]);
  });

  it('no later migration gives it back a write path or a pin', () => {
    const later = readdirSync(DIR)
      .filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > RETIREMENT)
      .sort();
    for (const f of later) {
      const sql = readFileSync(resolve(DIR, f), 'utf8');
      for (const body of writerBodies(sql)) assertRetired(body);
      for (const md5 of allowedStalePins(sql))
        expect(
          ['9e6fcbf606004b81353a7704b50f072f', 'f104a8a1b56061b7c638eeee04f253a2'],
          f
        ).not.toContain(md5);
    }
  });

  it('the retired writer is pinned by its proof and fixture', () => {
    const proof = readFileSync(
      resolve(process.cwd(), 'tests/unit/theFinishedOriginalCashDischargerRetires.pg.test.ts'),
      'utf8'
    );
    expect(proof).toContain(RETIREMENT);
    expect(proof).toContain('migration_left_a_stale_pin');
    const fixture = readFileSync(
      resolve(
        process.cwd(),
        'scripts/ci/fixtures/original-cash-discharger-retirement/sources-match-production.sql'
      ),
      'utf8'
    );
    expect(fixture).toContain(
      "('smarter_private.original_erased_cash_base_discharge(bigint,text)','9e6fcbf606004b81353a7704b50f072f')"
    );
  });
});
