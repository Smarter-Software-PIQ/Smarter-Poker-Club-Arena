/**
 * A BUST MONEY SPAN CHANGES NOTHING (2026-11-14, incident #3)
 *
 * 20261114190106 re-creates the knockout door (fn_claim_tournament_bounty_
 * elimination) and the bounty payer (fn_collect_bounty) with timing spans so
 * the ~0.65 s each spent on Midnight Free Buy b6d94533 can be located. The
 * instrumentation is admissible only if it cannot change a result, an error
 * path or the lock order:
 *
 *   - deleting every line marked `-- @bust-money-span` restores the exact body
 *     of the migration it replaces, byte for byte (the bodies production runs:
 *     prosrc md5 4ec5bce3... and bc621ffb...);
 *   - a span's PERFORM sets FOUND to true, so no statement after a span may
 *     read FOUND or ROW_COUNT before a statement that resets it;
 *   - the helper swallows every error in its own subtransaction, writes only
 *     inside its 48-hour window and row cap, and its log table has no foreign
 *     key to anything (CLAUDE.md DDL rule 7);
 *   - no span appears inside the lane's own lock block.
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
  },
  fn_collect_bounty: {
    file: '20260914133503_pko_heads_follow_accepted_knockout_dependencies.sql',
    md5: 'bc621ffbddfd931897706f6d1f099109',
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
      expect(instrumented.split(MARK).length - 1).toBe(6);
    });

    it(`${fn}: no span leaves FOUND or ROW_COUNT stale for a later statement`, () => {
      const lines = instrumented.split('\n');
      const resets = /^\s*(SELECT\b.*\bINTO\b|PERFORM\b|UPDATE\b|INSERT\b|DELETE\b|FOR\b|GET DIAGNOSTICS\b)/i;
      const reads = /\bFOUND\b|ROW_COUNT/;
      lines.forEach((line, i) => {
        if (!line.includes(MARK) || !line.includes('PERFORM')) return;
        // Walk forward statement by statement (joined lines up to ';').
        let statement = '';
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].includes(MARK)) continue;
          statement += ` ${lines[j]}`;
          if (!/;\s*(--.*)?$/.test(lines[j]) && !/\bTHEN\s*$|\bLOOP\s*$|\bBEGIN\s*$/.test(lines[j]))
            continue;
          const first = statement.trim();
          statement = '';
          if (reads.test(first) && !resets.test(first)) {
            throw new Error(`span at line ${i + 1} is followed by a FOUND/ROW_COUNT read: ${first}`);
          }
          if (resets.test(first) || /\bSELECT\b[\s\S]*\bINTO\b/i.test(first)) break;
        }
      });
    });

    it(`${fn}: no span sits inside a lock-acquiring block`, () => {
      const lane = instrumented.indexOf("DECLARE v_prior_lock_timeout text := current_setting('lock_timeout');");
      if (lane >= 0) {
        const end = instrumented.indexOf('  END;\n', lane);
        expect(instrumented.slice(lane, end)).not.toContain(MARK);
      }
    });
  }

  it('the helper only observes: errors swallowed, bounded, no foreign key, no public grant', () => {
    const helper = MIGRATION.slice(
      MIGRATION.indexOf('CREATE OR REPLACE FUNCTION smarter_private.fn_ca_bust_money_span('),
      MIGRATION.indexOf('$span$;') + 7
    );
    expect(helper).toMatch(/EXCEPTION WHEN OTHERS THEN\s+NULL;/);
    expect(helper).toContain('c.enabled_until > clock_timestamp()');
    expect(helper).toContain('< c.row_cap');
    expect(MIGRATION).toContain("now() + interval '48 hours'");
    expect(MIGRATION).not.toMatch(/\bREFERENCES\b/);
    expect(MIGRATION).toMatch(/REVOKE ALL ON FUNCTION smarter_private\.fn_ca_bust_money_span/);
    expect(MIGRATION).not.toMatch(/@install-window/);
    expect(MIGRATION.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(MIGRATION.match(/^COMMIT;$/gm)).toHaveLength(1);
  });
});
