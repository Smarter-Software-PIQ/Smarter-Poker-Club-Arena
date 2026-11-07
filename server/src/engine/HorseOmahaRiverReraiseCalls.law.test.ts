/**
 * V84 OMAHA RIVER RE-RAISE CALL DISCIPLINE (2026-11-07). See
 * HorseOmahaBigBetCalls.ts (the V84 header) for the two-day decision-EV
 * evidence and docs/horse-measure/2026-11-07/v84-river-reraise-cells.txt.
 *
 *  1. Exactly the admitted cell: an unpaired-board second-nut flush, PLO4,
 *     PLO5 and PLO6, cash and tournament, only after the horse's own river
 *     wager and only facing a raise of 0.9 pot or more.
 *  2. End to end over many seeds: the horse never calls there; the V84 off
 *     arm is today's answer; the V81 switch does not touch it; the receipt
 *     fires; the fold is a valid signed receipt.
 *  3. Hand 3359656 (PLO6 tournament, Kd-high flush with no Ad on
 *     9d 7d 2d 4s 6s, bet 2,858 into 4,090, raised to 12,664): folds.
 *  4. Outside the cell the answer is exactly today.
 *  5. Label flips never change the answer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  omahaCallClass,
  v84Cell,
  v84HeroWageredStreet,
  type V84Input,
} from './HorseOmahaBigBetCalls.js';
import { horseDecisionReceiptIsValid } from './horseDecision/responseValidation.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  return out;
}
const VILLAIN = '10000000-0000-4000-8000-000000000084';
const FEATURE = 'v84_omaha_river_reraise_call_fold';

interface Spot {
  /** The pot when the river began. */
  potStart?: number;
  /** Hero's river bet, then the villain's raise-to. */
  bet?: number;
  raiseTo?: number;
  /** Both players' stacks when the river began. */
  heroStart?: number;
  villainStart?: number;
  /** Folded seats besides hero and villain (1 = a three-handed ring table). */
  folders?: number;
  flip?: boolean;
  mode?: 'cash' | 'tournament';
  bigBlind?: number;
  /** Hero checked and the villain bet (no own wager): V81's spot, not V84's. */
  heroChecked?: boolean;
}

/** Checked to the river; hero bets `bet` into `potStart`, the villain raises to `raiseTo`. */
function river(variant: string, hole: string, board: string, o: Spot = {}) {
  const potStart = o.potStart ?? 36;
  const bet = o.heroChecked ? 0 : (o.bet ?? 24);
  const raiseTo = o.raiseTo ?? 96;
  const heroStart = o.heroStart ?? 300;
  const villainStart = o.villainStart ?? 300;
  const folders = o.folders ?? 1;
  const pre = potStart / 2;
  const players: SeatPlayer[] = [
    {
      seat: 1,
      user_id: 'hero',
      username: 'h',
      stack: heroStart - bet,
      bet,
      totalInvested: pre + bet,
      cards: cards(hole),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer,
    {
      seat: 2,
      user_id: VILLAIN,
      username: 'v',
      stack: villainStart - raiseTo,
      bet: raiseTo,
      totalInvested: pre + raiseTo,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: o.flip === true,
    } as SeatPlayer,
  ];
  const history: Array<Record<string, unknown>> = [];
  for (let k = 0; k < folders; k++) {
    const seat = 3 + k;
    players.push({
      seat,
      user_id: `folder${k}`,
      username: `f${k}`,
      stack: 300,
      bet: 0,
      totalInvested: 0,
      cards: [],
      is_folded: true,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer);
    history.push({ stage: 'preflop', seat, userId: `folder${k}`, action: 'fold', amount: 0 });
  }
  history.push(
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: pre },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: pre - 2 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'check', amount: 0 },
    { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0 },
    { stage: 'turn', seat: 2, userId: VILLAIN, action: 'check', amount: 0 }
  );
  if (o.heroChecked)
    history.push(
      { stage: 'river', seat: 1, userId: 'hero', action: 'check', amount: 0 },
      { stage: 'river', seat: 2, userId: VILLAIN, action: 'bet', amount: raiseTo }
    );
  else
    history.push(
      { stage: 'river', seat: 1, userId: 'hero', action: 'bet', amount: bet },
      { stage: 'river', seat: 2, userId: VILLAIN, action: 'raise', amount: raiseTo }
    );
  const toCall = raiseTo - bet;
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards(board),
      pot: potStart + bet + raiseTo,
      currentBet: raiseTo,
      toCall,
      minRaiseTo: raiseTo + (raiseTo - bet),
      maxRaiseTo: heroStart,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      stage: 'river',
      gameVariant: variant,
      bettingStructure: 'pot_limit',
      gameMode: o.mode ?? 'cash',
      bigBlind: o.bigBlind ?? 2,
      dealerSeat: 1,
      actionHistory: history.map((a, k) => ({ ...a, timestamp: k })),
    },
  };
}

function decideMany(s: ReturnType<typeof river>, opts: Record<string, unknown> = {}, seeds = 30) {
  const acts: string[] = [];
  let fires = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    seedFastRandom(seed * 7919 + 84);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, {
      telemetry: true,
      mind: false,
      ...opts,
    } as never) as { action: string; amount?: number };
    fires += drainFires().find((r) => r.feature === FEATURE)?.fires ?? 0;
    acts.push(`${d.action}|${d.amount ?? ''}`);
  }
  return { acts, fires };
}
const putIn = (acts: string[]) =>
  acts.filter((a) => a.startsWith('call') || a.startsWith('all_in')).length;
const OFF = { v84OmahaRiverReraiseCalls: false };

// Board Kh 9h 4h 7c 2d: hearts possible, unpaired. Qh-x is the second-nut
// flush (Ah is live above it); Ah-x is the nut flush.
const FLUSHY = 'Kh9h4h7c2d';
const SECOND = { plo4: 'Qh8hTsTd', plo5: 'Qh8hTsTd2c', plo6: 'Qh8hTsTd2c3s' } as const;
// Hand 3359656 exactly: hole, board, and chips (bb 25).
const H3359656_HOLE = '4dJcKsQh5dKd';
const H3359656_BOARD = '9d7d2d4s6s';
const h3359656 = () =>
  river('plo6', H3359656_HOLE, H3359656_BOARD, {
    potStart: 4090,
    bet: 2858,
    raiseTo: 12664,
    heroStart: 30000,
    villainStart: 27975,
    folders: 5,
    mode: 'tournament',
    bigBlind: 25,
  });

describe('V84 Omaha river re-raise call discipline', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  it('admits exactly the measured cell', () => {
    expect(omahaCallClass(cards(SECOND.plo4), cards(FLUSHY))).toBe('flush_second');
    expect(omahaCallClass(cards(H3359656_HOLE), cards(H3359656_BOARD))).toBe('flush_second');
    const base: V84Input = {
      variant: 'plo4',
      street: 'river',
      hole: cards(SECOND.plo4),
      board: cards(FLUSHY),
      potFrac: 1.6,
      effectiveBB: 150,
      tournament: false,
      headsUpTable: false,
      bountyEvent: false,
      hiLo: false,
      multiBoard: false,
      bombPot: false,
      heroWageredStreet: true,
      bettorOverBluffs: false,
    };
    const at = (o: Partial<V84Input> = {}) => v84Cell({ ...base, ...o });
    expect(at()).toBe('flush_second');
    expect(at({ variant: 'plo5', hole: cards(SECOND.plo5) })).toBe('flush_second');
    expect(at({ variant: 'plo6', hole: cards(SECOND.plo6) })).toBe('flush_second');
    expect(at({ tournament: true })).toBe('flush_second');
    expect(at({ potFrac: 0.9 })).toBe('flush_second');
    // Not admitted classes.
    expect(at({ hole: cards('Ah5h6s6d') })).toBeNull(); // nut flush
    expect(at({ hole: cards('Jh8hTsTd') })).toBeNull(); // dominated flush (not measured in)
    expect(at({ board: cards('Kh9h4h7c7d') })).toBeNull(); // paired board: below the floor
    expect(at({ hole: cards('Js8sKs7d'), board: cards('Ks9h4h7c2d') })).toBeNull(); // two pair
    expect(at({ hole: cards('6s5hKdKc'), board: cards('9h8c7d2s3c') })).toBeNull(); // straight
    // Every exclusion.
    expect(at({ heroWageredStreet: false })).toBeNull();
    expect(at({ potFrac: 0.89 })).toBeNull();
    expect(at({ effectiveBB: 20 })).toBeNull();
    expect(at({ headsUpTable: true })).toBeNull();
    expect(at({ bountyEvent: true })).toBeNull();
    expect(at({ bettorOverBluffs: true })).toBeNull();
    expect(at({ hiLo: true })).toBeNull();
    expect(at({ multiBoard: true })).toBeNull();
    expect(at({ bombPot: true })).toBeNull();
    expect(at({ street: 'turn', board: cards('Kh9h4h7c') })).toBeNull();
    expect(at({ variant: 'plo5' })).toBeNull(); // PLO5 needs five cards
    expect(at({ variant: 'nlh' })).toBeNull();
    expect(at({ variant: 'plo8' })).toBeNull();
  });

  it('reads the own wager from the public history', () => {
    const h = (...a: Array<[string, number, string]>) =>
      a.map(([stage, seat, action]) => ({ stage, seat, action, amount: 10 }));
    expect(v84HeroWageredStreet(h(['river', 1, 'bet'], ['river', 2, 'raise']), 'river', 1)).toBe(
      true
    );
    expect(v84HeroWageredStreet(h(['river', 2, 'bet'], ['river', 1, 'raise']), 'river', 1)).toBe(
      true
    );
    expect(v84HeroWageredStreet(h(['river', 2, 'bet'], ['river', 1, 'call']), 'river', 1)).toBe(
      false
    );
    expect(v84HeroWageredStreet(h(['turn', 1, 'bet'], ['river', 2, 'bet']), 'river', 1)).toBe(
      false
    );
    expect(v84HeroWageredStreet(undefined, 'river', 1)).toBe(false);
  });

  it('after its own river bet, a second-nut flush never calls a pot-plus raise; off is today', () => {
    let offPutIn = 0;
    for (const [variant, hole] of Object.entries(SECOND))
      for (const mode of ['cash', 'tournament'] as const) {
        const s = river(variant, hole, FLUSHY, { mode });
        const on = decideMany(s);
        const off = decideMany(s, OFF);
        const label = `${variant} ${mode}`;
        expect(putIn(on.acts), label).toBe(0);
        expect(off.fires, label).toBe(0);
        offPutIn += putIn(off.acts);
        if (putIn(off.acts) > 0) expect(on.fires, label).toBeGreaterThan(0);
        // Every answer that did not put chips in is unchanged.
        on.acts.forEach((a, k) => {
          if (!off.acts[k].startsWith('call') && !off.acts[k].startsWith('all_in'))
            expect(a, label).toBe(off.acts[k]);
        });
        // The V81 switch neither enables nor disables V84.
        expect(decideMany(s, { v81OmahaBigBetCalls: false }).acts, label).toEqual(on.acts);
        expect(decideMany(s, { ...OFF, v81OmahaBigBetCalls: false }).acts, label).toEqual(off.acts);
      }
    // The fixture is not vacuous: today's brain calls these raises.
    expect(offPutIn).toBeGreaterThan(0);
  });

  it('hand 3359656: the PLO6 tournament Kd-high flush folds to the raise', () => {
    const s = h3359656();
    const off = decideMany(s, OFF);
    const on = decideMany(s);
    expect(putIn(off.acts)).toBeGreaterThan(0); // today calls it, as it did live
    expect(putIn(on.acts)).toBe(0);
    expect(on.acts.every((a) => a.startsWith('fold'))).toBe(true);
    expect(on.fires).toBeGreaterThan(0);
  });

  it('the fold is a valid signed policy receipt', () => {
    for (const [variant, s] of [
      ['plo4', river('plo4', SECOND.plo4, FLUSHY)],
      ['plo6', h3359656()],
    ] as const) {
      for (let seed = 1; seed <= 10; seed++) {
        seedFastRandom(seed);
        HorseMind.reset();
        const d = HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, {
          mind: false,
        } as never);
        expect(d.action).not.toBe('call');
        expect(
          horseDecisionReceiptIsValid(d, variant, { player: s.hero, gameState: s.gs as never })
        ).toBe(true);
      }
    }
  });

  it('outside the cell the answer is exactly today', () => {
    const cases: Array<[string, ReturnType<typeof river>]> = [
      ['nut flush', river('plo4', 'Ah5h6s6d', FLUSHY)],
      ['paired-board second-nut flush', river('plo4', SECOND.plo4, 'Kh9h4h7c7d')],
      ['two pair', river('plo4', 'Js8sKs7d', 'Ks9h4h7c2d')],
      ['0.8-pot raise', river('plo4', SECOND.plo4, FLUSHY, { raiseTo: 48 })],
      ['heads-up table', river('plo4', SECOND.plo4, FLUSHY, { folders: 0 })],
      ['20bb effective', river('plo4', SECOND.plo4, FLUSHY, { villainStart: 40 })],
      ['no own wager', river('plo4', SECOND.plo4, FLUSHY, { heroChecked: true, raiseTo: 36 })],
    ];
    let todayPutIn = 0;
    for (const [label, s] of cases) {
      const on = decideMany(s, {}, 15);
      const off = decideMany(s, OFF, 15);
      expect(on.acts, label).toEqual(off.acts);
      expect(on.fires, label).toBe(0);
      todayPutIn += putIn(off.acts);
    }
    // Not vacuous: today's brain does call in these spots, and V84 leaves it.
    expect(todayPutIn).toBeGreaterThan(0);
  });

  it('one policy: label flips never change the answer', () => {
    for (const hole of [SECOND.plo4, 'Ah5h6s6d']) {
      expect(decideMany(river('plo4', hole, FLUSHY, { flip: true }), {}, 15).acts).toEqual(
        decideMany(river('plo4', hole, FLUSHY), {}, 15).acts
      );
    }
  });
});
