/**
 * LAW: omahaBigBetSizeIsPriced (default OFF, PLO4/PLO5 cash only, identity-free, HUD-driven)
 * replaces #18 (omahaBigBetIsPotShare) without any 20 BB chip cliff, discrete 0.70 pot-share step,
 * or unconditional limped-pot bet floor.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, CardRank, CardSuit, HorseDecision, SeatPlayer } from '../types.js';
import { seedFastRandom } from './HorseEval.js';
import type { OppPostflopRead } from './HorseEval.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  applyOmahaBigBetSizeRange,
  omahaBigBetSizeScope,
  omahaPricedBigBetStrength,
  omahaPricedLimpedPotSize,
  priceBetSizeEv,
} from './HorseOmahaBigBetSizeIsPriced.js';
import {
  clearDecisionHud,
  installDecisionHud,
  type OpponentHudPacket,
} from './opponentHud/OpponentHud.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { OPTION_SWITCH_RELEASE_DEFAULT_OFF } from './HorseOptionSwitch.js';
import { OMAHA_OPTION_GAME_SCOPE_OPTIONS } from './HorseOmahaOptionGameScope.js';
import { OMAHA_OPTION_CLASSES } from './HorseOmahaRuleSites.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((t) => ({
    rank: (t[0] === 'T' ? '10' : t[0]) as CardRank,
    suit: SUIT[t[1]!]!,
  }));

const HERO = '86000001-0000-4000-8000-0000000000a1';
const VILLAIN = '40000000-0000-4000-8000-0000000000b2';

afterEach(() => {
  clearDecisionHud();
  HorseMind.reset();
});

function makeHudPacket(
  family: 'plo4' | 'plo5',
  oppStats: Record<string, [number, number]>
): OpponentHudPacket {
  return {
    v: 1,
    family,
    pv: 1,
    pri: {
      'sd.strongBig.r': [0.76, 20],
      'sd.strong.r': [0.72, 20],
      'r.betCk': [0.34, 20],
      'sd.strongBig.t': [0.72, 20],
      'sd.strong.t': [0.68, 20],
      't.betCk': [0.36, 20],
      'r.fb.sm.hu': [0.28, 20],
      'r.fb.bg.hu': [0.48, 20],
      'r.rBet.hu': [0.1, 20],
    },
    opp: {
      [VILLAIN]: {
        hands: 200,
        eff: oppStats,
        rc: {},
      },
    },
  };
}

function buildLimpedRiverSpot(
  overrides: Partial<HorseGameStateV2> & {
    heroCards?: string;
    villainCards?: string;
    villainIsHorse?: boolean;
    gameVariant?: string;
  } = {}
): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const heroHole = cards(overrides.heroCards ?? 'AsKsAdKd');
  const villainHole = overrides.villainCards ? cards(overrides.villainCards) : [];
  const villainIsHorse = overrides.villainIsHorse === true;
  const players: SeatPlayer[] = [
    {
      seat: 1,
      user_id: HERO,
      username: 'Hero',
      stack: 200,
      bet: 0,
      totalInvested: 6,
      cards: heroHole,
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer,
    {
      seat: 2,
      user_id: VILLAIN,
      username: 'Villain',
      stack: 200,
      bet: 0,
      totalInvested: 6,
      cards: villainHole,
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: villainIsHorse,
    } as SeatPlayer,
  ];
  const gs = {
    players,
    communityCards: cards('AhKh2c7d9s'),
    pot: 12,
    currentBet: 0,
    toCall: 0,
    minRaise: 2,
    minRaiseTo: 2,
    maxRaiseTo: 12,
    legalActions: ['check', 'bet', 'all_in'],
    stage: 'river',
    gameVariant: overrides.gameVariant ?? 'plo4',
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: 2,
    humanUserIds: villainIsHorse ? [] : [VILLAIN],
    gameMode: 'cash',
    publicMemoryDomain: { speed: 'table' },
    actionHistory: [],
    ...overrides,
  } as unknown as HorseGameStateV2;
  return { hero: players[0]!, gs };
}

describe('LAW: omahaBigBetSizeIsPriced replaces #18 omahaBigBetIsPotShare with continuous pot-share + lifetime HUD pricing', () => {
  it('is properly registered default OFF, game-scopable, priced in RuleSites, with zero person-vs-Horse key in source', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain('omahaBigBetSizeIsPriced');
    expect(OMAHA_OPTION_GAME_SCOPE_OPTIONS).toContain('omahaBigBetSizeIsPriced');
    expect(OMAHA_OPTION_CLASSES.omahaBigBetSizeIsPriced?.cls).toBe('priced');
    expect(
      HORSE_DATA_LEDGER.some((e) => e.kind === 'flag' && e.key === 'omahaBigBetSizeIsPriced')
    ).toBe(true);
    for (const r of [
      'omaha_priced_big_bet_size_range_applied',
      'omaha_priced_big_bet_size_resized',
      'omaha_priced_big_bet_size_kept',
    ]) {
      expect(
        HORSE_DATA_LEDGER.some((e) => e.kind === 'receipt' && e.key === r),
        r
      ).toBe(true);
    }
    const src = readFileSync(join(__dirname, 'HorseOmahaBigBetSizeIsPriced.ts'), 'utf8');
    expect(src).not.toMatch(/omahaOpponentKindOf|humanUserIds|\.\s*is_horse\b/);
  });

  it('has NO discontinuity across the 0.70 pot-share step and NO dependency on the 20 BB chip mark', () => {
    const at69 = omahaPricedBigBetStrength({
      frac: 0.69,
      street: 'river',
      holeCount: 5,
      streets: 2,
      raised: false,
    });
    const at71 = omahaPricedBigBetStrength({
      frac: 0.71,
      street: 'river',
      holeCount: 5,
      streets: 2,
      raised: false,
    });
    // Strictly smooth and monotone across 0.70 (no tier step jump!)
    expect(at71).toBeGreaterThan(at69);
    expect(at71 - at69).toBeLessThan(0.01);

    // 20 BB mark (`bigBet: true`) has ZERO effect when applyOmahaBigBetSizeRange runs
    const { hero, gs } = buildLimpedRiverSpot({ gameVariant: 'plo5', heroCards: 'AsKsQhJhTh' });
    const readNoBig: OppPostflopRead = {
      aggrW: 0.2,
      checked: 0,
      streets: 1,
      lastStage: 'river',
      lastFrac: 0.5,
      bigBet: false,
    };
    const readWithBig: OppPostflopRead = {
      aggrW: 0.2,
      checked: 0,
      streets: 1,
      lastStage: 'river',
      lastFrac: 0.5,
      bigBet: true,
    };
    applyOmahaBigBetSizeRange([readNoBig], [{ user_id: VILLAIN }], hero, gs, false);
    applyOmahaBigBetSizeRange([readWithBig], [{ user_id: VILLAIN }], hero, gs, false);
    expect(readWithBig.tierByPotShare).toBe(true);
    expect(readWithBig.pricedBetStrength).toBe(readNoBig.pricedBetStrength);
  });

  it('shrinks lifetime HUD showdown strength and bet frequency smoothly via n/(n+k)', () => {
    const base = omahaPricedBigBetStrength({
      frac: 0.75,
      street: 'river',
      holeCount: 4,
      streets: 1,
      raised: false,
      opponentId: VILLAIN,
    });

    // High-frequency bluff-heavy opponent -> lower pStrong
    installDecisionHud(
      makeHudPacket('plo4', {
        'sd.strongBig.r': [40, 12], // 30% strong vs 76% prior
        'sd.strong.r': [40, 12],
        'r.betCk': [80, 60], // 75% bet rate vs 34% prior
      })
    );
    const vsBluffer = omahaPricedBigBetStrength({
      frac: 0.75,
      street: 'river',
      holeCount: 4,
      streets: 1,
      raised: false,
      opponentId: VILLAIN,
    });

    // Tight value-heavy opponent -> higher pStrong
    installDecisionHud(
      makeHudPacket('plo4', {
        'sd.strongBig.r': [40, 38], // 95% strong
        'sd.strong.r': [40, 38],
        'r.betCk': [80, 8], // 10% bet rate
      })
    );
    const vsNit = omahaPricedBigBetStrength({
      frac: 0.75,
      street: 'river',
      holeCount: 4,
      streets: 1,
      raised: false,
      opponentId: VILLAIN,
    });

    expect(vsBluffer).toBeLessThan(base);
    expect(vsNit).toBeGreaterThan(base);
  });

  it('prices limped-pot small bets by EV: resizes strong value UP, keeps weak/air bets vs station, always legal', () => {
    // Calling station villain who rarely folds to small or big river bets
    installDecisionHud(
      makeHudPacket('plo4', {
        'r.fb.sm.hu': [50, 2], // 4% fold to small
        'r.fb.bg.hu': [50, 4], // 8% fold to big
        'r.rBet.hu': [50, 2],
      })
    );
    const smallBet: HorseDecision = { action: 'bet', amount: 2, thinkTime: 0 };

    // Top full house (AAA on AhKh2c7d9s) -> bigger bet wins significantly more EV from the station
    const nuts = buildLimpedRiverSpot({ heroCards: 'AsAcQsJd', pot: 16, maxRaiseTo: 16 });
    const resNuts = omahaPricedLimpedPotSize(smallBet, nuts.hero, nuts.gs, 0.05, true);
    expect(resNuts.outcome).toBe('resized');
    expect(resNuts.decision.action).toBe('bet');
    expect(resNuts.decision.amount).toBeGreaterThan(2);
    expect(resNuts.decision.amount!).toBeLessThanOrEqual(16);

    // Pure air (3c4c5d6d on AhKh2c7d9s) vs calling station -> bigger bet loses EV; must KEEP small bet
    const air = buildLimpedRiverSpot({ heroCards: '3c4c5d6d', pot: 16, maxRaiseTo: 16 });
    const resAir = omahaPricedLimpedPotSize(smallBet, air.hero, air.gs, 0.05, true);
    expect(resAir.outcome).toBe('kept');
    expect(resAir.decision.action).toBe('bet');
    expect(resAir.decision.amount).toBe(2);

    // Verify priceBetSizeEv monotonicity sanity
    const evHighEqSmall = priceBetSizeEv({
      size: 2,
      pot: 16,
      rake: 0.05,
      stage: 'river',
      responses: [{ foldSm: 0.1, foldBg: 0.15, raiseRate: 0.05 }],
      equityAt: () => 0.95,
    })!;
    const evHighEqBig = priceBetSizeEv({
      size: 6,
      pot: 16,
      rake: 0.05,
      stage: 'river',
      responses: [{ foldSm: 0.1, foldBg: 0.15, raiseRate: 0.05 }],
      equityAt: () => 0.95,
    })!;
    expect(evHighEqBig).toBeGreaterThan(evHighEqSmall);
  });

  it('is strictly out-of-scope (no-op) for PLO6, PLO8, holdem, tournaments, multi-board, bomb pot, fixed-limit', () => {
    const cases: Array<
      [string, Partial<HorseGameStateV2> & { gameVariant?: string; heroCards?: string }]
    > = [
      ['plo6', { gameVariant: 'plo6', heroCards: 'AsKsAdKdQsJs' }],
      ['plo8', { gameVariant: 'plo8', heroCards: 'AsKsAdKd' }],
      ['holdem', { gameVariant: 'nlh', heroCards: 'AsKs' }],
      ['tournament', { gameVariant: 'plo4', gameMode: 'tournament' }],
      ['multiBoard', { gameVariant: 'plo4', boardCount: 2 }],
      ['bombPot', { gameVariant: 'plo4', bombPot: true }],
      ['fixedLimit', { gameVariant: 'plo4', bettingStructure: 'fixed_limit' }],
    ];
    for (const [label, ov] of cases) {
      const { hero, gs } = buildLimpedRiverSpot(ov);
      expect(omahaBigBetSizeScope(hero, gs), label).toBeNull();
    }
  });

  it('is byte-identical across person vs Horse AND across unseen villain hole cards AND when OFF', () => {
    const smallBet: HorseDecision = { action: 'bet', amount: 2, thinkTime: 0 };
    const sPerson = buildLimpedRiverSpot({
      heroCards: 'AsAcQsJd',
      pot: 16,
      villainIsHorse: false,
      villainCards: 'QcJcTc8c',
    });
    const sHorse = buildLimpedRiverSpot({
      heroCards: 'AsAcQsJd',
      pot: 16,
      villainIsHorse: true,
      villainCards: '3h4h5h6h',
    });

    const rPerson = omahaPricedLimpedPotSize(smallBet, sPerson.hero, sPerson.gs, 0.05, false);
    const rHorse = omahaPricedLimpedPotSize(smallBet, sHorse.hero, sHorse.gs, 0.05, false);
    expect(rHorse).toEqual(rPerson);

    // Off (unset vs false) through HorseLogic.decide is byte-identical
    enableBrainTelemetry();
    drainFires();
    seedFastRandom(42);
    const dUnset = HorseLogic.decide(sPerson.hero, sPerson.gs, 'balanced', {} as never, {
      observeMind: false,
      telemetry: true,
    });
    const fUnset = drainFires().map((f) => f.feature);
    seedFastRandom(42);
    const dFalse = HorseLogic.decide(sPerson.hero, sPerson.gs, 'balanced', {} as never, {
      observeMind: false,
      telemetry: true,
      omahaBigBetSizeIsPriced: false,
    });
    const fFalse = drainFires().map((f) => f.feature);
    expect({ action: dFalse.action, amount: dFalse.amount, fires: fFalse }).toEqual({
      action: dUnset.action,
      amount: dUnset.amount,
      fires: fUnset,
    });
  });
});
