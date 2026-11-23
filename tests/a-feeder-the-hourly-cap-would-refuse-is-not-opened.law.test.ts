/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAW - A FEEDER THE HOURLY CAP WOULD REFUSE IS NOT OPENED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ClusterFeedersAbandoned fired 25 times from 2026-11-17. In six hours the
 * cluster ticks opened 152 feeders: 10 went live and 142 were abandoned, each
 * held its full 360 s with nobody seated. The hourly cash policy (#11118)
 * admits horses at a new, empty table only while the floor is under its table
 * cap and no floor pacing hold is active; the floor sat at 16 of 16, so every
 * new feeder read allowed=false, the engine seated nobody and answered no seat
 * call there, and the feeder was abandoned - then reopened two minutes later by
 * ticks that never asked the policy.
 *
 * Migration 20261118165301 gives the opener the admission's own question
 * (fn_cash_hourly_feeder_admissible) and both ticks ask it before opening a
 * buyer-driven feeder. A person on the line still opens one: the hourly policy
 * gates horse seating only.
 *
 * Bound forward: a later tick rewrite keeps the gate, and a later admission
 * rewrite keeps the new-table branch the helper mirrors (or changes both).
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus, migrationNames, migrationText } from './helpers/migrationCorpus';

const NAME = migrationNames()
  .filter((n) => n.endsWith('_a_feeder_the_hourly_cap_would_refuse_is_not_opened.sql'))
  .at(-1);
if (!NAME) throw new Error('the feeder admission migration is missing');
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

describe('a feeder the hourly cap would refuse is not opened', () => {
  it('pins both ticks by preimage and postimage, as twins', () => {
    expect(MIG).toContain(
      "'public.fn_cash_cluster_tick(uuid,integer)',\n  '3a88f6b1cbdcc425b5049b8f7800d00a', 'a1e1e261b69a11d52675c490b1c51c25'"
    );
    expect(MIG).toContain(
      "'public.fn_cash_cluster_tick_uncapped(uuid,integer)',\n  '6058aeeb6b9f78f286e8ad35c5356218', 'edbd9c20231d5056dfe71f4a9ac19e28'"
    );
    expect(MIG).toContain('IF md5(v_def) = p_after THEN');
  });

  it('opens a buyer-driven feeder only when the hourly policy would admit it', () => {
    const n1 = between(MIG, 'ARRAY[$n1$', '$n1$]');
    expect(n1).toContain('ELSIF (v_buyers >= 2 OR v_plo_startup)');
    expect(n1).toContain('AND public.fn_cash_hourly_feeder_admissible(g.id) THEN');
    expect(between(MIG, 'ARRAY[$o1$', '$o1$]')).toBe(
      '    ELSIF v_buyers >= 2 OR v_plo_startup THEN\n'
    );
  });

  it('asks exactly the admission new-table question, and never gates a person', () => {
    expect(HELPER).toContain('NOT public.fn_cash_hourly_table_enabled()');
    expect(HELPER).toContain('FROM public.fn_cash_hourly_table_capacity_census()');
    expect(HELPER).toContain('< (SELECT r.table_cap FROM public.fn_cash_hourly_table_range() r)');
    expect(HELPER).toContain("p.scope = 'floor' AND p.next_open_at > clock_timestamp()");
    expect(HELPER).toMatch(
      /w\.status IN \('waiting', 'notified'\)\s+AND NOT coalesce\(pr\.is_horse, false\)/
    );
    expect(HELPER).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(MIG).toContain(
      'REVOKE ALL ON FUNCTION public.fn_cash_hourly_feeder_admissible(uuid) FROM PUBLIC, anon, authenticated;'
    );
  });

  it('the admission the helper mirrors still asks the same new-table question', () => {
    const defs = migrationCorpus().filter((m) =>
      /FUNCTION\s+public\.fn_cash_hourly_table_admissions\s*\(/i.test(m.sql)
    );
    const latest = defs.at(-1);
    expect(latest, 'fn_cash_hourly_table_admissions has a defining migration').toBeTruthy();
    // 20261123013241 made the admission count the empty opening feeders the
    // opener already counted (less the table's own), so the two ask the SAME
    // new-table question with the same reservations.
    expect(latest!.sql).toMatch(
      /CASE WHEN f\.table_id IS NULL\s+THEN b\.occupied\+b\.reserved-CASE WHEN EXISTS\(SELECT 1 FROM opening o WHERE o\.id=t\.id\) THEN 1 ELSE 0 END<b\.cap/
    );
    expect(latest!.sql).toMatch(/scope='floor' AND next_open_at>clock_timestamp\(\)/);
  });

  it('no later migration rewrites a tick or the helper without the gate', () => {
    for (const m of migrationCorpus()) {
      if (m.name.slice(0, 14) <= VERSION) continue;
      if (
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_cash_cluster_tick(_uncapped)?\s*\(/i.test(
          m.sql
        )
      )
        expect(m.sql, m.name).toContain('fn_cash_hourly_feeder_admissible(g.id)');
      if (/FUNCTION\s+public\.fn_cash_hourly_feeder_admissible\s*\(/i.test(m.sql))
        expect(m.sql, m.name).toContain('fn_cash_hourly_table_capacity_census()');
      expect(m.sql, m.name).not.toMatch(/DROP\s+FUNCTION[^;]*fn_cash_hourly_feeder_admissible/i);
    }
  });
});
