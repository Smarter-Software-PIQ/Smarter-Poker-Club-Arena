/**
 * LAW: PLAYER-FELT LATENCY IS RECORDED HOURLY (owner, 2026-11-19 17:26 Chicago).
 *
 * One number per table for what players feel: the last player action of a
 * hand to the next deal, p50/p95 per table and per kind (cash, tournament,
 * Lightning), recorded every hour into smarter_private.ca_felt_latency_hourly
 * and reported in the Daily Operations Digest under 'felt_latency'. Intended
 * waits (idle tables, maintenance breaks, tournament breaks, hand-for-hand,
 * cash rebuy windows) are excluded, never graded.
 *
 * Measured on production 2026-11-19 18:00 Chicago (the computation as a plain
 * read): cash p50 3,357 ms / p95 6,262 ms over 1,277 pairs, tournament
 * 3,656 / 17,429 ms over 5,562, Lightning 2,365 / 16,329 ms over 917, in 3.5 s.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'supabase/migrations');
const FILE = '20261120000047_player_felt_latency_is_recorded_hourly.sql';
const MIG = readFileSync(resolve(DIR, FILE), 'utf8');
const code = MIG.replace(/^\s*--.*$/gm, '');

describe('player-felt latency is recorded hourly', () => {
  it('measures from the last player action of a hand to the next deal, bounded to the hand', () => {
    expect(code).toContain("WHERE a ? 'userId' AND NOT a ? 'historyEvent'");
    expect(code).toContain("(a->>'action') IS DISTINCT FROM 'return'");
    expect(code).toMatch(
      /s\.next_start - LEAST\(s\.ended_at, GREATEST\(COALESCE\(s\.prev_start, s\.ended_at\),/
    );
  });

  it('reads only index-bounded rows: one hour of next hands and one previous hand each', () => {
    expect(code).toContain('WHERE n.created_at >= $1 AND n.created_at < $2');
    expect(code).toContain("AND hh.created_at >= nx.created_at - interval '30 minutes'");
    expect(code).toMatch(/ORDER BY hh\.created_at DESC\s+LIMIT 1\) p/);
    expect(code).toContain("p_to - p_from > interval '2 hours'");
  });

  it('splits cash, tournament and Lightning', () => {
    expect(code).toContain("lh.hand_history_id IN (s.next_id, s.prev_id)) THEN 'lightning'");
    expect(code).toContain("WHEN s.tournament_id IS NOT NULL THEN 'tournament'");
    expect(code).toContain("CHECK (kind IN ('cash', 'tournament', 'lightning'))");
  });

  it('excludes every intended wait and reads hand-for-hand only when its table exists', () => {
    for (const reason of ['idle', 'maintenance', 'break', 'rebuy_window']) {
      expect(code).toContain(`THEN '${reason}'`);
    }
    expect(code).toContain("THEN ''hand_for_hand''");
    expect(code).toContain(
      "v_h4h_rel regclass := to_regclass('public.ca_tournament_hand_for_hand');"
    );
    expect(code).toContain('IF v_h4h_rel IS NOT NULL THEN');
    expect(code).toContain("WHEN s.next_start - s.ended_at >= interval '60 seconds' THEN 'idle'");
  });

  it('records p50, p95 and max per table and per kind, with an exact-percentile histogram per kind', () => {
    expect(code).toContain('percentile_cont(0.5) WITHIN GROUP (ORDER BY r.felt_ms)');
    expect(code).toContain('percentile_cont(0.95) WITHIN GROUP (ORDER BY r.felt_ms)');
    expect(code).toContain('generate_series(0, 240)');
    expect(code).toContain('LEAST(r.felt_ms / 250, 240)');
    expect(code).toContain(
      'DELETE FROM smarter_private.ca_felt_latency_hourly WHERE hour_start = v_from;'
    );
  });

  it('runs hourly at minute 8 with its own timeout, and no other migration schedules minute 8 hourly', () => {
    expect(code).toContain("PERFORM cron.schedule('ca-felt-latency-hourly', '8 * * * *',");
    expect(code).toContain(
      "SET statement_timeout = '120s'; select public.fn_ca_felt_latency_record();"
    );
    expect(MIG).toMatch(/^-- periodic-work: \S.+$/m);
    const others = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql') && f !== FILE)
      .filter((f) =>
        /cron\.schedule\([^)]*'8 \* \* \* \*'/.test(readFileSync(resolve(DIR, f), 'utf8'))
      );
    expect(others).toEqual([]);
  });

  it('adds one line to the daily digest by an anchored edit that must match once', () => {
    expect(code).toContain("''felt_latency'', public.fn_sp_digest_felt_latency(v_day),");
    expect(code).toContain("''engine_cutover'', public.fn_sp_digest_engine_cutover(v_day),\\n");
    expect(code).toContain('FELT_LATENCY_DIGEST_ANCHOR');
    expect(code).toContain("'hours_recorded'");
    expect(code).toContain("'slowest_table'");
  });

  it('is service_role only and proves every function before commit', () => {
    for (const sig of [
      'public.fn_ca_felt_latency(timestamptz, timestamptz)',
      'public.fn_ca_felt_latency_record(timestamptz)',
      'public.fn_sp_digest_felt_latency(date)',
    ]) {
      expect(code).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated;`);
      expect(code).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
    }
    expect(code).toContain(
      'REVOKE ALL ON TABLE smarter_private.ca_felt_latency_hourly FROM PUBLIC, anon, authenticated;'
    );
    expect(MIG).toContain('-- @probe-for: public.fn_ca_felt_latency\n');
    expect(MIG).toContain('-- @probe-for: public.fn_ca_felt_latency_record\n');
    expect(MIG).toContain('-- @probe-for: public.fn_sp_daily_digest\n');
    expect(code).toContain("NOT v_digest ? 'felt_latency'");
    expect(code).toContain("RAISE EXCEPTION 'probe-unwind';");
    expect(code).toMatch(/^BEGIN;\s+SET LOCAL lock_timeout = '4s';/m);
    expect(code.trim().endsWith('COMMIT;')).toBe(true);
  });
});
