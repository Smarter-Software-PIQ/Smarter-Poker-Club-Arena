/**
 * THE AGGRESSION FACTOR IS POSTFLOP ONLY (Dan 2026-11-04).
 *
 * (bets + raises) / calls on the flop, turn and river, as every poker tracker
 * defines it. The platform counted preflop calls against the player, which
 * is how a winning 34/17 regular came to read as passive. Pins migration
 * 20261104195454: the cold side table, the trigger that fills it, the
 * three-step fallback in the coverage reader, and the basis the payload
 * declares; and the client label that names the basis.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const sql = read('supabase/migrations/20261104195454_aggression_factor_is_postflop_only.sql');

describe('the aggression factor is postflop only', () => {
  it('records the postflop pair in a cold side table with no foreign key to a live table', () => {
    expect(sql).toContain('CREATE TABLE public.ca_hand_postflop_aggression (');
    expect(sql).toContain('PRIMARY KEY (hand_id, user_id)');
    expect(sql).not.toMatch(/REFERENCES\s+public\.(ca_hand_facts|hand_history)/);
    expect(sql).not.toMatch(/ALTER TABLE public\.ca_hand_facts/);
    expect(sql).not.toContain('@install-window');
    expect(
      sql.match(/CREATE OR REPLACE FUNCTION public\.ca_player_stats_overview_\w+_by_club/g)?.length
    ).toBe(2);
    expect(
      sql.match(
        /'aggression_factor_basis', \(SELECT m->>'aggression_factor_basis' FROM recorded_coverage\),/g
      )?.length
    ).toBe(2);
  });

  it('counts only the flop, turn and river', () => {
    const fn = sql.slice(sql.indexOf('ca_fact_postflop_aggression_counts('));
    expect(fn.match(/stage<>'preflop'/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('the insert trigger fills the side table and keeps writing the legacy pair', () => {
    const trg = sql.slice(sql.indexOf('ca_capture_fact_aggression_counts()'));
    expect(trg).toContain(
      'INSERT INTO public.ca_hand_postflop_aggression(hand_id,user_id,bet_raise_actions,call_actions)'
    );
    expect(trg).toContain('ON CONFLICT(hand_id,user_id) DO NOTHING');
    expect(trg).toContain("NEW.af_bet_raise_actions:=(v_counts->>'bets_raises')::smallint;");
  });

  it('the coverage reader prefers the side table, then the hand record, then the legacy pair', () => {
    const cov = sql.slice(sql.indexOf('ca_player_recorded_hand_coverage('));
    const side = cov.indexOf('CASE WHEN pf.hand_id IS NOT NULL');
    const recompute = cov.indexOf(
      'coalesce(public.ca_fact_postflop_aggression_counts(h.actions,p_user,h.big_blind)'
    );
    const legacy = cov.indexOf("THEN jsonb_build_object('bets_raises',r.bets,'calls',r.calls)");
    expect(side).toBeGreaterThan(0);
    expect(recompute).toBeGreaterThan(side);
    expect(legacy).toBeGreaterThan(recompute);
    expect(cov).toContain("'aggression_factor_basis','postflop'");
    expect(cov).toContain(
      'LEFT JOIN public.ca_hand_postflop_aggression pf ON pf.hand_id=r.hand_id AND pf.user_id=p_user'
    );
  });

  it('every stats tab labels the number by its basis', () => {
    for (const f of [
      'src/pages/stats/OverviewTab.tsx',
      'src/pages/stats/PerformanceTab.tsx',
      'src/pages/stats/TournamentPlayingStats.tsx',
    ]) {
      expect(read(f)).toContain('label={aggressionFactorLabel(overall.aggression_factor_basis)}');
      expect(read(f)).not.toContain('label="Aggression Factor"');
    }
  });
});
