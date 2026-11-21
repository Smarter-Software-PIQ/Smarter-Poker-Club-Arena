/**
 * LAW (E7 — PLO6 River Defence and Six-Card Current-Nuts Call Floor, 2026-11-20,
 * PLO6 lane; wired under plo6FacingBetIsPriced, default OFF, read `=== true`):
 *
 * Measured across all 270 PLO6 cash river facing-bet decisions and 387 PLO6
 * river wagers in the 48 h human-table dataset (opponent six-card holdings
 * from facts.json):
 *   - Multiway PLO6 river first bets had only 3.5% non-value holdings (`u >= 0.5`:
 *     3/85 vs 16.0% heads-up, 41/256), and 29/29 PLO6 river raises had 0.0% bluffs.
 *
 * Four load-bearing E7 invariants (each fails when E7 is removed):
 *   1. Joint six-card multiway river field (`plo6MultiwayRiverVerdict`):
 *      dominated multiway river hands (#59947932 two-pair in 4-way pot,
 *      #59970374 wheel straight on 3-spade board, #60069439 underboat `22` on
 *      `A922A` in 4-way pot) fold instead of calling on `HorseOmahaFacingBetEv`'s
 *      independent four-card `1 - 0.25 * beaten` factor, while profitable
 *      multiway flushes (#60074744, #59968843) call.
 *   2. Six-card river value-domination fold guard (`plo6RiverFoldGuardStands`):
 *      a river raise against a non-nut boat (#59974302 AA boat on `69222`) or
 *      a non-flush two-pair on a three-flush river (#59973046, `beaten = 0.781`,
 *      `vsValue = 0.109`, `E = 0.041`) is barred (`riverFoldGuardStands === true`),
 *      while near-nut flushes and straights (#59974054, #59972261) pass and call.
 *   3. Exact six-card current-nuts river call floor (`plo6RiverCurrentNutsCallSpot`):
 *      when hero holds the exact unbeatable six-card river nuts (`hasRiverNuts`)
 *      and `(pot + paid) / (live + 1) >= paid`, `plo6FacingBetIsPriced` NEVER
 *      folds on any river board, and `horseDecisionReceiptRefusal` admits the call.
 *   4. Nut-end standing river raise preservation & standing call protection:
 *      when hero holds private unbeatable river nuts (#59962430 quads Aces) or
 *      a top-2% river monster (#59973676 nut straight, #59974331 top `KK` boat),
 *      `plo6FacingBetIsPricedRule` NEVER flattens a standing river jam to a
 *      call/min-raise; and a standing heads-up river call with `vsValue >= 0.20`
 *      (#60091132 winning flush) is preserved while dominated river calls
 *      (#59973335 `vsValue = 0.091`) still fold by price.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HorseLogic, plo6FacingBetPricedVerdictOf, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { scoreOmahaHi, seedFastRandom } from './HorseEval.js';
import { RANKS, SUITS } from './PokerEngine.js';
import { hasRiverNuts } from './HorseRiverNuts.js';
import { omahaFacingBetEvSpot, omahaFacingBetEvVerdict } from './HorseOmahaFacingBetEv.js';
import {
  plo6HasPrivateRiverNuts,
  plo6MultiwayRiverVerdict,
  plo6RiverCurrentNutsCallSpot,
  plo6RiverFoldGuardStands,
  plo6RiverStandingCallHolds,
} from './HorsePlo6RiverDefence.js';
import {
  actionKind,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';

const FIXTURE = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'Plo6FacingBetIsPriced.fixture.json'),
    'utf8'
  )
) as { hands: { hand: ExtractedHand; ords: number[]; ids: Record<string, string> }[] };

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 7, 42];
const ON: HorseDecideOpts = { plo6FacingBetIsPriced: true };

const card = (s: string): Card => {
  const map: Record<string, Card['suit']> = {
    c: 'clubs',
    d: 'diamonds',
    h: 'hearts',
    s: 'spades',
  };
  return { rank: s[0] as Card['rank'], suit: map[s[1]]! };
};
const cards = (spec: string): Card[] => spec.trim().split(/\s+/).map(card);
const key = (c: Card) => `${c.rank}:${c.suit}`;

function byHand(handNumber: number): { hand: ExtractedHand; node: ComplaintAction } {
  const entry = FIXTURE.hands.find(
    (h) => Number((h.hand as unknown as { handNumber: number }).handNumber) === handNumber
  );
  if (!entry) throw new Error(`missing fixture hand ${handNumber}`);
  const ord = entry.ords[0]!;
  const node = entry.hand.actions.find((a) => (a as unknown as { ord: number }).ord === ord)!;
  return { hand: entry.hand, node };
}

function syntheticRiverState(opts: {
  hole: string;
  board: string;
  potBeforeCall: number;
  toCall: number;
  heroStack: number;
  bettorStack: number;
  heroBet?: number;
  behind?: number;
}): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const heroBet = opts.heroBet ?? 0;
  const behind = opts.behind ?? 0;
  const currentBet = heroBet + opts.toCall;
  const hero: SeatPlayer = {
    seat: 2,
    user_id: '00000000-0000-4000-8000-000000000002',
    name: 'hero',
    stack: opts.heroStack,
    bet: heroBet,
    totalInvested: 20 + heroBet,
    cards: cards(opts.hole),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  } as unknown as SeatPlayer;
  const bettor: SeatPlayer = {
    seat: 1,
    user_id: '00000000-0000-4000-8000-000000000001',
    name: 'bettor',
    stack: opts.bettorStack,
    bet: currentBet,
    totalInvested: 20 + currentBet,
    cards: [],
    is_folded: false,
    is_all_in: opts.bettorStack <= 0.005,
    is_sitting_out: false,
  } as unknown as SeatPlayer;
  const players: SeatPlayer[] = [bettor, hero];
  const history: NonNullable<HorseGameStateV2['actionHistory']> = [
    { userId: 'u1', seat: 1, stage: 'preflop', action: 'call', amount: 2, timestamp: 1 },
    { userId: 'u2', seat: 2, stage: 'preflop', action: 'check', amount: 0, timestamp: 2 },
  ];
  for (let i = 0; i < behind; i++) {
    const s = 3 + i;
    players.push({
      seat: s,
      user_id: `00000000-0000-4000-8000-00000000000${s}`,
      name: `behind${i}`,
      stack: opts.bettorStack,
      bet: 0,
      totalInvested: 20,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    } as unknown as SeatPlayer);
    history.splice(1, 0, {
      userId: `u${s}`,
      seat: s,
      stage: 'preflop',
      action: 'call',
      amount: 2,
      timestamp: 1,
    });
  }
  if (heroBet > 0) {
    history.push(
      { userId: 'u2', seat: 2, stage: 'river', action: 'bet', amount: heroBet, timestamp: 3 },
      { userId: 'u1', seat: 1, stage: 'river', action: 'raise', amount: currentBet, timestamp: 4 }
    );
  } else {
    history.push({
      userId: 'u1',
      seat: 1,
      stage: 'river',
      action: 'bet',
      amount: currentBet,
      timestamp: 3,
    });
  }
  const gs: HorseGameStateV2 = {
    gameVariant: 'plo6',
    gameMode: 'cash',
    bettingStructure: 'pot_limit',
    stage: 'river',
    boardCount: 1,
    bombPot: false,
    allInOrFold: false,
    wagersCapped: false,
    rakeConfig: { percent: 0, cap: 0 },
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: 2 + behind,
    pot: opts.potBeforeCall,
    currentBet,
    toCall: Math.min(opts.toCall, opts.heroStack),
    minRaiseTo: currentBet + opts.toCall,
    maxRaiseTo: Math.min(
      heroBet + opts.heroStack,
      heroBet + opts.toCall + opts.potBeforeCall + opts.toCall
    ),
    communityCards: cards(opts.board),
    players,
    legalActions:
      opts.heroStack <= opts.toCall ? ['fold', 'all_in'] : ['fold', 'call', 'raise', 'all_in'],
    actionHistory: history,
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

afterEach(() => {
  HorseMind.reset();
});

describe('LAW (E7): PLO6 river defence prices multiway rivers jointly, guards value-dominated spots, enforces the current-nuts floor, and protects nut raises', () => {
  it('folds dominated multiway river hands (#59970374 wheel on 3-spade river, #60069439 bottom underboat 4-way) that un-repaired 4-card field pricing calls', () => {
    // Recorded multiway trap d2121 (#59970374): wheel straight on 3-spade board 2s 5s 9h 4s Kd with 1 player behind (auditor equity 0.123 < price 0.251).
    const wheelOnFlush = syntheticRiverState({
      hole: 'Ad Ac 6c 3d Tc Jc',
      board: '2s 5s 9h 4s Kd',
      potBeforeCall: 98.5,
      toCall: 33,
      heroStack: 180,
      bettorStack: 180,
      behind: 1,
    });
    const rawSpot = omahaFacingBetEvSpot(wheelOnFlush.hero, wheelOnFlush.gs, { plo6Priced: true })!;
    const brokenFourCard = omahaFacingBetEvVerdict(
      rawSpot,
      wheelOnFlush.hero.cards,
      wheelOnFlush.gs.communityCards,
      [],
      null,
      { rake: 0, realization: 1, sixCardTurn: true }
    )!;
    // Without E7's joint six-card multiway river evaluator, HorseOmahaFacingBetEv calls!
    expect(brokenFourCard.call).toBe(true);

    const e7Mw = plo6MultiwayRiverVerdict(wheelOnFlush.hero, wheelOnFlush.gs, { rake: 0 }, rawSpot);
    expect(e7Mw).not.toBeNull();
    expect(e7Mw!.call).toBe(false);
    const v = plo6FacingBetPricedVerdictOf(wheelOnFlush.hero, wheelOnFlush.gs);
    expect(v).not.toBeNull();
    expect(v!.callPriced).toBe(false);
    expect(v!.action).toBe('fold');

    // Recorded profitable multiway flush #60074744 still calls!
    const { hand, node } = byHand(60074744);
    const st = stateAt(hand, node);
    const vGood = plo6FacingBetPricedVerdictOf(st.hero, st.gs);
    expect(vGood).not.toBeNull();
    expect(vGood!.callPriced).toBe(true);
    expect(vGood!.action).toBe('call');
  });

  it('enforces the six-card river value-domination guard on dominated 3-flush two-pair (#59973046) and river raises (#59974302) while calling #59974054 and #59972261', () => {
    // Recorded HU trap d2794 (#59973046): two-pair Aces & Threes on 3-flush board Qc 2h 3h 7c Jh (beaten 0.781, vsValue 0.109, true/auditor equity 0.041 < price 0.129).
    const domTwoPair = syntheticRiverState({
      hole: 'Kh Ac Td 2d As 3s',
      board: 'Qc 2h 3h 7c Jh',
      potBeforeCall: 236.7,
      toCall: 35.2,
      heroStack: 180,
      bettorStack: 180,
    });
    expect(plo6RiverFoldGuardStands(domTwoPair.hero, domTwoPair.gs)).toBe(true);
    const vDom = plo6FacingBetPricedVerdictOf(domTwoPair.hero, domTwoPair.gs);
    expect(vDom).not.toBeNull();
    expect(vDom!.riverFoldGuardStands).toBe(true);
    expect(vDom!.callPriced).toBe(false);
    expect(vDom!.action).toBe('fold');

    // Recorded river raise #59974302 (AA boat on 6d 9s 2c 2s 2h facing river raise -> quads value region, vsValue = 0): guard stands and folds!
    {
      const { hand, node } = byHand(59974302);
      const st = stateAt(hand, node);
      expect(plo6RiverFoldGuardStands(st.hero, st.gs)).toBe(true);
      const v = plo6FacingBetPricedVerdictOf(st.hero, st.gs);
      expect(v!.riverFoldGuardStands).toBe(true);
      expect(v!.action).toBe('fold');
    }

    // Recorded profitable HU river calls #59974054 and #59972261 pass the guard and call!
    for (const hn of [59974054, 59972261]) {
      const { hand, node } = byHand(hn);
      const st = stateAt(hand, node);
      expect(plo6RiverFoldGuardStands(st.hero, st.gs)).toBe(false);
      const v = plo6FacingBetPricedVerdictOf(st.hero, st.gs);
      expect(v!.riverFoldGuardStands).toBe(false);
      expect(v!.callPriced).toBe(true);
      expect(v!.action).toBe('call');
    }
  });

  it('never folds the exact six-card current river nuts when worst-case chop >= call, even facing a river raise', () => {
    const { hand, node } = byHand(59974302);
    const st = stateAt(hand, node);
    const board = st.gs.communityCards;
    const used = new Set(board.map(key));
    const deck: Card[] = [];
    for (const suit of SUITS)
      for (const rank of RANKS) if (!used.has(`${rank}:${suit}`)) deck.push({ rank, suit } as Card);
    let best: Card[] = [];
    let top = -1;
    for (let i = 0; i < deck.length; i++)
      for (let j = i + 1; j < deck.length; j++) {
        const sc = scoreOmahaHi([deck[i]!, deck[j]!], board);
        if (sc > top) {
          top = sc;
          best = [deck[i]!, deck[j]!];
        }
      }
    const taken = new Set(best.map(key));
    st.hero.cards = [...best, ...deck.filter((c) => !taken.has(key(c))).slice(0, 4)];
    st.hero.knownDeadCards = [];

    expect(hasRiverNuts(st.hero, st.gs, false)).toBe(true);
    const floorSpot = plo6RiverCurrentNutsCallSpot(st.hero, st.gs);
    expect(floorSpot).not.toBeNull();
    const v = plo6FacingBetPricedVerdictOf(st.hero, st.gs);
    expect(v).not.toBeNull();
    expect(v!.currentRiverNutsFloor).toBe(true);
    expect(v!.callPriced).toBe(true);
    expect(v!.action).not.toBe('fold');

    seedFastRandom(1);
    HorseMind.reset();
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, { mind: false, ...ON });
    expect(d.action).not.toBe('fold');
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo6', {
        player: st.hero,
        gameState: st.gs,
        plo6FacingBetIsPriced: true,
      })
    ).toBeNull();
  });

  it('preserves nut-end standing river jams (#59962430 quads Aces) and value-live standing river calls (#60091132) while folding dominated #59973335', () => {
    const quads = syntheticRiverState({
      hole: 'Jc Ac Qd 8d Ah 7s',
      board: 'As 8s Kh Jh Ad',
      potBeforeCall: 261,
      toCall: 30,
      heroStack: 110.75,
      bettorStack: 110.75,
    });
    expect(plo6HasPrivateRiverNuts(quads.hero, quads.gs)).toBe(true);
    for (const seed of SEEDS) {
      seedFastRandom(seed);
      HorseMind.reset();
      const off = HorseLogic.decide(quads.hero, quads.gs, LIVE.style, LIVE.mods, { mind: false });
      expect(['raise', 'all_in']).toContain(off.action);

      seedFastRandom(seed);
      HorseMind.reset();
      const on = HorseLogic.decide(quads.hero, quads.gs, LIVE.style, LIVE.mods, {
        mind: false,
        ...ON,
      });
      expect(['raise', 'all_in']).toContain(on.action);
      expect(
        horseDecisionReceiptRefusal(structuredClone(on), 'plo6', {
          player: quads.hero,
          gameState: quads.gs,
          plo6FacingBetIsPriced: true,
        })
      ).toBeNull();
    }

    // #60091132: Q-high flush with As blocker (vsValue = 0.250 >= 0.20) holds its standing river call!
    const liveFlush = syntheticRiverState({
      hole: 'Qs 6h Ac 4c 2s Jc',
      board: '9h 3d 6s 5s 8s',
      potBeforeCall: 55.82,
      toCall: 25.6,
      heroStack: 100,
      bettorStack: 100,
    });
    expect(plo6RiverStandingCallHolds(liveFlush.hero, liveFlush.gs)).toBe(true);

    // #59973335: dominated 4s full on 6-4-6-2-9 (vsValue = 0.091 < 0.20) does NOT hold its call — folds by price!
    const { hand, node } = byHand(59973335);
    const st = stateAt(hand, node);
    expect(plo6RiverStandingCallHolds(st.hero, st.gs)).toBe(false);
  });
});
