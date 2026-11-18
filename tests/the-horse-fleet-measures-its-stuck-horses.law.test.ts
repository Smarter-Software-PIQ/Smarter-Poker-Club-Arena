/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAW - THE HORSE FLEET MEASURES ITS STUCK HORSES, AND ONE FALLBACK CYCLE IS
 *        NOT A DEGRADED FLEET
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 2026-11-18: the daily digest said "Horse fleet degraded on 1 heartbeats;
 * stuck-horse count unavailable" and the reliability controller escalated it.
 *
 * 1. horses_stuck had NEVER been measured: every ca_horse_fleet_heartbeat row
 *    for 40+ days carried NULL, because HorseFleetManager sends it as null on
 *    purpose and nothing filled it. fn_ca_fleet_state_upsert now measures it
 *    from the ca_horse_fleet_state rows it has just written
 *    (fn_ca_horses_stuck_now: seated, silent for horse_stuck_minutes, while its
 *    own table dealt). A failed measurement stays NULL, never 0.
 * 2. A degraded beat only means one cycle ran on the built-in fleet policy
 *    defaults. The digest fired on ANY such beat (1 of 2,635). It now fires on
 *    a run of horse_degraded_run consecutive fallback cycles.
 *
 * Migration 20261118165140_the_horse_fleet_measures_its_stuck_horses.sql. This
 * law also binds every later rewrite of the three functions.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationCorpus, migrationNames, migrationText } from './helpers/migrationCorpus';

const NAME = migrationNames()
  .filter((n) => n.endsWith('_the_horse_fleet_measures_its_stuck_horses.sql'))
  .at(-1);
if (!NAME) throw new Error('the stuck-horse measurement migration is missing');
const MIG = migrationText(NAME);
const VERSION = NAME.slice(0, 14);
const FLEET = readFileSync(
  resolve(__dirname, '..', 'server/src/services/HorseFleetManager.ts'),
  'utf8'
);

const between = (s: string, a: string, b: string): string => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`window ${a} .. ${b} not found`);
  return s.slice(i, j);
};

describe('the horse fleet measures its stuck horses', () => {
  it('pins all three functions by preimage and postimage', () => {
    expect(MIG).toContain(
      "'public.fn_ca_fleet_state_upsert(jsonb,jsonb)',\n  'a9949cbfaba3ab6f13c660c1d81561ea', 'b3b7429972a836c072e0f212b6303766'"
    );
    expect(MIG).toContain(
      "'public.fn_sp_daily_metrics_compute(date)',\n  'cf92a94803102ccc48e77192e38bfa17', 'd28b32a8562f5b24035f7fc0d1323326'"
    );
    expect(MIG).toContain(
      "'public.fn_sp_digest_attention(date,jsonb)',\n  'a95a3c6f8a5c4230c9a190ea38b1dede', '37787e6b6afcf24e0289741858ebb855'"
    );
    expect(MIG).toMatch(/already the postimage, nothing to do/);
  });

  const STUCK = between(MIG, 'CREATE OR REPLACE FUNCTION public.fn_ca_horses_stuck_now()', '$f$;');

  it('reads the engine commit record, never the seat-touch stamp', () => {
    // Projection-blocked table (f02a6a5e, 2026-11-18): last_action_at froze at
    // 16:08-16:09 while 55 more hands committed with the same horses in every
    // one. The metric must measure the horse, not a stamp or a queue.
    const sqlOnly = STUCK.replace(/--[^\n]*/g, '');
    expect(sqlOnly).not.toContain('last_action_at');
    expect(sqlOnly).not.toContain('hand_projection_outbox');
    expect(STUCK).toContain('FROM public.hand_history h CROSS JOIN w');
    expect(STUCK).toContain('h.created_at > w.since');
    expect(STUCK).toContain('jsonb_array_elements(h.players) p');
    expect(STUCK).toContain('SELECT table_id FROM hands GROUP BY table_id HAVING count(*) >= 3');
    expect(STUCK).not.toMatch(/SECURITY DEFINER/);
    expect(MIG).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_horses_stuck_now() FROM PUBLIC, anon, authenticated;'
    );
  });

  it('never counts a horse that has just sat down, including one a seat move carried in', () => {
    // 30889b3b joined 17:00:19; bbbe8009 was moved into seat 6 after its
    // previous occupant left at 17:07:27, carrying joined_at 15:28:20 from its
    // source seat - so joined_at alone is not an arrival time.
    expect(STUCK).toContain('s.joined_at <= w.since');
    expect(STUCK).toMatch(
      /NOT EXISTS \(SELECT 1 FROM public\.ca_seat_stack_exits e\s+WHERE e\.occurred_at > w\.since\s+AND e\.table_id = s\.table_id AND e\.seat_number = s\.seat_number\)/
    );
    expect(STUCK).toMatch(
      /NOT EXISTS \(SELECT 1 FROM public\.cash_seat_moves m\s+WHERE m\.player_id = f\.horse_id AND m\.to_table_id = f\.table_id\s+AND m\.executed_at > w\.since\)/
    );
  });

  it('never counts a horse waiting for the big blind or sitting out', () => {
    // 6cf64a8a at 0f84a1ab: entry_hold 'waiting', not dealt in by rule.
    expect(STUCK).toContain("s.entry_hold IS DISTINCT FROM 'waiting'");
    expect(STUCK).toContain('NOT COALESCE(s.is_sitting_out, false)');
    expect(STUCK).toContain('s.left_at IS NULL');
  });

  it('counts a horse the table deals around, or one that only times out', () => {
    expect(STUCK).toMatch(
      /NOT EXISTS \(SELECT 1 FROM dealt d WHERE d\.table_id = s\.table_id AND d\.uid = s\.horse_id::text\)/
    );
    expect(STUCK).toContain("count(*) FILTER (WHERE a ->> 'origin' = 'timeout') AS timeouts");
    expect(STUCK).toContain('x.voluntary > 0 AND x.timeouts = x.voluntary');
    expect(STUCK).toContain("COALESCE(a ->> 'origin', '') <> 'forced'");
    expect(STUCK).toContain("public.fn_sp_setting('horse_stuck_minutes', 10)");
  });

  it('fills horses_stuck only when the engine sent none, isolated, unknown on failure', () => {
    const n2 = between(MIG, '$n2$', '$n2$,');
    expect(n2).toContain("if nullif(p_beat ->> 'horses_stuck', '') is null then");
    expect(n2).toMatch(
      /begin\s+v_stuck := public\.fn_ca_horses_stuck_now\(\);\s+exception when others then\s+v_stuck := null;/
    );
    const n3 = between(MIG, '$n3$', '$n3$]');
    expect(n3).toContain("coalesce(nullif(p_beat ->> 'horses_stuck', '')::int, v_stuck)");
    expect(n3).not.toMatch(/coalesce\([^)]*,\s*0\)/);
  });

  it('pages a run of fallback cycles, not one', () => {
    const n4 = between(MIG, '$n4$', '$n4$]');
    expect(n4).toContain("'max_degraded_run'");
    expect(n4).toContain(
      'count(*) FILTER (WHERE NOT COALESCE(degraded, false)) OVER (ORDER BY beat_at, id)'
    );
    const n5 = between(MIG, '$n5$', '$n5$]');
    expect(n5).toContain(
      "COALESCE((p_metrics#>>'{play,horse_fleet,max_degraded_run}')::numeric, v, 0) >= public.fn_sp_setting('horse_degraded_run',3)"
    );
    expect(n5).not.toContain('COALESCE(v,0) > 0 OR');
    expect(MIG).toContain("('horse_degraded_run', 3,");
    expect(MIG).toContain("('horse_stuck_minutes', 10,");
  });

  it('keeps the engine honest: it sends no invented stuck count', () => {
    // The engine still cannot measure it; the database does. If the engine
    // ever sends a number, it must be a measured one, never a literal zero.
    expect(FLEET).not.toMatch(/horses_stuck:\s*0\b/);
  });

  it('no later migration rewrites these functions without the measurement and the run rule', () => {
    for (const m of migrationCorpus()) {
      if (m.name.slice(0, 14) <= VERSION) continue;
      const sql = m.sql;
      if (
        /FUNCTION\s+public\.fn_ca_fleet_state_upsert\s*\(/i.test(sql) ||
        sql.includes("'public.fn_ca_fleet_state_upsert(jsonb,jsonb)'")
      ) {
        expect(sql, m.name).toContain('fn_ca_horses_stuck_now()');
      }
      if (
        /FUNCTION\s+public\.fn_sp_digest_attention\s*\(/i.test(sql) ||
        sql.includes("'public.fn_sp_digest_attention(date,jsonb)'")
      ) {
        expect(sql, m.name).toContain('max_degraded_run');
      }
      if (
        /FUNCTION\s+public\.fn_sp_daily_metrics_compute\s*\(/i.test(sql) ||
        sql.includes("'public.fn_sp_daily_metrics_compute(date)'")
      ) {
        expect(sql, m.name).toContain('max_degraded_run');
      }
      expect(sql, m.name).not.toMatch(/DROP\s+FUNCTION[^;]*fn_ca_horses_stuck_now/i);
    }
  });
});
