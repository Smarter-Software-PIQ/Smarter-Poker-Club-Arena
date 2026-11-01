/**
 * AN INERT LEAGUE MATCHUP IS RETIRED WITH A REASON OR REPOINTED (2026-10-31)
 *
 * The 2026-10-30 daily horse audit (league_matchup_inert) found five cards that
 * returned exactly 0.00 over 12,000 hands - 0 of 6,000 pairs diverged - and
 * could not evaluate v16_ratio_rescale's default rule because the matchup was
 * on no card and wrote no row. The fix per card:
 *
 *  - plo4/plo5_v55_river_trips_flat (default OFF, not live): the flag still
 *    reaches code, but since the 2026-10-26 river changes the league never
 *    deals the spot. Retired into UNMEASURABLE_MATCHUPS with PLO6 and the
 *    three older retirees, so each run writes a refused row the audit reads.
 *  - v53_pressure (live in production): hold'em V53 engages only on a read
 *    credibly outside the horse envelope, which no mirror produces. Repointed
 *    at the V53 aggressor field.
 *  - v18_self_image and v23_river_reads (live, fire in the league sandbox,
 *    rarely flip a decision): 24,000 pairs so a night cannot come up empty by
 *    chance.
 */
import { describe, expect, it } from 'vitest';
import {
  LEAGUE_MATCHUPS,
  UNMEASURABLE_MATCHUPS,
  V53_PRESSURE_POPULATION_ID,
  leagueFieldVariants,
  refusedLeagueRows,
  runMatchup,
} from './HorseLeague.js';
import { horseLeagueComputeResponseIsValid } from './HorseLeagueComputeWorkerClient.js';
import { V53_PRESSURE_POPULATION_ID as WORKLOAD_ID } from './V53PressurePopulation.js';

describe('UNMEASURABLE_MATCHUPS', () => {
  const names = UNMEASURABLE_MATCHUPS.map((m) => m.name);

  it('carries every retired matchup, and none of them is also on the card', () => {
    expect(names.sort()).toEqual(
      [
        'plo4_v55_river_trips_flat',
        'plo5_v55_river_trips_flat',
        'plo6_v55_river_trips_flat',
        'v16_ratio_rescale',
        'v18_exploit_size',
        'v31_gto_suit_aware',
      ].sort()
    );
    const card = new Set(LEAGUE_MATCHUPS.map((m) => m.name));
    for (const n of names) expect(card.has(n), `${n} is on the card and refused`).toBe(false);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every refusal says why, what was measured, and what would change it', () => {
    for (const m of UNMEASURABLE_MATCHUPS) {
      expect(m.reason.length, m.name).toBeGreaterThan(400);
      expect(m.reason, m.name).toContain('What would change this');
      expect(m.reason, m.name).toMatch(/\d of [\d,]+ pairs/);
    }
  });

  it('v16_ratio_rescale states its default and why its default rule cannot be evaluated', () => {
    const v16 = UNMEASURABLE_MATCHUPS.find((m) => m.name === 'v16_ratio_rescale')!;
    expect(v16.a).toEqual({ v16Ratio: true });
    expect(v16.b).toEqual({});
    expect(v16.reason).toContain('DEFAULT OFF');
    expect(v16.reason).toContain('default-ON rule');
    expect(v16.reason).toContain('cannot be evaluated');
  });

  it('writes rows the table accepts: refused, nothing dealt, reason present, the arms recorded', () => {
    const rows = refusedLeagueRows('2026-10-31');
    expect(rows.map((r) => r.matchup)).toEqual(UNMEASURABLE_MATCHUPS.map((m) => m.name));
    for (const r of rows) {
      // horse_league_results_refused_dealt_nothing_chk and _reason_present_chk.
      expect(r).toMatchObject({
        run_date: '2026-10-31',
        status: 'refused',
        hands: 0,
        bb100: 0,
        stderr: 0,
        duration_ms: 0,
      });
      expect(r.refusal_reason.trim().length).toBeGreaterThan(0);
      const u = UNMEASURABLE_MATCHUPS.find((m) => m.name === r.matchup)!;
      expect(r.config_a).toEqual(u.a);
      expect(r.config_b).toEqual(u.b);
    }
  });
});

describe('v53_pressure is dealt against the opponent it is built for', () => {
  const card = LEAGUE_MATCHUPS.find((m) => m.name === 'v53_pressure')!;

  it('keeps its name and sign and seats the V53 aggressor field', () => {
    expect(card.a).toEqual({});
    expect(card.b).toEqual({ v53Pressure: false });
    expect(card.opponentPopulation).toBe(V53_PRESSURE_POPULATION_ID);
    expect(WORKLOAD_ID).toBe(V53_PRESSURE_POPULATION_ID);
    expect(leagueFieldVariants(V53_PRESSURE_POPULATION_ID)).toEqual(['nlh']);
    expect(card.variant ?? 'nlh').toBe('nlh');
  });

  it('its arms diverge, and the worker boundary accepts the result', async () => {
    // Measured 2026-10-31: 63 of 2,000 pairs diverged at seed 4242 (48 at
    // 20261031); the mirror it replaced diverged in 0 of 6,000 every night.
    const r = await runMatchup(card, 200, 4242);
    expect(r.hands).toBe(400);
    expect(r.divergentPairs).toBeGreaterThan(0);
    expect(r.inert).toBe(false);
    expect(r.illegalActions).toBe(0);
    expect(r.opponentPopulation).toBe(V53_PRESSURE_POPULATION_ID);
    expect(Object.keys(r.humanResponses ?? {}).every((k) => k.startsWith('v53_field_'))).toBe(true);
    expect(horseLeagueComputeResponseIsValid({ type: 'MATCHUP_RESULT', jobId: 1, result: r })).toBe(
      true
    );
  }, 120_000);

  it('the field refuses a variant it is not qualified for', async () => {
    await expect(
      runMatchup({ ...card, name: 'plo4_field', variant: 'plo4' }, 2, 1)
    ).rejects.toThrow(/qualified for nlh only/);
  });
});

describe('v18_self_image and v23_river_reads buy the sample they need', () => {
  it.each(['v18_self_image', 'v23_river_reads'])('%s deals 24,000 mirror pairs', (name) => {
    const card = LEAGUE_MATCHUPS.find((m) => m.name === name)!;
    expect(card.pairs).toBe(24_000);
    expect(card.opponentPopulation).toBeUndefined();
    expect(card.a).toEqual({});
  });
});
