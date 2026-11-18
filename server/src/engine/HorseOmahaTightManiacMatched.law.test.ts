/**
 * OMAHA TIGHT / MANIAC / UNKNOWN: MATCHED FIXED-INPUT LAW (Phase 1, 2026-11-13).
 *
 * One public river spot, one hero hand, one seed list. Only the opponents'
 * remembered public history changes. It pins what the serving Omaha design
 * does with each class of opponent, so a later change to a read or a consumer
 * shows up here:
 *
 *  - unknown and sparse opponents carry the shared presumption, which is NOT
 *    evidence: the committed action is the baseline (identical to the action
 *    against a player whose own hands disproved the presumption);
 *  - a tight or passive opponent is recognised by the disproof and gets the
 *    baseline too, including when it makes one pot-sized bet (the engine has
 *    no tight exploit on this path; EXPLOIT_SIDES engages the high side only);
 *  - a sustained maniac (wide raiser who bets whenever checked to) is read on
 *    evidence and the bluff-catcher the baseline folds is called instead
 *    (maniacCallDown, receipt maniac_call_down);
 *  - the read used is the player whose bet is faced: an evidenced maniac who
 *    was aggressive earlier in the hand and has folded changes nothing, and a
 *    tight player who folded does not protect against the maniac who bets;
 *  - recency: a maniac who then plays 200 tight hands is back at the baseline,
 *    and a tight player who then turns maniac is called down.
 *
 * Time-based staleness is not part of these reads (they decay by hands
 * observed, EXPLOIT_HALF_LIFE_HANDS / EXPLOIT_FAST_HALF_LIFE_HANDS), so there
 * is no stale-by-age case to pin here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { isPostflopManiac, maniacRaiseWidth } from './HorseOpponentExploit.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { ActionRecord, Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] => {
  const out: Card[] = [];
  for (let i = 0; i + 1 < spec.length; i += 2)
    out.push({ rank: spec[i] as CardRank, suit: SUIT[spec[i + 1]] });
  return out;
};
const HERO = '86000000-0000-4000-8000-000000000007';
const BETTOR = '40000000-0000-4000-8000-0000000000a1';
const FOLDED = '40000000-0000-4000-8000-0000000000b2';
const PEER = '77000000-0000-4000-8000-000000000002';
const TABLE = 3;
const SEEDS = Array.from({ length: 12 }, (_, i) => 1000 + i);

const seat = (n: number, id: string, hole: string, over: Partial<SeatPlayer> = {}): SeatPlayer =>
  ({
    seat: n,
    user_id: id,
    username: `P${n}`,
    stack: 200,
    bet: 0,
    totalInvested: 0,
    cards: hole ? cards(hole) : [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: false,
    ...over,
  }) as SeatPlayer;

/** Folds four hands in five, limps the fifth and gives up to a flop bet: never raises. */
function playTight(userId: string, variant: string, hands: number, tag: string): void {
  const scope = readScopeOf(variant, TABLE);
  for (let h = 0; h < hands; h++) {
    const t = h * 20;
    const acts = (h % 5 === 0
      ? [
          {
            stage: 'preflop',
            seat: 3,
            userId,
            action: 'call',
            amount: 2,
            origin: 'player',
            timestamp: t + 1,
          },
          {
            stage: 'flop',
            seat: 3,
            userId,
            action: 'check',
            amount: 0,
            origin: 'player',
            timestamp: t + 2,
          },
          {
            stage: 'flop',
            seat: 2,
            userId: PEER,
            action: 'bet',
            amount: 4,
            origin: 'horse_policy',
            timestamp: t + 3,
          },
          {
            stage: 'flop',
            seat: 3,
            userId,
            action: h % 10 === 0 ? 'call' : 'fold',
            amount: h % 10 === 0 ? 4 : 0,
            origin: 'player',
            timestamp: t + 4,
          },
        ]
      : [
          {
            stage: 'preflop',
            seat: 3,
            userId,
            action: 'fold',
            amount: 0,
            origin: 'player',
            timestamp: t + 1,
          },
        ]) as unknown as ActionRecord[];
    HorseMind.observeHandComplete(`${tag}:tight:${variant}:${h}`, acts, 2, null, scope);
  }
}

/** Raises three hands in five and bets every street it is checked to. */
function playManiac(userId: string, variant: string, hands: number, tag: string): void {
  const scope = readScopeOf(variant, TABLE);
  for (let h = 0; h < hands; h++) {
    const t = h * 20;
    const raise = h % 5 < 3;
    const acts = [
      {
        stage: 'preflop',
        seat: 3,
        userId,
        action: raise ? 'raise' : 'call',
        amount: raise ? 7 : 2,
        ...(raise ? { isFullRaise: true } : {}),
        origin: 'player',
        timestamp: t + 1,
      },
      {
        stage: 'preflop',
        seat: 2,
        userId: PEER,
        action: 'call',
        amount: 5,
        origin: 'horse_policy',
        timestamp: t + 2,
      },
      ...(['flop', 'turn', 'river'] as const).flatMap((st, i) => [
        {
          stage: st,
          seat: 2,
          userId: PEER,
          action: 'check',
          amount: 0,
          origin: 'horse_policy',
          timestamp: t + 3 + i * 3,
        },
        {
          stage: st,
          seat: 3,
          userId,
          action: 'bet',
          amount: 10 * (i + 1),
          origin: 'player',
          timestamp: t + 4 + i * 3,
        },
        {
          stage: st,
          seat: 2,
          userId: PEER,
          action: st === 'river' ? 'fold' : 'call',
          amount: st === 'river' ? 0 : 10 * (i + 1),
          origin: 'horse_policy',
          timestamp: t + 5 + i * 3,
        },
      ]),
    ] as unknown as ActionRecord[];
    HorseMind.observeHandComplete(`${tag}:maniac:${variant}:${h}`, acts, 2, null, scope);
  }
}

type Kind = 'unknown' | 'sparse' | 'tight' | 'maniac' | 'maniac_then_tight' | 'tight_then_maniac';
function remember(userId: string, kind: Kind, variant: string): void {
  if (kind === 'sparse') playTight(userId, variant, 6, userId);
  if (kind === 'tight') playTight(userId, variant, 200, userId);
  if (kind === 'maniac') playManiac(userId, variant, 120, userId);
  if (kind === 'maniac_then_tight') {
    playManiac(userId, variant, 120, `${userId}:a`);
    playTight(userId, variant, 200, `${userId}:b`);
  }
  if (kind === 'tight_then_maniac') {
    playTight(userId, variant, 200, `${userId}:a`);
    playManiac(userId, variant, 120, `${userId}:b`);
  }
}

interface Spot {
  variant: 'plo4' | 'plo5';
  hole: string;
  bet: number;
}
/** Hero holds top pair. Three saw the flop; FOLDED raised preflop, bet the flop
 *  and folded the turn; BETTOR bets the river into hero. Pot 80 before the bet. */
const SPOTS: Spot[] = [
  { variant: 'plo4', hole: 'AhKd7c2s', bet: 80 },
  { variant: 'plo5', hole: 'AhKd7c2s4d', bet: 80 },
];
function riverSpot(s: Spot): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const hero = seat(1, HERO, s.hole, { stack: 240, totalInvested: 20, is_horse: true });
  const bettor = seat(2, BETTOR, '', { stack: 240 - s.bet, bet: s.bet, totalInvested: 20 + s.bet });
  const folded = seat(3, FOLDED, '', { stack: 230, totalInvested: 30, is_folded: true });
  const gs = {
    players: [hero, bettor, folded],
    communityCards: cards('As9h6d3cJs'),
    pot: 80 + s.bet,
    currentBet: s.bet,
    toCall: s.bet,
    minRaise: s.bet,
    minRaiseTo: s.bet * 2,
    maxRaiseTo: 240,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: 'river',
    gameVariant: s.variant,
    bettingStructure: 'pot_limit',
    boardCount: 1,
    bigBlind: 2,
    dealerSeat: 2,
    gameMode: 'cash',
    actionHistory: [
      { stage: 'preflop', seat: 3, userId: FOLDED, action: 'raise', amount: 6, timestamp: 1 },
      { stage: 'preflop', seat: 2, userId: BETTOR, action: 'call', amount: 6, timestamp: 2 },
      { stage: 'preflop', seat: 1, userId: HERO, action: 'call', amount: 6, timestamp: 3 },
      { stage: 'flop', seat: 3, userId: FOLDED, action: 'bet', amount: 14, timestamp: 4 },
      { stage: 'flop', seat: 2, userId: BETTOR, action: 'call', amount: 14, timestamp: 5 },
      { stage: 'flop', seat: 1, userId: HERO, action: 'call', amount: 14, timestamp: 6 },
      { stage: 'turn', seat: 3, userId: FOLDED, action: 'check', amount: 0, timestamp: 7 },
      { stage: 'turn', seat: 2, userId: BETTOR, action: 'bet', amount: 10, timestamp: 8 },
      { stage: 'turn', seat: 1, userId: HERO, action: 'call', amount: 10, timestamp: 9 },
      { stage: 'turn', seat: 3, userId: FOLDED, action: 'fold', amount: 0, timestamp: 10 },
      { stage: 'river', seat: 1, userId: HERO, action: 'check', amount: 0, timestamp: 11 },
      { stage: 'river', seat: 2, userId: BETTOR, action: 'bet', amount: s.bet, timestamp: 12 },
    ],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

interface Outcome {
  actions: string[];
  fires: Set<string>;
}
function play(s: Spot, bettor: Kind, folded: Kind): Outcome {
  const actions: string[] = [];
  const fires = new Set<string>();
  enableBrainTelemetry();
  for (const seed of SEEDS) {
    HorseMind.reset();
    remember(BETTOR, bettor, s.variant);
    remember(FOLDED, folded, s.variant);
    drainFires();
    seedFastRandom(seed);
    const { hero, gs } = riverSpot(s);
    const d = HorseLogic.decide(hero, gs, 'balanced', {}, { telemetry: true });
    actions.push(d.action);
    for (const f of drainFires()) fires.add(f.feature);
  }
  return { actions, fires };
}
const maniacReceipts = (o: Outcome) => [...o.fires].filter((f) => /maniac/.test(f)).sort();

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe.each(SPOTS)('Omaha matched reads, $variant river, pot-sized bet into top pair', (s) => {
  it('recognition: unknown and sparse are presumed, tight is disproved, the maniac is evidenced', () => {
    const read = (kind: Kind) => {
      HorseMind.reset();
      remember(BETTOR, kind, s.variant);
      HorseMind.setDecisionScope(readScopeOf(s.variant, TABLE), s.variant, 'cash');
      return HorseMind.opponentRead(BETTOR);
    };
    for (const kind of ['unknown', 'sparse'] as Kind[]) {
      const r = read(kind);
      expect(r?.presumed, kind).toBe(true);
      expect(isPostflopManiac(r), kind).toBe(false);
    }
    const tight = read('tight');
    expect(tight?.presumed, 'tight').not.toBe(true);
    expect(maniacRaiseWidth(tight), 'tight').toBeNull();
    expect(isPostflopManiac(tight), 'tight').toBe(false);
    // The maniac is recognised by what it does when checked to. Its raise
    // width is evidence of its own only where 60 percent is credibly outside
    // the Horse envelope for that game and table size (PLO4 here; three-handed
    // PLO5 Horses raise too often for that, so the width stays presumed).
    const maniac = read('maniac');
    expect(isPostflopManiac(maniac), 'maniac').toBe(true);
    expect(maniac?.stats.betCheckedTo.engaged, 'maniac').toBe('high');
    if (s.variant === 'plo4') {
      expect(maniac?.presumed, 'maniac').not.toBe(true);
      expect(maniacRaiseWidth(maniac), 'maniac').not.toBeNull();
    } else {
      expect(maniac?.presumed, 'maniac').toBe(true);
    }
  });

  it('committed response: baseline against unknown, sparse and tight; the maniac is called down', () => {
    const tight = play(s, 'tight', 'unknown');
    expect(new Set(tight.actions)).toEqual(new Set(['fold']));
    expect(maniacReceipts(tight)).toEqual([]);
    expect(tight.fires.has('plo_opponent_presumption_disproved')).toBe(true);
    for (const kind of ['unknown', 'sparse'] as Kind[]) {
      const o = play(s, kind, 'unknown');
      expect(o.actions, kind).toEqual(tight.actions);
      expect(maniacReceipts(o), kind).toEqual([]);
    }
    // Every seed calls, with the maniacCallDown receipt (and, where the raise
    // width is only presumed, the postflop-maniac receipt beside it).
    const maniac = play(s, 'maniac', 'unknown');
    expect(new Set(maniac.actions)).toEqual(new Set(['call']));
    expect(maniacReceipts(maniac)).toContain('maniac_call_down');
    if (s.variant === 'plo5')
      expect(maniacReceipts(maniac)).toContain('postflop_maniac_call_down_checked');
  });

  it('aggressor binding: the read is the bettor faced, not an earlier aggressor who folded', () => {
    const tightAlone = play(s, 'tight', 'unknown');
    const tightWithFoldedManiac = play(s, 'tight', 'maniac');
    expect(tightWithFoldedManiac.actions).toEqual(tightAlone.actions);
    expect(maniacReceipts(tightWithFoldedManiac)).toEqual([]);
    const maniacAlone = play(s, 'maniac', 'unknown');
    const maniacWithFoldedTight = play(s, 'maniac', 'tight');
    expect(maniacWithFoldedTight.actions).toEqual(maniacAlone.actions);
    expect(maniacReceipts(maniacWithFoldedTight)).toContain('maniac_call_down');
  });

  it('recency: the latest sustained behaviour decides', () => {
    const baseline = play(s, 'tight', 'unknown');
    const reformed = play(s, 'maniac_then_tight', 'unknown');
    expect(reformed.actions).toEqual(baseline.actions);
    expect(maniacReceipts(reformed)).toEqual([]);
    const turned = play(s, 'tight_then_maniac', 'unknown');
    expect(new Set(turned.actions)).toEqual(new Set(['call']));
    expect(maniacReceipts(turned)).toContain('maniac_call_down');
  });
});
