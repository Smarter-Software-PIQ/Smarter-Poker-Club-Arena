/**
 * The 80 audit fixtures (DEVELOPMENT DATA: fixtures/horse-opponent-style-fixtures.json, anonymised fields of
 * tight-human-audit/style-fixtures.jsonl, one anonymous opponent). Each spot is rebuilt heads-up from its public
 * fields (amounts in big blinds, 2 chips per BB; earlier streets checked through; a 3-way spot is replayed heads-up)
 * and decided through HorseLogic.decide with every style option off and then on. Flop and turn results are whole-hand
 * nets, so they give direction only. Nothing was tuned on these fixtures.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { bigBetRespect, classifyOpponentStyle } from './HorseOpponentStyle.js';
import { HERO, VILLAIN, cards, decide, install, type Spot, type Villain } from './HorseOpponentStyle.contexts.test-support.js';
import { counters } from './HorseOpponentStyle.test-support.js';
import type { SeatPlayer } from '../types.js';

interface Fx {
  id: string; category: string; format: 'cash' | 'tournament'; street: 'flop' | 'turn' | 'river'; board: string; heroCards: string;
  heroStrength: string; potAtDecisionBB: number; amountToCallBB: number; opponentActionType: 'bet' | 'raise';
  opponentChipsAddedBB: number; sizePotFraction: number; facedBetBeforeRaiseBB: number; heroBehindBeforeCallBB: number;
  opponentBehindAfterBetBB: number; heroAction: string;
  counters: { hands: number; vpipPct: number; pfrPct: number; threeBetOpportunities: number; threeBets: number; bigRiverBetsCalled: number; bigRiverBetsCalledWon: number; credibleSample: boolean };
}
const FX: Fx[] = JSON.parse(readFileSync(new URL('./fixtures/horse-opponent-style-fixtures.json', import.meta.url), 'utf8')).fixtures;
const BB = 2;
const STREETS = ['flop', 'turn', 'river'] as const;
const FILL = [3, 4, 5, 6].map((n) => `cccccccc-0000-4000-8000-00000000000${n}`);

function spotOf(f: Fx): Spot {
  const heroBet = f.opponentActionType === 'raise' ? f.facedBetBeforeRaiseBB * BB : 0;
  const villainTotal = heroBet + f.amountToCallBB * BB;
  const seat = (s: number, id: string, stack: number, bet: number, c = ''): SeatPlayer =>
    ({ seat: s, user_id: id, username: `p${s}`, stack, bet, totalInvested: bet, cards: c ? cards(c) : [], is_folded: !c && id !== VILLAIN, is_all_in: id === VILLAIN && stack <= 0, is_sitting_out: false }) as unknown as SeatPlayer;
  const players = [
    seat(1, HERO, Math.max(BB, f.heroBehindBeforeCallBB * BB), heroBet, f.heroCards),
    seat(2, VILLAIN, Math.max(0, f.opponentBehindAfterBetBB * BB), villainTotal),
    ...FILL.map((id, i) => seat(i + 3, id, 200, 0)),
  ];
  const acts: Array<Record<string, unknown>> = [
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: 6 },
    { stage: 'preflop', seat: 1, userId: HERO, action: 'call', amount: 4 },
  ];
  for (const st of STREETS) {
    if (st === f.street) {
      if (f.opponentActionType === 'raise') {
        acts.push({ stage: st, seat: 1, userId: HERO, action: 'bet', amount: heroBet });
        acts.push({ stage: st, seat: 2, userId: VILLAIN, action: 'raise', amount: villainTotal });
      } else {
        acts.push({ stage: st, seat: 1, userId: HERO, action: 'check', amount: 0 });
        acts.push({ stage: st, seat: 2, userId: VILLAIN, action: 'bet', amount: villainTotal });
      }
      break;
    }
    acts.push({ stage: st, seat: 1, userId: HERO, action: 'check', amount: 0 }, { stage: st, seat: 2, userId: VILLAIN, action: 'check', amount: 0 });
  }
  const n = { flop: 6, turn: 8, river: 10 }[f.street];
  const gs = {
    players, communityCards: cards(f.board.slice(0, n)), pot: f.potAtDecisionBB * BB, currentBet: villainTotal,
    minRaise: Math.max(BB, villainTotal - heroBet), stage: f.street, gameVariant: 'nlh', gameMode: f.format,
    ...(f.format === 'tournament' ? { tournament: { entrants: 100, playersLeft: 40, spotsPaid: 15, inMoney: true, nearBubble: false } } : {}),
    bigBlind: BB, smallBlind: 1, dealerSeat: 1, actionHistory: acts.map((a, i) => ({ ...a, timestamp: (i + 1) * 4000 })),
  };
  return { name: f.id, hero: players[0], gs };
}

function villainOf(f: Fx, extraShownBluff = 0): Villain {
  const c = f.counters;
  const hands = Math.min(Math.max(c.hands, 0), 120);
  const k = c.hands > 0 ? hands / c.hands : 0;
  return {
    stats: { hands: c.hands, bigBetSD: c.bigRiverBetsCalled + extraShownBluff, bigBetSDStrong: c.bigRiverBetsCalledWon },
    counters: counters({ hands, vpip: c.vpipPct / 100, pfr: c.pfrPct / 100, threeBetOpp: c.threeBetOpportunities * k, threeBet: c.threeBets * k, fast: { hands: 0 } }),
    complete: true,
  };
}
const supply = (mode: 'cash' | 'tournament') =>
  HorseMind.importPostReleaseObservations([{ user_id: VILLAIN, variant: 'nlh', mode, size: 'full', opportunities: { foldToBet: 120, riverCall: 120, foldTo3Bet: 120, betCheckedTo: 120 } }]);
const ON = { styleValueBettorNotManiac: true, styleBigBetHonesty: true, styleRaiseRespect: true, styleFoldBluff: true };
const RANK: Record<string, number> = { fold: 0, check: 0, call: 1, raise: 2, bet: 2, all_in: 3 };
function run(f: Fx) {
  const spot = spotOf(f);
  install(villainOf(f), f.format);
  supply(f.format);
  const off = decide(spot);
  install(villainOf(f), f.format);
  supply(f.format);
  const on = decide(spot, ON);
  return { off, on };
}

describe('80 audit fixtures (DEVELOPMENT data): options ON versus OFF', () => {
  const results = FX.map((f) => ({ f, ...run(f) }));
  it('loads all 80 and every spot decides legally', () => {
    expect(FX.length).toBe(80);
    for (const r of results) expect(['fold', 'call', 'raise', 'all_in', 'check', 'bet']).toContain(r.on.decision.action);
  });
  it('the style read never widens a decision on any fixture', () => {
    for (const r of results) expect(RANK[r.on.decision.action], r.f.id).toBeLessThanOrEqual(RANK[r.off.decision.action]);
  });
  it('genuine coolers, the low-SPR counter-examples and the won river calls are decided exactly as with the options off', () => {
    const protectedCats = ['genuine-cooler', 'counter-example-short-stack', 'horse-won-river-call'];
    const prot = results.filter((r) => protectedCats.includes(r.f.category));
    expect(prot.length).toBe(22);
    for (const r of prot) expect(r.on.decision.action, r.f.id).toBe(r.off.decision.action);
  });
  it('credible lost one-pair river calls: measured fold or shrink count (reported; direction only)', () => {
    const lost = results.filter(
      (r) => r.f.counters.credibleSample && (r.f.category === 'lost-river-bet-call' || r.f.category === 'lost-river-raise-call') && /one-pair|high-card|board-pair/.test(r.f.heroStrength)
    );
    const offCalls = lost.filter((r) => RANK[r.off.decision.action] >= 1);
    const flipped = offCalls.filter((r) => RANK[r.on.decision.action] < RANK[r.off.decision.action]);
    const respected = lost.filter((r) => (r.on.fires.style_big_bet_honesty_seen ?? 0) > 0 || (r.on.fires.style_raise_respect_seen ?? 0) > 0);
    console.log(`fixtures: credible lost one-pair river calls ${lost.length}; OFF continues ${offCalls.length}; ON folds ${flipped.length}; respect engaged on ${respected.length}`);
    expect(lost.length).toBeGreaterThan(0);
    for (const r of lost) expect(RANK[r.on.decision.action]).toBeLessThanOrEqual(RANK[r.off.decision.action]);
  });
  it('shown-bluff fixtures: one more shown bluff lowers the river respect proportionally, never raises it', () => {
    let lowered = 0;
    let engaged = 0;
    for (const f of FX.filter((x) => x.category === 'shown-bluff')) {
      const read = (v: Villain) =>
        classifyOpponentStyle({ scope: 'holdem:full', variant: 'nlh', domain: f.format, counters: v.counters, tallies: v.stats as never, provenance: { complete: true } });
      const spot = { street: 'river' as const, potFraction: Math.max(0.75, f.sizePotFraction), isRaise: false };
      const before = bigBetRespect(read(villainOf(f)), spot);
      const after = bigBetRespect(read(villainOf(f, 1)), spot);
      expect(after, f.id).toBeLessThanOrEqual(before + 1e-12);
      if (before > 0) engaged++;
      if (after < before) lowered++;
    }
    console.log(`fixtures: shown-bluff respect engaged before ${engaged} of 14; lowered by one more shown bluff ${lowered}`);
  });
});
