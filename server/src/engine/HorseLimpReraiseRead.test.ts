import { describe, expect, it } from 'vitest';
import { HorseLogic, commitUnderPotCall, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { decodeHorseDecisionReads, encodeHorseDecisionReads } from './HorseDecisionReadFrame.js';
import { seedFastRandom } from './HorseEval.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';
import { HORSE_FEATURE_FLAGS } from './HorseFeatureAuthority.js';
import {
  LIMP_RERAISE_ISO_BAR,
  limpReraiseEngagement,
  limpReraiseIsoBar,
  limpReraiseRate,
} from './HorseLimpReraiseRead.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const LIMPER = '11111111-1111-4111-a111-111111111111';
const HORSE = '22222222-2222-4222-a222-222222222222';
const OTHER = '33333333-3333-4333-a333-333333333333';
const BIG = '44444444-4444-4444-a444-444444444444';

let clock = 1_800_000_000_000;
const rec = (userId: string, seat: number, action: string, amount = 0): ActionRecord =>
  ({ seat, userId, action, amount, timestamp: clock++, stage: 'preflop' }) as ActionRecord;

/** One preflop: LIMPER limps, HORSE isolates to 8, LIMPER answers. */
function limpHand(answer: 'raise' | 'call' | 'fold'): ActionRecord[] {
  return [
    rec(LIMPER, 4, 'call', 2),
    rec(OTHER, 5, 'fold'),
    rec(HORSE, 1, 'raise', 8),
    rec(BIG, 3, 'fold'),
    rec(LIMPER, 4, answer, answer === 'raise' ? 32 : answer === 'call' ? 8 : 0),
    ...(answer === 'raise' ? [rec(HORSE, 1, 'fold')] : []),
  ];
}

describe('HorseMind counts limp-reraises', () => {
  it('counts a limp that met a raise and the answer, once per hand', () => {
    const sb = HorseMind.createSandbox();
    HorseMind.runInSandbox(sb, () => {
      const h1 = limpHand('raise');
      HorseMind.observe(h1, []);
      HorseMind.observe(h1, []); // a replayed prefix is not counted twice
      HorseMind.observe(limpHand('call'), []);
      HorseMind.observe(limpHand('fold'), []);
      expect(HorseMind.limpReraiseOf(LIMPER)).toEqual({ opps: 3, raises: 1 });
      // The isolating raiser and the folders never limped.
      expect(HorseMind.limpReraiseOf(HORSE)).toBeNull();
      expect(HorseMind.limpReraiseOf(OTHER)).toBeNull();
    });
  });

  it('a limp nobody raised, a big blind check and an open raise are not chances', () => {
    const sb = HorseMind.createSandbox();
    HorseMind.runInSandbox(sb, () => {
      HorseMind.observe([rec(LIMPER, 4, 'call', 2), rec(BIG, 3, 'check')], []);
      HorseMind.observe(
        [rec(LIMPER, 4, 'raise', 5), rec(HORSE, 1, 'raise', 16), rec(LIMPER, 4, 'raise', 40)],
        []
      );
      HorseMind.observe([rec(BIG, 3, 'check'), rec(HORSE, 1, 'raise', 6), rec(BIG, 3, 'fold')], []);
      expect(HorseMind.limpReraiseOf(LIMPER)).toBeNull();
      expect(HorseMind.limpReraiseOf(BIG)).toBeNull();
    });
  });
});

describe('the limp-reraise rate is shrunk toward the population', () => {
  it('a small sample barely moves; a long one converges', () => {
    expect(limpReraiseRate(0, 0)).toBeCloseTo(0.05, 6);
    expect(limpReraiseEngagement(limpReraiseRate(0, 0))).toBe(0);
    // One re-raise in one chance is not a read.
    expect(limpReraiseEngagement(limpReraiseRate(1, 1))).toBeLessThan(0.2);
    // Never re-raising, however often seen, never engages.
    expect(limpReraiseEngagement(limpReraiseRate(0, 200))).toBe(0);
    // A third of 60 chances is a full read.
    expect(limpReraiseEngagement(limpReraiseRate(25, 60))).toBe(1);
  });

  it('only ever raises the isolation bar', () => {
    for (const bar of [0.3, 0.5, 0.7, 0.9])
      for (const rate of [0, 0.1, 0.2, 0.3, 0.6]) {
        const next = limpReraiseIsoBar(bar, rate);
        expect(next).toBeGreaterThanOrEqual(bar);
        expect(next).toBeLessThanOrEqual(Math.max(bar, LIMP_RERAISE_ISO_BAR) + 1e-9);
      }
  });
});

// ── The isolation decision through the whole brain ───────────────────────

const SUITS: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RK = 'AKQJT98765432';
const CLASSES: string[] = [];
for (let i = 0; i < 13; i++)
  for (let j = 0; j < 13; j++)
    CLASSES.push(i === j ? RK[i] + RK[i] : j > i ? RK[i] + RK[j] + 's' : RK[j] + RK[i] + 'o');
const combos = (c: string) => (c.length === 2 ? 6 : c[2] === 's' ? 4 : 12);
const holeOf = (c: string): Card[] => [
  { rank: c[0] as Card['rank'], suit: 'spades' },
  { rank: c[1] as Card['rank'], suit: c[2] === 's' ? 'spades' : 'hearts' },
];
const FLAGS_OFF = Object.fromEntries(HORSE_FEATURE_FLAGS.map((k: string) => [k, false]));

/** Six-handed 40bb cash: seat 4 (UTG) limps, folds to the button (seat 1). */
function buttonOverLimp(cls: string): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const ids = [
    HORSE,
    BIG,
    '55555555-5555-4555-a555-555555555555',
    LIMPER,
    OTHER,
    '66666666-6666-4666-a666-666666666666',
  ];
  const players = ids.map(
    (id, k) =>
      ({
        seat: k + 1,
        user_id: id,
        username: `p${k + 1}`,
        stack: 80,
        bet: 0,
        totalInvested: 0,
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        cards: k === 0 ? holeOf(cls) : [],
      }) as SeatPlayer
  );
  // Button seat 1, small blind 2, big blind 3, UTG 4, HJ 5, CO 6.
  players[1].stack -= 1;
  players[1].bet = 1;
  players[2].stack -= 2;
  players[2].bet = 2;
  players[3].stack -= 2;
  players[3].bet = 2;
  players[4].is_folded = true;
  players[5].is_folded = true;
  const t = 1_900_000_000_000;
  const actionHistory = [
    { seat: 4, userId: LIMPER, action: 'call', amount: 2, timestamp: t, stage: 'preflop' },
    { seat: 5, userId: OTHER, action: 'fold', amount: 0, timestamp: t + 1, stage: 'preflop' },
    { seat: 6, userId: ids[5], action: 'fold', amount: 0, timestamp: t + 2, stage: 'preflop' },
  ];
  const gs = {
    players,
    communityCards: [],
    pot: 5,
    currentBet: 2,
    minRaise: 2,
    lastRaise: 2,
    stage: 'preflop',
    gameVariant: 'nlh',
    bigBlind: 2,
    dealerSeat: 1,
    actionHistory,
    gameMode: 'cash',
    ante: 0,
    format: 'cash',
  } as unknown as HorseGameStateV2;
  return { hero: players[0], gs };
}

/** Share of hands (by combos) the button raises over the limp. */
function isolationShare(history: 'reraiser' | 'never' | 'none', on: boolean | undefined): number {
  const persona = HORSE_HYBRID_PROFILES.cash;
  let raised = 0;
  for (const cls of CLASSES) {
    const sb = HorseMind.createSandbox();
    const d = HorseMind.runInSandbox(sb, () => {
      if (history !== 'none')
        for (let k = 0; k < 40; k++)
          HorseMind.observe(
            limpHand(
              history === 'reraiser' ? (k % 3 === 0 ? 'call' : 'raise') : k % 2 ? 'call' : 'fold'
            ),
            []
          );
      const { hero, gs } = buttonOverLimp(cls);
      seedFastRandom(7);
      return HorseLogic.decide(
        hero,
        gs,
        persona.style,
        { ...persona.mods },
        {
          ...FLAGS_OFF,
          ...(on === undefined ? {} : { limpReraiseIsoRead: on }),
          decisionTimeMs: 1000,
          observeMind: false,
        }
      );
    });
    if (d.action === 'raise' || d.action === 'all_in' || d.action === 'bet') raised += combos(cls);
  }
  return raised / 1326;
}

describe('limpReraiseIsoRead narrows isolation against a seen limp-reraiser only', () => {
  it('against a player who limp-reraises, the button isolates far fewer hands', () => {
    const off = isolationShare('reraiser', false);
    const on = isolationShare('reraiser', true);
    if (process.env.LR_PRINT) console.log('iso share off', off, 'on', on);
    expect(off).toBeGreaterThan(0.25);
    expect(on).toBeLessThan(off * 0.6);
    expect(on).toBeGreaterThan(0.05);
    // Default ON: an absent option reads exactly as true.
    expect(isolationShare('reraiser', undefined)).toBe(on);
  });

  it('against a limper never seen to limp-reraise, or never seen at all, nothing changes', () => {
    expect(isolationShare('never', true)).toBe(isolationShare('never', false));
    expect(isolationShare('none', true)).toBe(isolationShare('none', false));
  });
});

describe('commitUnderPot: a stack smaller than the pot does not fold the flop or turn', () => {
  const spot = (over: Record<string, unknown> = {}, heroStack = 40, extraLive = false) => {
    const hero = {
      seat: 1,
      user_id: HORSE,
      stack: heroStack,
      bet: 0,
      is_folded: false,
    } as SeatPlayer;
    const villain = {
      seat: 2,
      user_id: LIMPER,
      stack: 60,
      bet: 30,
      is_folded: false,
    } as SeatPlayer;
    const third = {
      seat: 3,
      user_id: OTHER,
      stack: 60,
      bet: 0,
      is_folded: !extraLive,
    } as SeatPlayer;
    const gs = {
      players: [hero, villain, third],
      communityCards: [],
      pot: 100,
      currentBet: 30,
      stage: 'flop',
      gameVariant: 'nlh',
      bigBlind: 2,
      ...over,
    } as unknown as HorseGameStateV2;
    return { hero, gs };
  };
  const ON = { commitUnderPot: true };
  const fold = { action: 'fold' as const, thinkTime: 1234 };

  it('calls, or goes all in when the call is the stack', () => {
    const a = spot();
    expect(commitUnderPotCall(fold, a.hero, a.gs, ON)).toMatchObject({
      action: 'call',
      amount: 30,
      thinkTime: 1234,
    });
    const b = spot({}, 20);
    expect(commitUnderPotCall(fold, b.hero, b.gs, ON).action).toBe('all_in');
    const t = spot({ stage: 'turn' });
    expect(commitUnderPotCall(fold, t.hero, t.gs, ON).action).toBe('call');
  });

  it('stands aside: flag off, deeper than the pot, preflop or river, multiway, no call on the menu', () => {
    const a = spot();
    expect(commitUnderPotCall(fold, a.hero, a.gs, {})).toBe(fold);
    const deep = spot({}, 150);
    expect(commitUnderPotCall(fold, deep.hero, deep.gs, ON)).toBe(fold);
    for (const stage of ['preflop', 'river']) {
      const s = spot({ stage });
      expect(commitUnderPotCall(fold, s.hero, s.gs, ON)).toBe(fold);
    }
    const mw = spot({}, 40, true);
    expect(commitUnderPotCall(fold, mw.hero, mw.gs, ON)).toBe(fold);
    const menu = spot({ legalActions: ['fold', 'raise'] });
    expect(commitUnderPotCall(fold, menu.hero, menu.gs, ON)).toBe(fold);
    const plo = spot({ gameVariant: 'plo4' });
    expect(commitUnderPotCall(fold, plo.hero, plo.gs, ON)).toBe(fold);
    const call = { action: 'call' as const, amount: 30, thinkTime: 5 };
    expect(commitUnderPotCall(call, a.hero, a.gs, ON)).toBe(call);
  });
});

describe('the limp-reraise tallies travel in a v12 read frame', () => {
  it.each(['call', 'fold'] as const)(
    'retains an original first limp-%s as one opportunity and zero raises',
    (answer) => {
      const { gs } = buttonOverLimp('KQs');
      const view = HorseMind.runInSandbox(HorseMind.createSandbox(), () => {
        HorseMind.observe(limpHand(answer), []);
        expect(HorseMind.limpReraiseOf(LIMPER)).toEqual({ opps: 1, raises: 0 });
        return HorseMind.snapshotDecisionReads(gs.players, null);
      });
      const frame = encodeHorseDecisionReads(view, gs.players, null);
      const restored = decodeHorseDecisionReads(frame, gs.players, null);
      expect(HorseMind.runInSandbox(restored, () => HorseMind.limpReraiseOf(LIMPER))).toEqual({
        opps: 1,
        raises: 0,
      });
      expect(encodeHorseDecisionReads(restored, gs.players, null)).toEqual(frame);
      const row = view.stats.get(LIMPER)!;
      row.lrRaises = 2;
      expect(() => encodeHorseDecisionReads(view, gs.players, null)).toThrow();
      delete row.lrOpps;
      expect(() => encodeHorseDecisionReads(view, gs.players, null)).toThrow();
    }
  );

  it('round-trips exactly, and a view without them keeps its older version and bytes', () => {
    const players = [{ user_id: HORSE }, { user_id: LIMPER }] as SeatPlayer[];
    const ctx = { variant: 'nlh', mode: 'cash', size: 'short' } as const;
    const sb = HorseMind.createSandbox();
    const view = HorseMind.runInSandbox(sb, () => {
      for (let k = 0; k < 9; k++) HorseMind.observe(limpHand(k % 3 ? 'raise' : 'call'), []);
      return HorseMind.snapshotDecisionReads(players, null, ctx);
    });
    const frame = encodeHorseDecisionReads(view, players, null);
    expect(frame.version).toBe('horse-decision-reads-v12');
    const restored = decodeHorseDecisionReads(frame, players, null);
    expect(restored.stats.get(LIMPER)).toMatchObject({ lrOpps: 9, lrRaises: 6 });
    expect(encodeHorseDecisionReads(restored, players, null)).toEqual(frame);
    // The decision reads the restored tallies exactly as the live ones.
    expect(HorseMind.runInSandbox(restored, () => HorseMind.limpReraiseOf(LIMPER))).toEqual({
      opps: 9,
      raises: 6,
    });

    for (const row of view.stats.values()) {
      delete row.lrOpps;
      delete row.lrRaises;
    }
    const older = encodeHorseDecisionReads(view, players, null);
    expect(older.version).not.toBe('horse-decision-reads-v12');
    expect(older.json).not.toContain('limpReraiseTallies');
  });
});
