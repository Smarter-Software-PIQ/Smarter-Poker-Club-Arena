/**
 * A BUST MONEY SPAN CHANGES NOTHING (2026-11-14, incident #3)
 *
 * 20261114190106 re-creates the knockout door (fn_claim_tournament_bounty_
 * elimination) and the payer's entry point (fn_collect_bounty_obligation) with
 * timing spans so
 * the ~0.65 s each spent on Midnight Free Buy b6d94533 can be located. The
 * instrumentation is admissible only if it cannot change a result, an error
 * path or the lock order:
 *
 *   - deleting every line marked `-- @bust-money-span` restores the exact body
 *     of the migration it replaces, byte for byte (the bodies production runs:
 *     prosrc md5 4ec5bce3... and dde145f7...);
 *   - every span is a RAISE LOG: no write, no lock, no subtransaction (review
 *     of #10852: a BEGIN/EXCEPTION write per span took a subxid each, 80 per
 *     bounty sweep, past the 64-entry subxid cache), and it does not touch
 *     FOUND or ROW_COUNT;
 *   - no span appears inside the lane's own lock block;
 *   - the held removal migration restores the exact production bodies and
 *     grants, and is not in supabase/migrations until the measurement is in.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = resolve(__dirname, '../supabase/migrations');
const read = (name: string) => readFileSync(resolve(dir, name), 'utf8');
const MIGRATION = read('20261114190106_bust_money_path_timing_spans.sql');
const MARK = '-- @bust-money-span';

function bodyOf(sql: string, fn: string): string {
  const head = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION\\s+public\\.${fn}\\s*\\(`));
  expect(head, `${fn} is defined`).toBeGreaterThanOrEqual(0);
  const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(head))!;
  const start = head + tag.index + tag[0].length;
  return sql.slice(start, sql.indexOf(tag[1], start));
}

const SOURCES = {
  fn_claim_tournament_bounty_elimination: {
    file: '20261022063749_a_bounty_bust_waits_for_its_tournament_lane.sql',
    md5: '4ec5bce3b65e7b1f18af615a5bdb1a96',
    spans: 7,
  },
  fn_collect_bounty_obligation: {
    file: '20260908042000_bounty_elimination_outbox_is_atomic_and_recoverable.sql',
    md5: 'dde145f7b818e905ecf8f6354e55f055',
    spans: 5,
  },
} as const;

const strip = (body: string) =>
  body
    .split(/(?<=\n)/)
    .filter((line) => !line.includes(MARK))
    .join('');

describe('a bust money span changes nothing', () => {
  for (const [fn, source] of Object.entries(SOURCES)) {
    const instrumented = bodyOf(MIGRATION, fn);

    it(`${fn}: without its marked lines it is the body production runs, byte for byte`, () => {
      const original = bodyOf(read(source.file), fn);
      expect(createHash('md5').update(original).digest('hex')).toBe(source.md5);
      expect(strip(instrumented)).toBe(original);
      expect(instrumented.split(MARK).length - 1).toBe(source.spans);
    });

    it(`${fn}: every span is a RAISE LOG and nothing else`, () => {
      const spans = instrumented.split('\n').filter((line) => line.includes(MARK));
      expect(spans[0]).toMatch(/^  v_span_t0 timestamptz := clock_timestamp\(\); -- @bust-money-span$/);
      for (const line of spans.slice(1)) {
        expect(line).toMatch(
          /^  RAISE LOG 'ca_bust_money_span fn=(door|payer) mark=[a-z_]+ tournament=% t0=% ms=%', [A-Za-z_.:]+, v_span_t0, round\(\(extract\(epoch FROM clock_timestamp\(\) - v_span_t0\) \* 1000\)::numeric, 3\); -- @bust-money-span$/
        );
      }
    });

    it(`${fn}: no span sits inside a lock-acquiring block`, () => {
      const lane = instrumented.indexOf("DECLARE v_prior_lock_timeout text := current_setting('lock_timeout');");
      if (lane >= 0) {
        const end = instrumented.indexOf('  END;\n', lane);
        expect(instrumented.slice(lane, end)).not.toContain(MARK);
      }
    });
  }

  it('fn_collect_bounty is not re-created (its frozen uuid version check is never copied forward)', () => {
    expect(MIGRATION).not.toMatch(/CREATE OR REPLACE FUNCTION\s+public\.fn_collect_bounty\s*\(/);
    expect(MIGRATION).not.toContain('[1-5][0-9a-f]{3}-[89ab]');
  });

  it('nothing is written, locked or caught: no table, no helper, no subtransaction', () => {
    const marked = MIGRATION.split('\n').filter((line) => line.includes(MARK) && !line.startsWith('--'));
    for (const line of marked) {
      expect(line).not.toMatch(/\b(INSERT|UPDATE|DELETE|PERFORM|EXCEPTION|LOCK|SELECT)\b/);
    }
    expect(MIGRATION).not.toMatch(/CREATE TABLE|smarter_private\.fn_ca_bust_money_span/);
    expect(MIGRATION).not.toMatch(/\bREFERENCES\b/);
    expect(MIGRATION).not.toMatch(/@install-window/);
    expect(MIGRATION.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(MIGRATION.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('the held removal restores the exact production bodies and grants, and is not installable yet', () => {
    const held = resolve(__dirname, '../docs/audits/2026-11-14-bust-money-spans/pending-adoption');
    const name = '20261114200138_restore_bust_money_path_bodies.sql';
    const removal = readFileSync(resolve(held, name), 'utf8');
    expect(() => read(name)).toThrow();
    for (const [fn, source] of Object.entries(SOURCES)) {
      const restored = bodyOf(removal, fn);
      expect(restored).not.toContain(MARK);
      expect(createHash('md5').update(restored).digest('hex')).toBe(source.md5);
      expect(restored).toBe(bodyOf(read(source.file), fn));
    }
    const grantsOf = (sql: string) => sql.split('\n').filter((l) => /^(REVOKE|GRANT) /.test(l));
    expect(grantsOf(removal)).toEqual(grantsOf(MIGRATION));
  });
});
