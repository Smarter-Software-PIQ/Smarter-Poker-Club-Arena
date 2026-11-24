/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAW - AN OWED MAIN STARTS BEFORE AN EXTRA TABLE (2026-11-24)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Short Deck, Pineapple, FLO8 and PLO8 cash dealt nothing from 2026-11-23
 * 08:43Z. The hourly cap was full of ten games' second to fourth tables; every
 * full game carried a Horse waiting list (#11773, which stays); and the
 * cluster tick, every five seconds, opened a waiting-list feeder whenever
 * fn_cash_hourly_feeder_admissible saw census + opening feeders < cap, so each
 * freed slot became another game's extra table before the fleet's thirty-second
 * walk could start a plan game that had none (#11346 lived only in the fleet).
 *
 * Migration 20261124072701 redefines fn_cash_hourly_feeder_admissible in full:
 * every question it asked, plus the owed starts the Horse fleet's newest fresh
 * heartbeat lists (detail.variety_owed_games, 90 s), other than this game,
 * enabled, and still with no occupied table, counted against the cap. An extra
 * table opens only if every owed start still fits after it. A person on the
 * line is never gated. Native proof (red on the installed body, green after):
 * scripts/ci/test-an-owed-main-starts-before-an-extra-table-postgres.py, run
 * by CI. Fleet side: server/src/services/anOwedMainStartsBeforeAnExtraTable.law.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationCorpus, migrationNames, migrationText } from './helpers/migrationCorpus';

const NAME = migrationNames()
  .filter((n) => n.endsWith('_an_owed_main_starts_before_an_extra_table.sql'))
  .at(-1);
if (!NAME) throw new Error('the owed-main migration is missing');
const MIG = migrationText(NAME);
const VERSION = NAME.slice(0, 14);
const ROOT = join(__dirname, '..');

const between = (s: string, a: string, b: string): string => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`window ${a} .. ${b} not found`);
  return s.slice(i + a.length, j);
};
const BODY = between(
  MIG,
  'CREATE OR REPLACE FUNCTION public.fn_cash_hourly_feeder_admissible(p_game uuid)',
  '$f$;'
);

describe('an owed Main 1 starts before an extra table', () => {
  it('replaces the exact installed body, and only that', () => {
    expect(MIG).toContain("IS DISTINCT FROM 'a7f507e81cdf5e6005ae94405481a8e6'");
    expect(MIG).toContain('owed_main_preimage_changed');
    expect(MIG.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/gi)).toHaveLength(1);
    expect(MIG).not.toMatch(/\b(ALTER|DROP)\s+(TABLE|FUNCTION)\b/i);
    expect(BODY).toContain('LANGUAGE sql STABLE SECURITY DEFINER');
    expect(BODY).toContain("SET search_path TO 'pg_catalog', 'public', 'pg_temp'");
    expect(BODY).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(MIG).toContain(
      'REVOKE ALL ON FUNCTION public.fn_cash_hourly_feeder_admissible(uuid) FROM PUBLIC, anon, authenticated;'
    );
    expect(MIG).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_cash_hourly_feeder_admissible(uuid) TO service_role;'
    );
    expect(MIG).toContain('-- @probe-for: public.fn_cash_hourly_feeder_admissible');
  });

  it('keeps every question the opener asked', () => {
    expect(BODY).toContain('NOT public.fn_cash_hourly_table_enabled()');
    expect(BODY).toContain('FROM public.fn_cash_hourly_table_capacity_census()');
    expect(BODY).toContain("tb.lifecycle = 'opening'");
    expect(BODY).toContain('< (SELECT r.table_cap FROM public.fn_cash_hourly_table_range() r)');
    expect(BODY).toContain("p.scope = 'floor' AND p.next_open_at > clock_timestamp()");
    expect(BODY).toMatch(
      /w\.status IN \('waiting', 'notified'\)\s+AND NOT coalesce\(pr\.is_horse, false\)/
    );
  });

  it('counts every owed start against the cap: listed, fresh, another game, enabled, no occupied table', () => {
    expect(BODY).toContain("h.detail -> 'variety_owed_games'");
    expect(BODY).toContain("h.beat_at > clock_timestamp() - interval '90 seconds'");
    expect(BODY).toContain('ORDER BY h.beat_at DESC');
    expect(BODY).toContain("jsonb_typeof(b.owed) = 'array'");
    expect(BODY).toContain('cg.id <> p_game');
    expect(BODY).toContain('coalesce(cg.enabled, false)');
    expect(BODY).toMatch(
      /NOT EXISTS \(\s+SELECT 1 FROM public\.tables tb\s+JOIN public\.table_seats ts/
    );
    expect(BODY).toContain('+ (SELECT o.n FROM owed o)');
    /* The person's branch stays outside the cap sum: a person is never gated. */
    const capSum = between(BODY, 'OR (', ') < (SELECT r.table_cap');
    expect(capSum).toContain('(SELECT o.n FROM owed o)');
    expect(BODY.indexOf('JOIN public.profiles pr')).toBeGreaterThan(
      BODY.indexOf('fn_cash_hourly_table_range()')
    );
  });

  it('is proved on PostgreSQL by CI', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain(
      'run: python3 -B scripts/ci/test-an-owed-main-starts-before-an-extra-table-postgres.py'
    );
  });

  it('no later migration rewrites the opener without the owed starts', () => {
    for (const m of migrationCorpus()) {
      if (m.name.slice(0, 14) <= VERSION) continue;
      if (/FUNCTION\s+public\.fn_cash_hourly_feeder_admissible\s*\(/i.test(m.sql)) {
        expect(m.sql, m.name).toContain('variety_owed_games');
        expect(m.sql, m.name).toContain('(SELECT o.n FROM owed o)');
      }
      expect(m.sql, m.name).not.toMatch(/DROP\s+FUNCTION[^;]*fn_cash_hourly_feeder_admissible/i);
    }
  });
});
