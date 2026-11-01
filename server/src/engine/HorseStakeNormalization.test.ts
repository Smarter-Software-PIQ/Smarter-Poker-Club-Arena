import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, hasStrongPressureDraw, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { freshExploitCounters } from './HorseOpponentExploit.js';
import { seedFastRandom, omahaDrawQuality } from './HorseEval.js';
import { enableBrainTelemetry, drainFires } from './BrainTelemetry.js';
import type { Card, SeatPlayer, ActionRecord } from '../types.js';
const c = (rank: string, suit: string) => ({ rank, suit }) as Card;
afterEach(() => HorseMind.reset());
type Node = 'three_bet' | 'four_bet' | 'draw_checkraise' | 'river';
function state(variant: string, node: Node, scale: number) {
  const nlh = variant === 'nlh',
    hilo = variant === 'plo8';
  const cards = nlh
    ? [c('A', 'spades'), c('5', 'spades')]
    : hilo
      ? [c('A', 'diamonds'), c('2', 'diamonds'), c('3', 'hearts'), c('4', 'hearts')]
      : [
          c('A', 'diamonds'),
          c('K', 'diamonds'),
          c('J', 'hearts'),
          c('9', 'hearts'),
          ...(variant === 'plo4' ? [] : [c('3', 'clubs')]),
          ...(variant === 'plo6' ? [c('4', 'hearts')] : []),
        ];
  const board = nlh
    ? [c('7', 'spades'), c('4', 'spades'), c('2', 'diamonds')]
    : hilo
      ? [c('5', 'diamonds'), c('6', 'diamonds'), c('K', 'clubs')]
      : [c('8', 'diamonds'), c('T', 'diamonds'), c('2', 'clubs')];
  const pre = node === 'three_bet' || node === 'four_bet';
  if (pre)
    cards.splice(
      0,
      cards.length,
      ...(nlh
        ? [c('A', 'spades'), c('K', 'spades')]
        : hilo
          ? [c('A', 'diamonds'), c('A', 'clubs'), c('2', 'diamonds'), c('3', 'hearts')]
          : [
              c('A', 'diamonds'),
              c('A', 'clubs'),
              c('K', 'diamonds'),
              c('Q', 'clubs'),
              ...(variant === 'plo4' ? [] : [c('J', 'hearts')]),
              ...(variant === 'plo6' ? [c('T', 'hearts')] : []),
            ])
    );
  const heroBet = node === 'three_bet' ? 2 : node === 'four_bet' ? 6 : 0;
  const oppBet =
    node === 'three_bet' ? 6 : node === 'four_bet' ? 20 : node === 'draw_checkraise' ? 20 : 0;
  const pot =
    node === 'three_bet' ? 10 : node === 'four_bet' ? 28 : node === 'draw_checkraise' ? 52 : 70;
  const hero = {
    seat: 1,
    user_id: 'hero',
    username: 'hero',
    stack: 194 * scale,
    bet: heroBet * scale,
    totalInvested: (pre ? heroBet : 15) * scale,
    cards,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  } as SeatPlayer;
  const opp = {
    ...hero,
    seat: 2,
    user_id: 'wide',
    username: 'wide',
    cards: [],
    stack: 180 * scale,
    bet: oppBet * scale,
    totalInvested: (pre ? oppBet + 2 : 15 + oppBet) * scale,
  };
  const action = (userId: string, action: string, amount: number, stage = 'preflop') =>
    ({
      userId,
      seat: userId === 'hero' ? 1 : 2,
      action,
      amount: amount * scale,
      stage,
      timestamp: 1,
      isFullRaise: action === 'raise',
    }) as ActionRecord;
  const history =
    node === 'three_bet'
      ? [action('wide', 'raise', 6)]
      : node === 'four_bet'
        ? [action('hero', 'raise', 6), action('wide', 'raise', 20)]
        : [
            action('hero', 'raise', 6),
            action('wide', 'call', 6),
            action('hero', 'check', 0, 'flop'),
            action('wide', 'bet', 20, 'flop'),
          ];
  const gs = {
    players: [hero, opp],
    communityCards: pre
      ? []
      : node === 'river'
        ? [...board, c('Q', 'clubs'), c('7', 'clubs')]
        : board,
    pot: pot * scale,
    currentBet: oppBet * scale,
    minRaise: (oppBet || 2) * scale,
    lastRaise: (oppBet || 2) * scale,
    stage: pre ? 'preflop' : node === 'river' ? 'river' : 'flop',
    gameVariant: variant,
    gameMode: 'cash',
    format: 'cash',
    asset: 'chips',
    stateSchemaVersion: 1,
    heroSeat: 1,
    currentPlayerSeat: 1,
    dealerSeat: 2,
    dealtSeatIds: [1, 2],
    boardCount: 1,
    smallBlind: scale,
    bigBlind: 2 * scale,
    ante: 2 * scale,
    bigBlindAnte: true,
    chipUnit: 0.01,
    bombPot: false,
    allInOrFold: false,
    straddleActive: false,
    actionHistory: history,
    legalActions:
      oppBet > heroBet ? ['fold', 'call', 'raise', 'all_in'] : ['check', 'bet', 'all_in'],
    toCall: (oppBet - heroBet) * scale,
    minRaiseTo: (oppBet * 2 || 2) * scale,
    maxRaiseTo: (nlh ? 194 : oppBet + pot + (oppBet - heroBet)) * scale,
    bettingStructure: nlh ? 'no_limit' : 'pot_limit',
    pots: [],
    rakeConfig: { percent: 5, cap: 6 * scale, noFlopNoDrop: true },
    bbjConfig: { enabled: false, feeBB: 0, minPotBB: 10, minPlayersDealt: 3 },
  } as HorseGameStateV2;
  if (node === 'river')
    gs.actionHistory = [
      action('hero', 'raise', 6),
      action('wide', 'call', 6),
      action('hero', 'bet', 8, 'flop'),
      action('wide', 'call', 8, 'flop'),
      action('hero', 'bet', 20, 'turn'),
      action('wide', 'call', 20, 'turn'),
      action('wide', 'check', 0, 'river'),
    ];
  return { hero, gs };
}
function decision(variant: string, node: Node, scale: number, seed: number) {
  const { hero, gs } = state(variant, node, scale),
    sandbox = HorseMind.createSandbox();
  sandbox.exploit.set(readScopeOf(variant, 2) + '|wide', {
    ...freshExploitCounters(),
    hands: 100,
    vpip: 90,
    pfr: 80,
    rfiOpp: 80,
    rfi: 70,
    threeBetOpp: 60,
    threeBet: 40,
    betCheckedToOpp: 100,
    betCheckedTo: 80,
    foldToBetOpp: 100,
    foldToBet: 55,
    fHands: 20,
    fPfr: 16,
    fRfiOpp: 16,
    fRfi: 14,
    fThreeBetOpp: 12,
    fThreeBet: 8,
    fBetCheckedToOpp: 20,
    fBetCheckedTo: 16,
    fFoldToBetOpp: 20,
    fFoldToBet: 11,
  });
  seedFastRandom(seed);
  return HorseMind.runInSandbox(sandbox, () => {
    HorseMind.setDecisionScope(readScopeOf(variant, 2), variant, 'cash');
    expect(HorseMind.opponentRead('wide')?.stats.pfr.engaged).toBe('high');
    return HorseLogic.decide(
      hero,
      gs,
      'balanced',
      {},
      { observeMind: false, decisionTimeMs: 1793000000000, telemetry: true }
    );
  });
}
describe('same public decision at scaled stakes', () => {
  it('PLO5 seed41 raises its actual nut combo draw despite the V40 made-class cap', () => {
    const { hero, gs } = state('plo5', 'draw_checkraise', 1);
    expect(hasStrongPressureDraw(hero.cards, gs.communityCards, 'plo5')).toBe(true);
    expect(omahaDrawQuality(hero.cards, gs.communityCards, false)).toMatchObject({
      nutFlushDraw: true,
      nutStraightOuts: 6,
      dominatedFlushDraw: false,
      nutty: true,
    });
    enableBrainTelemetry();
    drainFires();
    const d = decision('plo5', 'draw_checkraise', 1, 41);
    expect(d.action).toBe('raise');
    expect(d.amount).toBeGreaterThanOrEqual(gs.minRaiseTo!);
    expect(d.amount).toBeLessThanOrEqual(gs.maxRaiseTo!);
    const fires = drainFires();
    expect(fires.some((f) => f.feature === 'v40_omaha_pressure_cap' && f.fires > 0)).toBe(true);
    expect(fires.some((f) => f.feature === 'v53_pressure_strong_draw_band' && f.fires > 0)).toBe(
      true
    );
  });
  it('keeps a physically strong PLO5 draw in the existing bounded pressure mix after a made-class cap', () => {
    const seeds: number[] = [];
    for (let seed = 1; seed <= 128; seed++) {
      const d = decision('plo5', 'draw_checkraise', 1, seed);
      if (d.action === 'raise' || d.action === 'all_in') seeds.push(seed);
    }
    console.info('STRONG_DRAW_PRESSURE_SEEDS ' + JSON.stringify(seeds));
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.length).toBeLessThan(40);
  }, 90_000);
  it.each(['nlh', 'plo4', 'plo5', 'plo6', 'plo8'])(
    '%s keeps baseline aggression independent of chip denomination',
    (variant) => {
      const counts: Record<string, Record<string, number>> = {};
      for (const node of ['three_bet', 'four_bet', 'draw_checkraise', 'river'] as const)
        for (const seed of [31, 41, 53]) {
          const low = decision(variant, node, 1, seed),
            high = decision(variant, node, 2.5, seed);
          expect(high.action, `${node} seed${seed}`).toBe(low.action);
          const row = (counts[node] ??= {});
          row[low.action] = (row[low.action] ?? 0) + 1;
          if (low.amount !== undefined && high.amount !== undefined)
            expect(
              Math.abs(high.amount / 2.5 - low.amount),
              `${node} sizing seed${seed}`
            ).toBeLessThanOrEqual(1.01);
        }
      console.info(
        'STAKE_NORMALIZATION ' +
          JSON.stringify({
            variant,
            pairs: 12,
            reads: 'observed-pfr-high',
            low: '1/2',
            proportionalHigh: '2.5/5',
            counts,
          })
      );
    },
    90_000
  );
});
