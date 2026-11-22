/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAW - FULL-RING FEEDER STARTS AND OPENING FEEDERS HONOUR THE HOURLY CAP
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ClusterFeedersAbandoned fired continuously on 2026-11-21 (195 abandoned vs
 * 191 opened vs 0 feeder_live in 6 hours) despite 20261118165301:
 *   1. Full-ring feeder starts were left unguarded by fn_cash_hourly_feeder_admissible,
 *      but fn_cash_hourly_table_admit refuses horse moves onto a newly opened
 *      empty feeder at table_cap (releases_source = false), cancelling both bump
 *      moves as destination_refused and abandoning the feeder 6 minutes later in
 *      an infinite 8-minute loop.
 *   2. fn_cash_hourly_table_capacity_census() counts only occupied tables, so
 *      when one slot opened under table_cap, every waiting cluster game in the
 *      same tick pass opened an empty feeder simultaneously.
 *
 * Migration 20261121174545 guards the full-ring feeder start branch in both
 * cluster ticks with fn_cash_hourly_feeder_admissible(g.id) and counts empty
 * active 'opening' cash feeders in fn_cash_hourly_feeder_admissible so at most
 * (table_cap - occupied) feeders can be opening at once.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus, migrationNames, migrationText } from './helpers/migrationCorpus';

const NAME = migrationNames()
  .filter((n) => n.endsWith('_full_ring_feeder_and_opening_count_honour_hourly_cap.sql'))
  .at(-1);
if (!NAME) throw new Error('the full-ring feeder & opening count migration is missing');
const MIG = migrationText(NAME);
const VERSION = NAME.slice(0, 14);

const between = (s: string, a: string, b: string): string => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`window ${a} .. ${b} not found`);
  return s.slice(i + a.length, j);
};

const HELPER = between(
  MIG,
  'CREATE OR REPLACE FUNCTION public.fn_cash_hourly_feeder_admissible(p_game uuid)',
  '$f$;'
);

describe('full-ring feeder starts and opening feeders honour the hourly cap', () => {
  it('pins both cluster ticks to the 20261118165301 postimages and guards the full-ring branch', () => {
    expect(MIG).toContain(
      "'public.fn_cash_cluster_tick(uuid,integer)',\n  'a1e1e261b69a11d52675c490b1c51c25'"
    );
    expect(MIG).toContain(
      "'public.fn_cash_cluster_tick_uncapped(uuid,integer)',\n  'edbd9c20231d5056dfe71f4a9ac19e28'"
    );
    const n1 = between(MIG, '$n1$', '$n1$');
    expect(n1).toContain('ELSIF v_full_ring AND NOT v_classic AND v_live_tables = 1');
    expect(n1).toContain('FULL-RING FEEDER HONOURS HOURLY CAP');
    expect(n1).toContain('AND public.fn_cash_hourly_feeder_admissible(g.id) THEN');
  });

  it('counts empty active opening cash feeders against table_cap while never gating humans', () => {
    expect(HELPER).toContain('NOT public.fn_cash_hourly_table_enabled()');
    expect(HELPER).toContain('FROM public.fn_cash_hourly_table_capacity_census()');
    expect(HELPER).toContain("tb.role = 'feeder'");
    expect(HELPER).toContain("tb.lifecycle = 'opening'");
    expect(HELPER).toContain('NOT EXISTS (');
    expect(HELPER).toContain('ts.table_id = tb.id AND ts.left_at IS NULL');
    expect(HELPER).toContain('< (SELECT r.table_cap FROM public.fn_cash_hourly_table_range() r)');
    expect(HELPER).toContain("p.scope = 'floor' AND p.next_open_at > clock_timestamp()");
    expect(HELPER).toMatch(
      /w\.status IN \('waiting', 'notified'\)\s+AND NOT coalesce\(pr\.is_horse, false\)/
    );
    expect(HELPER).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(MIG).toContain(
      'REVOKE ALL ON FUNCTION public.fn_cash_hourly_feeder_admissible(uuid) FROM PUBLIC, anon, authenticated;'
    );
    expect(MIG).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_cash_hourly_feeder_admissible(uuid) TO service_role;'
    );
  });

  it('no later migration drops the opening-feeder count or full-ring hourly cap gate', () => {
    for (const m of migrationCorpus()) {
      if (m.name.slice(0, 14) <= VERSION) continue;
      if (/FUNCTION\s+public\.fn_cash_hourly_feeder_admissible\s*\(/i.test(m.sql)) {
        expect(m.sql, m.name).toContain("lifecycle = 'opening'");
        expect(m.sql, m.name).toContain('fn_cash_hourly_table_capacity_census()');
      }
      if (
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_cash_cluster_tick(_uncapped)?\s*\(/i.test(
          m.sql
        )
      ) {
        expect(m.sql, m.name).toContain('fn_cash_hourly_feeder_admissible(g.id)');
      }
    }
  });
});
