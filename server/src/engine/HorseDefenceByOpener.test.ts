/**
 * V72 GTO DEFENCE BY OPENER POSITION (Dan 2026-10-31): "LETS GET THIS MOVING
 * ONTO THE NEXT PHASES ... AUDIT AND IMPROVE ... BASED ON GTO".
 *
 * Every frequency here is measured end to end through HorseLogic.decide facing
 * a single open with nobody in (every graph owner after the preflop reference
 * included), combo-weighted over the 169 classes, with the dealt census set as
 * the live engine sets it. See
 * docs/changelog/2026-10-31-v72-defence-by-opener-position.md.
 */
import { describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import {
  DEFEND_TARGET,
  DEFEND_TARGET_IP,
  defenceContinueOrder,
  defenceTargets,
  gtoDefence,
  V72_BLUFF_TRIM,
  type DefenceSpot,
} from './HorseGtoDefenceRanges.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANKS = 'AKQJT98765432'.split('');
const BB = 2;
const SEEDS = 8;

type Ctx = {
  seats: number;
  stackBB: number;
  mode: 'cash' | 'tournament';
  ante: boolean;
  openBB: number;
};
const CASH6: Ctx = { seats: 6, stackBB: 100, mode: 'cash', ante: false, openBB: 2.5 };
const CASH9: Ctx = { seats: 9, stackBB: 100, mode: 'cash', ante: false, openBB: 2.5 };
const MTT9: Ctx = { seats: 9, stackBB: 50, mode: 'tournament', ante: true, openBB: 2.2 };

function holeFor(cls: string, s: number): Card[] {
  const su = (s * 3) % 4;
  const suited = cls.length === 3 && cls[2] === 's';
  const s2 = suited ? su : (su + 1 + (s % 3)) % 4;
  return [{ rank: cls[0], suit: SUITS[su] } as Card, { rank: cls[1], suit: SUITS[s2] } as Card];
}

/** Seat numbers: SB 1, BB 2, first to act 3, ..., button = seats. */
function stateFor(
  ctx: Ctx,
  heroSeat: number,
  openerSeat: number,
  hole: Card[],
  flipLabels = false
): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const n = ctx.seats;
  const used = new Set(hole.map((h) => h.rank + h.suit));
  const deck: Card[] = [];
  for (const r of RANKS)
    for (const su of SUITS) if (!used.has(r + su)) deck.push({ rank: r, suit: su } as Card);
  const openTo = ctx.openBB * BB;
  const players: SeatPlayer[] = [];
  for (let seat = 1; seat <= n; seat++) {
    const blind = seat === 1 ? 1 : seat === 2 ? 2 : 0;
    const bet = seat === openerSeat ? openTo : blind;
    const ante = seat === 2 && ctx.ante ? 2 : 0;
    players.push({
      seat,
      user_id: `def-${seat}`,
      username: `Def${seat}`,
      stack: ctx.stackBB * BB - bet - ante,
      bet,
      totalInvested: bet + ante,
      cards: seat === heroSeat ? hole : [deck[seat * 2], deck[seat * 2 + 1]],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: flipLabels ? seat === heroSeat : true,
    } as SeatPlayer);
  }
  const history: ActionRecord[] = [];
  let ts = 100;
  const actOrder = [...Array(n - 2).keys()].map((k) => 3 + k).concat([1, 2]);
  for (const seat of actOrder) {
    if (seat === heroSeat) break;
    const p = players[seat - 1];
    if (seat === openerSeat) {
      history.push({
        seat,
        userId: p.user_id,
        action: 'raise',
        amount: openTo,
        timestamp: ts++,
        stage: 'preflop',
        isFullRaise: true,
      } as ActionRecord);
      continue;
    }
    p.is_folded = true;
    history.push({
      seat,
      userId: p.user_id,
      action: 'fold',
      amount: 0,
      timestamp: ts++,
      stage: 'preflop',
    } as ActionRecord);
  }
  const gs = {
    players,
    communityCards: [],
    pot: 3 + openTo + (ctx.ante ? 2 : 0) - (openerSeat === 1 ? 1 : 0),
    currentBet: openTo,
    minRaise: openTo - 2,
    lastRaise: openTo - 2,
    stage: 'preflop',
    gameVariant: 'nlh',
    bigBlind: BB,
    dealerSeat: n,
    actionHistory: history,
    gameMode: ctx.mode,
    ante: ctx.ante ? 2 : 0,
    bigBlindAnte: ctx.ante,
    format: ctx.mode === 'cash' ? 'cash' : 'mtt',
    dealtSeatIds: players.map((p) => p.seat),
    ...(ctx.mode === 'tournament'
      ? {
          tournament: {
            schemaVersion: 1,
            contextStatus: 'complete',
            contextIssues: [],
            playersLeft: 180,
            spotsPaid: 30,
            entrants: 300,
            avgStackChips: ctx.stackBB * BB,
            medianStackChips: ctx.stackBB * BB,
            seatsPerTable: n,
            playersAtTable: n,
            nearBubble: false,
            inMoney: false,
            payoutPct: [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
            currentSmallBlind: 1,
            currentBigBlind: 2,
            currentAnte: 2,
            anteType: 'big_blind',
            nextSmallBlind: 2,
            nextBigBlind: 4,
            nextAnte: 4,
            nextBlindInMin: 10,
          },
        }
      : {}),
  } as unknown as HorseGameStateV2;
  return { hero: players[heroSeat - 1], gs };
}

type Mix = { call: number; threeBet: number; total: number; byClass: Map<string, number> };

function defend(
  ctx: Ctx,
  heroSeat: number,
  openerSeat: number,
  opts: Record<string, unknown> = {},
  flipLabels = false
): Mix {
  let call = 0;
  let raise = 0;
  const byClass = new Map<string, number>();
  for (const h of HAND_CLASSES) {
    let cont = 0;
    for (let s = 0; s < SEEDS; s++) {
      const { hero, gs } = stateFor(ctx, heroSeat, openerSeat, holeFor(h.cls, s), flipLabels);
      seedFastRandom((s + 1) * 7919 + heroSeat * 104729 + openerSeat * 7 + h.cls.charCodeAt(0));
      const d = HorseLogic.decide(
        hero,
        gs,
        'balanced',
        {} as never,
        {
          mind: false,
          telemetry: false,
          ...opts,
        } as never
      );
      if (d.action === 'call') {
        call += h.combos / SEEDS;
        cont++;
      } else if (d.action === 'raise' || d.action === 'all_in' || d.action === 'bet') {
        raise += h.combos / SEEDS;
        cont++;
      }
    }
    byClass.set(h.cls, cont / SEEDS);
  }
  const c = (100 * call) / 1326;
  const r = (100 * raise) / 1326;
  return { call: c, threeBet: r, total: c + r, byClass };
}

// 6-max seats: UTG 3, HJ 4, CO 5, BTN 6, SB 1, BB 2.
const OFF = { v72DefenceByOpener: false };

describe('V72 reference base (module)', () => {
  const spot = (over: Partial<DefenceSpot>): DefenceSpot => ({
    defender: 'bb',
    openerBehind: 2,
    defenderBehind: 0,
    ante: false,
    openToBB: 2.5,
    ...over,
  });

  it('the big blind and small blind widths shrink monotonically as the opener moves earlier', () => {
    for (const key of ['cash', 'ante'] as const) {
      for (const d of ['bb', 'sb'] as const) {
        const t = DEFEND_TARGET[key][d];
        const ks = Object.keys(t)
          .map(Number)
          .filter((k) => k >= 2)
          .sort((a, b) => a - b);
        for (let i = 1; i < ks.length; i++) {
          expect(t[ks[i]].cont).toBeLessThan(t[ks[i - 1]].cont);
          expect(t[ks[i]].threeBet).toBeLessThanOrEqual(t[ks[i - 1]].threeBet);
        }
      }
      const ip = DEFEND_TARGET_IP[key];
      for (let k = 4; k <= 8; k++) expect(ip[k].cont).toBeLessThan(ip[k - 1].cont);
    }
  });

  it('a bigger open is defended narrower, a smaller one wider', () => {
    const base = defenceTargets(spot({}));
    const big = defenceTargets(spot({ openToBB: 3.5 }));
    const small = defenceTargets(spot({ openToBB: 2 }));
    expect(big.cont).toBeLessThan(base.cont - 5);
    expect(small.cont).toBeGreaterThan(base.cont + 3);
    // The reference 3-bet width, with the bluff part trimmed (V72_BLUFF_TRIM).
    expect(base.value + base.bluff / V72_BLUFF_TRIM).toBeCloseTo(13, 5);
  });

  it('every continue order is a permutation of the 169 classes', () => {
    for (const d of ['bb', 'sb', 'ip'] as const)
      for (let k = 1; k <= 8; k++) {
        const order = defenceContinueOrder(d, k);
        expect(new Set(order).size).toBe(169);
      }
  });

  it("membership follows the opener: the big blind's continue range depends on the opener seat", () => {
    // Combo share (percent) ranked ahead of the class on the order.
    const combos = Object.fromEntries(HAND_CLASSES.map((h) => [h.cls, h.combos]));
    const shareAt = (k: number, cls: string) => {
      const order = defenceContinueOrder('bb', k);
      let cum = 0;
      for (const c of order) {
        if (c === cls) return (100 * cum) / 1326;
        cum += combos[c];
      }
      return 100;
    };
    // Offsuit kings and connected offsuit cards are inside the button's
    // continue width and outside the lojack's.
    const contBtn = defenceTargets(spot({ openerBehind: 2 })).cont;
    const contLj = defenceTargets(spot({ openerBehind: 5 })).cont;
    for (const cls of ['K5o', 'T8o', 'Q8o', '87o']) {
      expect(shareAt(2, cls)).toBeLessThan(contBtn - 2);
      expect(shareAt(5, cls)).toBeGreaterThan(contLj);
    }
    // Small pairs and suited connectors defend the lojack too.
    for (const cls of ['22', '65s', '54s']) expect(shareAt(5, cls)).toBeLessThan(30);
  });

  it('the bluff mix fills the bluff width and never touches non-chart classes', () => {
    const s = spot({});
    const t = defenceTargets(s);
    let bluffCombos = 0;
    for (const h of HAND_CLASSES) {
      const [a, b] = holeFor(h.cls, 0);
      const d = gtoDefence(a, b, s)!;
      bluffCombos += d.bluffProb * h.combos;
      if (['72o', 'AA', 'KK', '32o'].includes(h.cls)) expect(d.bluffProb).toBe(0);
    }
    expect((100 * bluffCombos) / 1326).toBeCloseTo(t.bluff, 0);
  });
});

describe('V72 defence end to end (cash 6-max 100bb, 2.5x open, balanced)', () => {
  const bbVs = {
    utg: defend(CASH6, 2, 3),
    hj: defend(CASH6, 2, 4),
    co: defend(CASH6, 2, 5),
    btn: defend(CASH6, 2, 6),
  };

  it('the big blind defends by the opener seat, in the solver bands', () => {
    expect(bbVs.btn.total).toBeGreaterThan(54);
    expect(bbVs.btn.total).toBeLessThan(65);
    expect(bbVs.btn.threeBet).toBeGreaterThan(8);
    expect(bbVs.btn.threeBet).toBeLessThan(15);
    expect(bbVs.utg.total).toBeGreaterThan(30);
    expect(bbVs.utg.total).toBeLessThan(40);
    expect(bbVs.utg.threeBet).toBeLessThan(bbVs.btn.threeBet - 2);
  });

  it('every opener seat changes the answer, earlier seats defended narrower', () => {
    expect(bbVs.hj.total).toBeGreaterThan(bbVs.utg.total + 3);
    expect(bbVs.co.total).toBeGreaterThan(bbVs.hj.total + 3);
    expect(bbVs.btn.total).toBeGreaterThan(bbVs.co.total + 5);
  });

  it('the off arm keeps the five-bucket defence (CO and BTN identical, UTG and HJ identical)', () => {
    const offCo = defend(CASH6, 2, 5, OFF);
    const offBtn = defend(CASH6, 2, 6, OFF);
    expect(Math.abs(offCo.total - offBtn.total)).toBeLessThan(0.5);
    const offUtg = defend(CASH6, 2, 3, OFF);
    const offHj = defend(CASH6, 2, 4, OFF);
    expect(Math.abs(offUtg.total - offHj.total)).toBeLessThan(0.5);
  });

  it('defends the button with suited and connected hands the legacy ladder folded', () => {
    for (const cls of ['K5s', '86s', '75s', '64s', 'T8o']) {
      expect(bbVs.btn.byClass.get(cls)!).toBeGreaterThanOrEqual(0.5);
    }
    for (const cls of ['K5o', 'T8o', 'Q6o']) expect(bbVs.utg.byClass.get(cls)!).toBeLessThan(0.5);
    for (const cls of ['22', '65s', '76s'])
      expect(bbVs.utg.byClass.get(cls)!).toBeGreaterThanOrEqual(0.5);
  });

  it('a 3x open is defended narrower than a 2.5x open', () => {
    const big = defend({ ...CASH6, openBB: 3 }, 2, 6);
    expect(big.total).toBeLessThan(bbVs.btn.total - 1.5);
  });

  it('the small blind plays 3-bet-or-fold against a steal and tighter against UTG', () => {
    const sbBtn = defend(CASH6, 1, 6);
    const sbUtg = defend(CASH6, 1, 3);
    expect(sbBtn.threeBet).toBeGreaterThan(8);
    expect(sbBtn.call).toBeLessThan(sbBtn.threeBet);
    expect(sbUtg.total).toBeLessThan(sbBtn.total - 4);
  });

  it('the button defends a cutoff open wider than an under-the-gun open', () => {
    const btnCo = defend(CASH6, 6, 5);
    const btnUtg = defend(CASH6, 6, 3);
    expect(btnCo.total).toBeGreaterThan(15);
    expect(btnCo.total).toBeLessThan(23);
    expect(btnUtg.total).toBeLessThan(btnCo.total - 3);
  });

  it('who the players are never changes the defence', () => {
    const flipped = defend(CASH6, 2, 6, {}, true);
    expect(flipped.total).toBeCloseTo(bbVs.btn.total, 6);
    expect(flipped.threeBet).toBeCloseTo(bbVs.btn.threeBet, 6);
  });
});

describe('V72 defence at the full ring and with a big blind ante', () => {
  it('nine-handed UTG is defended narrower than the six-handed UTG (the 9-max lojack)', () => {
    const utg9 = defend(CASH9, 2, 3);
    const lj9 = defend(CASH9, 2, 6);
    expect(utg9.total).toBeLessThan(lj9.total - 4);
    expect(utg9.total).toBeGreaterThan(24);
    expect(utg9.total).toBeLessThan(34);
  });

  it('MTT 9-max 50bb with a big blind ante defends the button wide and UTG far narrower', () => {
    const btn = defend(MTT9, 2, 9);
    const utg = defend(MTT9, 2, 3);
    expect(btn.total).toBeGreaterThan(66);
    expect(btn.total).toBeLessThan(82);
    expect(utg.total).toBeGreaterThan(38);
    expect(utg.total).toBeLessThan(56);
    expect(btn.total).toBeGreaterThan(utg.total + 15);
  });
});
