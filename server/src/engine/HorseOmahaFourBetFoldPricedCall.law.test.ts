/**
 * LAW (omahaFourBetFoldPricedCall, default OFF; EMERG lane PREFLOP-UNCONTESTED 2026-11-20):
 * in PLO4/PLO5 cash, preflop, after hero's own raise, facing a 4-bet or more heads-up, the
 * node's final fold becomes the legal call only when the engine's priced call of a re-raise
 * (omahaReraisedCallPriced, with omahaReraisedCallPricingOf's inputs) is positive. It changes
 * only a fold, never raises, reads no identity, is admitted by the response validator only for
 * the exact chips owed, and is out of scope in PLO6, PLO8, tournaments, bomb pots, multi-board
 * hands, postflop, facing a 3-bet, without hero's own raise and multiway. HorseLogic registers
 * the pricing inputs and the rule is the outermost answer of wager_rules after the river floor.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card, HorseDecision } from '../types.js';
import {
  omahaFourBetFoldPricedCallAdmitsCall,
  omahaFourBetFoldPricedCallRule,
  omahaFourBetFoldPricedSpot,
  registerFourBetFoldPricing,
} from './HorseOmahaFourBetFoldPricedCall.js';
import type { OmahaReraisedCallPricing } from './HorseOmahaOopReraisedPot.js';
import { OPTION_SWITCH_RELEASE_DEFAULT_OFF } from './HorseOptionSwitch.js';
import { OMAHA_OPTION_GAME_SCOPE_OPTIONS } from './HorseOmahaOptionGameScope.js';

const c = (s: string): Card =>
  ({
    rank: s[0],
    suit: ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[s[1] as 'h'],
  }) as Card;
const STRONG = ['Ah', 'Ad', 'Kh', 'Qd', 'Jc'].map(c); // PLO5 aces double-suited: high equity vs any 4-bet range
const TRASH = ['7c', '2d', '3h', '8s', '4c'].map(c);

const pricing = (behind: number): OmahaReraisedCallPricing =>
  ({
    rate: 0.3,
    opportunities: 0,
    rateSource: 'population',
    inPosition: false,
    othersIn: 0,
    raiserBehind: behind,
    rakeFraction: 0,
    heroAlreadyRaised: true,
    heroInvested: 12,
  }) as OmahaReraisedCallPricing;

let behind = 400;
registerFourBetFoldPricing(() => pricing(behind));

function spot(over: Record<string, unknown> = {}, hole: Card[] = STRONG) {
  const hero = {
    seat: 1,
    user_id: 'h',
    username: 'h',
    stack: 480,
    bet: 12,
    totalInvested: 12,
    cards: hole,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  };
  const raiser = {
    seat: 4,
    user_id: 'r',
    username: 'r',
    stack: 400,
    bet: 36,
    totalInvested: 36,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: false,
  };
  const folded = [2, 3, 5, 6].map((s) => ({
    seat: s,
    user_id: 'f' + s,
    username: 'f',
    stack: 200,
    bet: s === 5 ? 1 : s === 6 ? 2 : 0,
    totalInvested: 0,
    cards: [],
    is_folded: true,
    is_all_in: false,
    is_sitting_out: false,
  }));
  const gs = {
    gameVariant: 'plo5',
    gameMode: 'cash',
    stage: 'preflop',
    bigBlind: 2,
    smallBlind: 1,
    boardCount: 1,
    pot: 51,
    toCall: 24,
    currentBet: 36,
    dealerSeat: 3,
    communityCards: [],
    legalActions: ['fold', 'call', 'raise'],
    players: [hero, raiser, ...folded],
    actionHistory: [
      { stage: 'preflop', seat: 4, action: 'raise' },
      { stage: 'preflop', seat: 1, action: 'raise' },
      { stage: 'preflop', seat: 4, action: 'raise' },
    ],
    ...over,
  };
  return { hero: hero as never, gs: gs as never };
}
const fold: HorseDecision = { action: 'fold', thinkTime: 1 };
const legal = (d: HorseDecision) => d;

describe('omahaFourBetFoldPricedCall', () => {
  it('is registered dark and scopable per game', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain('omahaFourBetFoldPricedCall');
    expect(OMAHA_OPTION_GAME_SCOPE_OPTIONS).toContain('omahaFourBetFoldPricedCall');
  });

  it('a fold facing a 4-bet after its own raise becomes the call for the exact chips owed when EV(call) > 0', () => {
    const { hero, gs } = spot();
    const s = omahaFourBetFoldPricedSpot(hero, gs);
    expect(s).not.toBeNull();
    expect(s!.priced.evCall).toBeGreaterThan(0);
    const out = omahaFourBetFoldPricedCallRule(fold, hero, gs, true, legal);
    expect(out.action).toBe('call');
    expect(out.amount).toBe(24);
    expect(omahaFourBetFoldPricedCallAdmitsCall(hero, gs, 24)).toBe(true);
    expect(omahaFourBetFoldPricedCallAdmitsCall(hero, gs, 25)).toBe(false);
  });

  it('keeps the fold when the priced call is not positive', () => {
    const { hero, gs } = spot({ pot: 51, toCall: 300, currentBet: 312 }, TRASH);
    expect(omahaFourBetFoldPricedSpot(hero, gs)).toBeNull();
    expect(omahaFourBetFoldPricedCallRule(fold, hero, gs, true, legal)).toBe(fold);
    expect(omahaFourBetFoldPricedCallAdmitsCall(hero, gs, 300)).toBe(false);
  });

  it('off, or any non-fold: the same object', () => {
    const { hero, gs } = spot();
    expect(omahaFourBetFoldPricedCallRule(fold, hero, gs, false, legal)).toBe(fold);
    for (const action of ['call', 'raise', 'all_in', 'check'] as const) {
      const d: HorseDecision = { action, amount: 30, thinkTime: 1 };
      expect(omahaFourBetFoldPricedCallRule(d, hero, gs, true, legal)).toBe(d);
    }
  });

  it('is out of scope in PLO6, PLO8, tournaments, bomb pots, two boards, postflop, facing a 3-bet, without its own raise, multiway', () => {
    const cases: Array<Record<string, unknown>> = [
      { gameVariant: 'plo6' },
      { gameVariant: 'plo8' },
      { gameMode: 'tournament' },
      { bombPot: true },
      { boardCount: 2 },
      { stage: 'flop' },
      {
        actionHistory: [
          { stage: 'preflop', seat: 1, action: 'raise' },
          { stage: 'preflop', seat: 4, action: 'raise' },
        ],
      },
      {
        actionHistory: [
          { stage: 'preflop', seat: 4, action: 'raise' },
          { stage: 'preflop', seat: 2, action: 'raise' },
          { stage: 'preflop', seat: 4, action: 'raise' },
        ],
      },
    ];
    for (const over of cases) {
      const { hero, gs } = spot(over);
      expect(omahaFourBetFoldPricedSpot(hero, gs)).toBeNull();
      expect(omahaFourBetFoldPricedCallRule(fold, hero, gs, true, legal)).toBe(fold);
    }
    const mw = spot();
    (mw.gs as { players: Array<{ seat: number; is_folded: boolean }> }).players.find(
      (p) => p.seat === 2
    )!.is_folded = false;
    expect(omahaFourBetFoldPricedSpot(mw.hero, mw.gs)).toBeNull();
  });

  it('reads no identity: marking players persons or Horses changes nothing', () => {
    const a = spot();
    const b = spot();
    for (const p of (a.gs as { players: Array<{ is_horse?: boolean }> }).players) p.is_horse = true;
    for (const p of (b.gs as { players: Array<{ is_horse?: boolean }> }).players)
      p.is_horse = false;
    expect(omahaFourBetFoldPricedSpot(a.hero, a.gs)?.priced.evCall).toEqual(
      omahaFourBetFoldPricedSpot(b.hero, b.gs)?.priced.evCall
    );
  });

  it('a short stack calls for its stack', () => {
    const { hero, gs } = spot();
    (hero as { stack: number }).stack = 20;
    const s = omahaFourBetFoldPricedSpot(hero, gs);
    expect(s).not.toBeNull();
    expect(s!.allIn).toBe(true);
    expect(s!.paid).toBe(20);
  });

  it('HorseLogic registers the pricing inputs and the rule is the outermost answer of wager_rules', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'HorseLogic.ts'),
      'utf8'
    );
    expect(src).toContain(
      'registerFourBetFoldPricing((player, gs, raiser, toCall, stack, heroBet) =>'
    );
    const rule = src.indexOf('omahaFourBetFoldPricedCallRule(\n        nutsFloored');
    expect(rule).toBeGreaterThan(
      src.indexOf('const nutsFloored = omahaRiverCurrentNutsCallFloorRule(')
    );
    expect(src.indexOf('return { decision: fourBetPriced };')).toBeGreaterThan(rule);
    expect(src.indexOf("decision = graph.run('wager_rules'")).toBeGreaterThan(rule);
  });
});
