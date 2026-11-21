/**
 * omahaMathCoreNetsTheWholeDeduction (EMERG lane RAKE 2026-11-20; redundant since lane CORE-POOLED-4).
 * Law: the core nets every pot it prices of the whole deduction: the cap of the dealt-player tier, the
 * fixed jackpot drop, and both on a preflop line that reaches a flop, while a preflop fold-out still pays
 * nothing. Since CORE-POOLED-4 this is the default (rake.platform, the platform's own rules; law
 * OmahaMathCorePlatformRake.law.test.ts) and the option changes nothing. A hand-built state without
 * `platform` keeps the old arithmetic (the spot tests below). PLO6 is outside the core. Synthetic states only.
 */
import { describe, expect, it } from 'vitest';
import type { SeatPlayer } from '../../types.js';
import { parseCardString } from './OmahaMathCoreEval.js';
import { decideOmahaMathCore, type CoreState } from './OmahaMathCore.js';
import {
  omahaMathCoreInScope,
  omahaMathCoreRule,
  omahaMathCoreState,
} from './OmahaMathCoreRule.js';

const now = () => 0;
function spot(
  input: Omit<Partial<CoreState>, 'hole' | 'board'> & { hole: string; board: string }
): CoreState {
  const { hole, board, ...p } = input;
  const toCall = p.toCall ?? 0;
  const pot = p.pot ?? 100;
  return {
    variant: hole.length === 10 ? 'plo5' : 'plo4',
    chipUnit: 0.01,
    mode: 'table',
    street: p.street ?? 'flop',
    pot,
    toCall,
    heroBet: 0,
    heroStack: p.heroStack ?? 1000,
    currentBet: toCall,
    minRaiseTo: toCall > 0 ? toCall * 2 : 2,
    maxRaiseTo: toCall > 0 ? toCall + pot + toCall : pot,
    bigBlind: 2,
    legal: toCall > 0 ? ['fold', 'call', 'raise', 'all_in'] : ['check', 'bet', 'all_in'],
    heroSeat: 5,
    heroPosition: 'BTN',
    ip: true,
    opponents: [
      {
        seat: 2,
        user: 'u2',
        person: true,
        stack: 1000,
        bet: toCall,
        folded: false,
        allIn: false,
        streetAction: toCall > 0 ? 'wager' : 'check',
        calledPrevStreet: false,
        prevAggressor: false,
        position: 'BB',
        preflopLevel: 'call',
      },
    ],
    aggressorSeat: toCall > 0 ? 2 : null,
    line: toCall > 0 ? 'stab' : null,
    band: toCall > 0 ? 'pot' : null,
    wagerFrac: toCall > 0 ? toCall / (pot - toCall) : 0,
    heroWagerLine: toCall > 0 ? 'raise' : 'stab',
    preflopRaises: 0,
    rake: { percent: 10, cap: 5, noFlopNoDrop: true },
    seed: `${hole}|${board}|${pot}|${toCall}`,
    ...p,
    hole: parseCardString(hole),
    board: parseCardString(board),
  } as CoreState;
}
const evOf = (s: CoreState, action: string) => {
  const e = decideOmahaMathCore(s, { now }).receipt.evs.filter((x) => x.action === action);
  expect(e.length).toBeGreaterThan(0);
  return e[0].ev;
};
const OLD = { percent: 10, cap: 5, noFlopNoDrop: true };
const WHOLE = { ...OLD, whole: true, drop: 1.2 };

function live(variant: string): { hero: SeatPlayer; gs: Record<string, unknown> } {
  const seat = (n: number, over: Partial<SeatPlayer>): SeatPlayer =>
    ({
      seat: n,
      user_id: `u${n}`,
      username: `u${n}`,
      stack: 400,
      bet: 0,
      totalInvested: 0,
      cards: [],
      is_folded: true,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
      ...over,
    }) as SeatPlayer;
  const hole = variant === 'plo6' ? 'AhKhQs7d2c9c' : variant === 'plo4' ? 'AhKhQs7d' : 'AhKhQs7d2c';
  const players = [
    seat(1, { stack: 370, totalInvested: 30, is_folded: false, cards: parseCardStringCards(hole) }),
    seat(2, { stack: 330, bet: 40, totalInvested: 70, is_folded: false, is_horse: false }),
    seat(3, {}),
  ];
  return {
    hero: players[0],
    gs: {
      stateSchemaVersion: 1,
      players,
      dealtSeatIds: [1, 2, 3],
      communityCards: parseCardStringCards('Jh8s2s'),
      pot: 100,
      currentBet: 40,
      toCall: 40,
      minRaiseTo: 80,
      maxRaiseTo: 180,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      stage: 'flop',
      gameVariant: variant,
      bettingStructure: 'pot_limit',
      gameMode: 'cash',
      asset: 'chips',
      chipUnit: 0.01,
      bigBlind: 2,
      smallBlind: 1,
      dealerSeat: 2,
      rakeConfig: {
        percent: 10,
        cap: 5,
        noFlopNoDrop: true,
        playerCountCaps: [
          { players: 2, cap: 2.5 },
          { players: 3, cap: 3.75 },
          { players: 4, cap: 5 },
        ],
      },
      bbjConfig: { enabled: true, feeBB: 0.6, minPotBB: 10, minPlayersDealt: 3 },
      actionHistory: [
        { stage: 'preflop', seat: 2, userId: 'u2', action: 'raise', amount: 30, timestamp: 1 },
        { stage: 'preflop', seat: 1, userId: 'u1', action: 'call', amount: 30, timestamp: 2 },
        { stage: 'flop', seat: 1, userId: 'u1', action: 'check', amount: 0, timestamp: 3 },
        { stage: 'flop', seat: 2, userId: 'u2', action: 'bet', amount: 40, timestamp: 4 },
      ],
    },
  };
}
const SUIT = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const;
function parseCardStringCards(text: string) {
  const out = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i], suit: SUIT[text[i + 1] as keyof typeof SUIT] });
  return out as never;
}

describe('omahaMathCoreNetsTheWholeDeduction (default OFF)', () => {
  it('default (lane CORE-POOLED-4): the state nets the whole platform deduction; the option changes nothing', () => {
    const s = live('plo5');
    const def = omahaMathCoreState(s.hero, s.gs as never);
    expect(def.rake).toMatchObject({
      percent: 10,
      cap: 3.75,
      noFlopNoDrop: true,
      whole: true,
      drop: 1.2,
    });
    expect(def.rake?.platform).toEqual({
      config: {
        percent: 10,
        cap: 5,
        noFlopNoDrop: true,
        playerCountCaps: [
          { players: 2, cap: 2.5 },
          { players: 3, cap: 3.75 },
          { players: 4, cap: 5 },
        ],
      },
      players: 3,
      bbjFee: 1.2,
    });
    expect(omahaMathCoreState(s.hero, s.gs as never, false)).toEqual(def);
    expect(omahaMathCoreState(s.hero, s.gs as never, true)).toEqual(def);
  });

  it('a field that is present but not on changes no value', () => {
    for (const street of ['preflop', 'flop'] as const) {
      const base = spot({
        hole: 'AhKhQs7d2c',
        board: street === 'flop' ? 'Jh8s2s' : '',
        street,
        pot: 30,
        toCall: 10,
        rake: OLD,
      });
      const same = { ...base, rake: { ...OLD, whole: false, drop: 1.2 } } as CoreState;
      expect(decideOmahaMathCore(same, { now }).receipt.evs).toEqual(
        decideOmahaMathCore(base, { now }).receipt.evs
      );
    }
  });

  it('after the flop the call is worth less by its share of the drop, and the fold is unchanged', () => {
    const base = spot({ hole: 'AhKhQs7d2c', board: 'Jh8s2s', pot: 100, toCall: 40, rake: OLD });
    const on = { ...base, rake: WHOLE } as CoreState;
    const d = evOf(base, 'call') - evOf(on, 'call');
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(1.2 + 1e-9);
    expect(evOf(on, 'fold')).toBe(evOf(base, 'fold'));
  });

  it('preflop a call that reaches the flop pays the capped rake and the drop; off it is priced rake-free', () => {
    const base = spot({
      hole: 'AhKhQs7d2c',
      board: '',
      street: 'preflop',
      pot: 17,
      toCall: 5,
      rake: OLD,
    });
    const free = { ...base, rake: null } as CoreState;
    expect(evOf(base, 'call')).toBe(evOf(free, 'call'));
    const on = { ...base, rake: WHOLE } as CoreState;
    const d = evOf(base, 'call') - evOf(on, 'call');
    // pot after the call 22: rake 2.2 and drop 1.2, times the share of that pot the call realises
    expect(d).toBeGreaterThan(0.3);
    expect(d).toBeLessThanOrEqual(3.4 + 1e-9);
    expect(evOf(on, 'fold')).toBe(evOf(base, 'fold'));
  });

  it('PLO6 is outside the core with the option on', () => {
    const six = live('plo6');
    expect(omahaMathCoreInScope(six.hero, six.gs as never)).toBe(false);
    const incoming = { action: 'fold' as const, thinkTime: 1 };
    expect(
      omahaMathCoreRule(
        incoming,
        six.hero,
        six.gs as never,
        { omahaMathCore: true, omahaMathCoreNetsTheWholeDeduction: true },
        (d) => d
      )
    ).toBe(incoming);
  });
});
