/**
 * A declared feature domain must admit the states the live engine actually
 * builds (2026-11-08). Before this, featureDomainMatches hashed the whole live
 * rake config (which the engine stamps with `cashPolicy`) against the published
 * pricing (which carries none), and refused any state with more than one live
 * pot layer (every decision facing an uncalled bet has two). Every live cash
 * decision was outside every declared domain while each test, built from the
 * published pricing with `pots: []`, admitted it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publishedCashPricing } from '../config/leagueCashPricing.js';
import { featureDomainMatches, type HorseFeatureDomain } from './HorseFeatureAuthority.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { calculatePots } from './PokerEngine.js';

const pricing = publishedCashPricing({
  tournament: false,
  variant: 'plo4',
  tableSeats: 6,
  seats: 2,
});
const domain = (seats: number): HorseFeatureDomain => ({
  variant: 'plo4',
  mode: 'cash',
  asset: 'chips',
  boardCount: 1,
  dealtSeats: [seats],
  remainingPlayers: [seats],
  effectiveStackBB: [20, 100],
  startingStackBB: 100,
  smallBlind: 1,
  bigBlind: 2,
  ante: 0,
  bigBlindAnte: false,
  bettingStructure: 'pot_limit',
  chipUnit: 0.01,
  ...pricing,
  sidePots: false,
});
/** The rake config exactly as ServerTableEngineDealing stamps a cash hand. */
const liveRake = (scope = 'standard') => ({
  cashPolicy: { version: 1, scope },
  ...pricing.rakeConfig,
});
type Seat = { invested: number; bet: number; allIn?: boolean; folded?: boolean };
function liveState(seats: Seat[], patch: Partial<HorseGameStateV2> = {}): HorseGameStateV2 {
  const players = seats.map((s, seat) => ({
    seat,
    user_id: `u${seat}`,
    stack: 200 - s.invested,
    bet: s.bet,
    totalInvested: s.invested,
    is_folded: s.folded === true,
    is_all_in: s.allIn === true,
  }));
  return {
    gameVariant: 'plo4',
    gameMode: 'cash',
    asset: 'chips',
    boardCount: 1,
    dealtSeatIds: players.map((p) => p.seat),
    players,
    smallBlind: 1,
    bigBlind: 2,
    ante: 0,
    bigBlindAnte: false,
    bettingStructure: 'pot_limit',
    chipUnit: 0.01,
    rakeConfig: liveRake(),
    bbjConfig: pricing.bbjConfig,
    // The engine's own layering (HandController.computeLivePots).
    pots: calculatePots(players as never),
    straddleActive: false,
    bombPot: false,
    allInOrFold: false,
    ...patch,
  } as unknown as HorseGameStateV2;
}

describe('a declared feature domain admits the live engine snapshot', () => {
  it('admits a heads-up river decision facing an uncalled bet, with the stamped rake', () => {
    const gs = liveState([
      { invested: 20, bet: 0 },
      { invested: 50, bet: 30 },
    ]);
    expect(gs.pots?.length).toBe(2);
    expect(featureDomainMatches(domain(2), gs)).toBe(true);
  });

  it('admits every cash rake scope whose numbers are the published ones', () => {
    for (const scope of ['standard', 'midway', 'standalone']) {
      const gs = liveState(
        [
          { invested: 20, bet: 0 },
          { invested: 20, bet: 0 },
        ],
        { rakeConfig: liveRake(scope) } as never
      );
      expect(featureDomainMatches(domain(2), gs)).toBe(true);
    }
  });

  it('admits a multiway bet and call that is still unmatched (no side pot)', () => {
    const gs = liveState([
      { invested: 20, bet: 0 },
      { invested: 50, bet: 30 },
      { invested: 50, bet: 30 },
    ]);
    expect(gs.pots?.length).toBe(2);
    expect(featureDomainMatches(domain(3), gs)).toBe(true);
  });

  it('admits facing an all-in heads-up (the jammer contests every layer, so no side pot)', () => {
    const gs = liveState([
      { invested: 20, bet: 0 },
      { invested: 200, bet: 180, allIn: true },
    ]);
    expect(gs.pots?.length).toBe(2);
    expect(featureDomainMatches(domain(2), gs)).toBe(true);
  });

  it('refuses a real side pot: a live all-in shut out of a layer two players contest', () => {
    const gs = liveState([
      { invested: 30, bet: 10, allIn: true },
      { invested: 50, bet: 30 },
      { invested: 50, bet: 30 },
    ]);
    expect(featureDomainMatches(domain(3), gs)).toBe(false);
    // Control: the same layers with nobody all in are a pending call, admitted.
    gs.players[0].is_all_in = false;
    expect(featureDomainMatches(domain(3), gs)).toBe(true);
  });

  it('refuses malformed or unlabelled layers, and an unknown rake policy label', () => {
    const base = liveState([
      { invested: 20, bet: 0 },
      { invested: 50, bet: 30 },
    ]);
    expect(
      featureDomainMatches(domain(2), { ...base, pots: [{ amount: 100 }, { amount: 50 }] } as never)
    ).toBe(false);
    expect(
      featureDomainMatches(domain(2), {
        ...base,
        pots: [{ amount: 40, eligiblePlayers: [] }, base.pots![1]],
      } as never)
    ).toBe(false);
    for (const cashPolicy of [
      { version: 2, scope: 'standard' },
      { version: 1, scope: 'other' },
      { version: 1, scope: 'standard', percent: 0 },
      null,
    ])
      expect(
        featureDomainMatches(domain(2), {
          ...base,
          rakeConfig: { ...pricing.rakeConfig, cashPolicy },
        } as never)
      ).toBe(false);
  });

  it('still refuses rake economics that differ from the declared pricing', () => {
    const gs = liveState(
      [
        { invested: 20, bet: 0 },
        { invested: 20, bet: 0 },
      ],
      { rakeConfig: { ...liveRake(), cap: pricing.rakeConfig.cap + 1 } } as never
    );
    expect(featureDomainMatches(domain(2), gs)).toBe(false);
  });

  it('every engine site stamps a cash policy label the domain predicate understands', () => {
    const sites = [
      'src/engine/ServerTableEngineDealing.ts',
      'src/engine/ServerTableEngineBase.ts',
      'src/lightning/LightningHandHost.ts',
    ];
    let stamps = 0;
    for (const f of sites) {
      const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
      for (const m of src.matchAll(/cashPolicy:\s*\{\s*version:\s*(\d+)\s*,\s*scope:/g)) {
        stamps++;
        expect(m[1], f).toBe('1');
      }
    }
    expect(stamps).toBeGreaterThanOrEqual(3);
  });
});
