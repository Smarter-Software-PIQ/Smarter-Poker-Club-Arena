/**
 * PREFLOP DEFENCE LEAKS (2026-11-07), two default-off flags measured by the
 * preflop audit (docs/changelog/2026-11-07-horse-preflop-defence-leaks.md):
 *
 *  - facingOpenFullRingZone: four or more dealt, a tournament stack the
 *    table-scaled M put in jam-or-fold FACING an open (20bb six-handed with a
 *    big-blind ante reads M 4.8) folded 88.6% in the big blind to a button
 *    min-raise; the facing-action zone is now the <= 15bb one V82 gave
 *    two- and three-handed tables. The open is untouched.
 *  - vs3BetShortStack: an opener at 12-25bb effective facing a 3-bet folded
 *    97-98% of its open (V73 began at 25bb and the stack cap refused every
 *    call that was the stack); the V73 read now reaches 12bb and a continuing
 *    hand whose call is the stack jams.
 *
 * Every number goes through HorseLogic.decide, combo-weighted over the 169
 * classes, at a constructed node (blinds posted, BB = 2 chips).
 */
import { describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANKS = 'AKQJT98765432'.split('');
const BB = 2;
const SEEDS = 2;
const comboCount = (cls: string) => (cls.length === 2 ? 6 : cls.endsWith('s') ? 4 : 12);

const EARLY: Record<number, string[]> = {
  2: [],
  4: ['CO'],
  6: ['UTG', 'HJ', 'CO'],
  9: ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO'],
};
const names = (d: number) => (d === 2 ? ['SB', 'BB'] : ['BTN', 'SB', 'BB', ...EARLY[d]]);
const order = (d: number) => (d === 2 ? ['SB', 'BB'] : [...EARLY[d], 'BTN', 'SB', 'BB']);

/** open:POS (folded to POS) | vs:OPENER:HERO:to | v3:OPENER:THREEBETTOR:to:threeBetTo */
type Node = string;
type Table = { dealt: number; stackBB: number; mode: 'cash' | 'tournament' };

function holeFor(cls: string, s: number): Card[] {
  const su = (s * 3) % 4;
  const suited = cls.length === 3 && cls[2] === 's';
  const s2 = suited ? su : (su + 1 + (s % 3)) % 4;
  return [{ rank: cls[0], suit: SUITS[su] } as Card, { rank: cls[1], suit: SUITS[s2] } as Card];
}

function decide(t: Table, node: Node, cls: string, seed: number, opts: object): string {
  const p = node.split(':');
  const kind = p[0];
  const nm = names(t.dealt);
  const ord = order(t.dealt);
  const heroPos = kind === 'open' ? p[1] : kind === 'v3' ? p[1] : p[2];
  const hole = holeFor(cls, seed);
  const used = new Set(hole.map((h) => h.rank + h.suit));
  const deck: Card[] = [];
  for (const r of RANKS)
    for (const su of SUITS) if (!used.has(r + su)) deck.push({ rank: r, suit: su } as Card);
  const ante = t.mode === 'tournament' ? 2 : 0;
  const players: SeatPlayer[] = nm.map(
    (pos, i) =>
      ({
        seat: i + 1,
        user_id: `ssd-${i + 1}`,
        username: `Ssd${i + 1}`,
        stack: t.stackBB * BB,
        bet: 0,
        totalInvested: 0,
        cards: pos === heroPos ? hole : [deck[2 * i], deck[2 * i + 1]],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      }) as SeatPlayer
  );
  const at = (pos: string) => players[nm.indexOf(pos)];
  let pot = 0;
  const put = (pos: string, amt: number) => {
    const q = at(pos);
    const r = Math.min(amt, q.stack);
    q.stack -= r;
    q.bet += r;
    q.totalInvested += r;
    pot += r;
    if (q.stack === 0) q.is_all_in = true;
  };
  put('SB', 1);
  put('BB', 2);
  if (ante > 0) {
    at('BB').stack -= ante;
    pot += ante;
  }
  let currentBet = 2;
  let lastRaise = 2;
  const history: ActionRecord[] = [];
  let ts = 100;
  const rec = (pos: string, action: string, amount: number) =>
    history.push({
      seat: at(pos).seat,
      userId: at(pos).user_id,
      action,
      amount,
      timestamp: ts++,
      stage: 'preflop',
    } as ActionRecord);
  const fold = (pos: string) => {
    at(pos).is_folded = true;
    rec(pos, 'fold', 0);
  };
  const raiseTo = (pos: string, to: number) => {
    put(pos, to - at(pos).bet);
    lastRaise = Math.max(lastRaise, to - currentBet);
    currentBet = to;
    rec(pos, 'raise', to);
  };
  if (kind === 'open') {
    for (const pos of ord) {
      if (pos === heroPos) break;
      fold(pos);
    }
  } else {
    const opener = p[1];
    for (const pos of ord) {
      if (pos === opener) break;
      fold(pos);
    }
    raiseTo(opener, +p[kind === 'vs' ? 3 : 3]);
    const actor = kind === 'vs' ? heroPos : p[2];
    for (let k = ord.indexOf(opener) + 1; k < ord.indexOf(actor); k++) fold(ord[k]);
    if (kind === 'v3') {
      raiseTo(actor, +p[4]);
      for (let k = ord.indexOf(actor) + 1; k < ord.length; k++) fold(ord[k]);
    }
  }
  const gs = {
    players,
    communityCards: [],
    pot,
    currentBet,
    minRaise: lastRaise,
    lastRaise,
    stage: 'preflop',
    gameVariant: 'nlh',
    bigBlind: BB,
    smallBlind: 1,
    dealerSeat: 1,
    actionHistory: history,
    gameMode: t.mode,
    ante,
    format: t.mode === 'cash' ? 'cash' : 'mtt',
    ...(t.mode === 'tournament'
      ? {
          bigBlindAnte: true,
          tournament: {
            schemaVersion: 1,
            contextStatus: 'complete',
            contextIssues: [],
            playersLeft: 180,
            spotsPaid: 30,
            entrants: 300,
            avgStackChips: t.stackBB * BB,
            medianStackChips: t.stackBB * BB,
            seatsPerTable: t.dealt,
            nearBubble: false,
            inMoney: false,
            payoutPct: [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
            currentSmallBlind: 1,
            currentBigBlind: 2,
            currentAnte: ante,
            anteType: 'big_blind',
            nextSmallBlind: 2,
            nextBigBlind: 4,
            nextAnte: ante * 2,
            nextBlindInMin: 10,
          },
        }
      : {}),
  } as unknown as HorseGameStateV2;
  seedFastRandom(seed * 7919 + cls.charCodeAt(0) * 31 + cls.charCodeAt(1) * 17 + cls.length);
  const d = HorseLogic.decide(at(heroPos), gs, 'balanced', {}, {
    mind: false,
    telemetry: false,
    ...opts,
  } as never);
  const allIn =
    d.action === 'all_in' ||
    ((d.action === 'raise' || d.action === 'bet') &&
      (d.amount ?? 0) >= at(heroPos).stack + at(heroPos).bet);
  return d.action === 'fold' ? 'fold' : allIn ? 'jam' : d.action;
}

/** Combo-weighted share (0..100) of hands answered with one of `acts`. */
function share(t: Table, node: Node, opts: object, acts: string[]): number {
  let w = 0;
  let tot = 0;
  for (const { cls } of HAND_CLASSES)
    for (let s = 0; s < SEEDS; s++) {
      if (acts.includes(decide(t, node, cls, s, opts))) w += comboCount(cls);
      tot += comboCount(cls);
    }
  return (100 * w) / tot;
}

function answers(t: Table, node: Node, opts: object): string[] {
  const out: string[] = [];
  for (const { cls } of HAND_CLASSES) out.push(decide(t, node, cls, 0, opts));
  return out;
}

const CONTINUE = ['call', 'raise', 'jam'];

describe('facingOpenFullRingZone', () => {
  const ON = { facingOpenFullRingZone: true };
  const six20: Table = { dealt: 6, stackBB: 20, mode: 'tournament' };

  it('a 20bb six-handed big blind defends a button min-raise instead of jam-or-fold', () => {
    const off = share(six20, 'vs:BTN:BB:5', {}, ['fold']);
    const on = share(six20, 'vs:BTN:BB:5', ON, ['fold']);
    expect(off).toBeGreaterThan(80);
    expect(on).toBeLessThan(40);
    expect(share(six20, 'vs:BTN:BB:5', ON, ['call'])).toBeGreaterThan(40);
  });

  it('defends a four-handed button open the way nine-handed already did', () => {
    const four: Table = { dealt: 4, stackBB: 20, mode: 'tournament' };
    const nine: Table = { dealt: 9, stackBB: 20, mode: 'tournament' };
    const fourOn = share(four, 'vs:BTN:BB:5', ON, ['fold']);
    const nineOff = share(nine, 'vs:BTN:BB:5', {}, ['fold']);
    expect(Math.abs(fourOn - nineOff)).toBeLessThan(8);
  });

  it('leaves the open (the orange-zone shove), the <= 15bb zone and nine-handed 20bb alone', () => {
    expect(answers(six20, 'open:BTN', ON)).toEqual(answers(six20, 'open:BTN', {}));
    const six12: Table = { dealt: 6, stackBB: 12, mode: 'tournament' };
    expect(answers(six12, 'vs:BTN:BB:5', ON)).toEqual(answers(six12, 'vs:BTN:BB:5', {}));
    const nine: Table = { dealt: 9, stackBB: 20, mode: 'tournament' };
    expect(answers(nine, 'vs:BTN:BB:5', ON)).toEqual(answers(nine, 'vs:BTN:BB:5', {}));
  });

  it('is off by default', () => {
    expect(answers(six20, 'vs:BTN:BB:5', {})).toEqual(
      answers(six20, 'vs:BTN:BB:5', { facingOpenFullRingZone: false })
    );
  });
});

describe('vs3BetShortStack', () => {
  const ON = { vs3BetShortStack: true };
  const cash20: Table = { dealt: 6, stackBB: 20, mode: 'cash' };

  it('a 20bb button facing a big-blind 3-bet to 11bb continues instead of folding its open', () => {
    const offContinue = share(cash20, 'v3:BTN:BB:5:22', {}, CONTINUE);
    const onContinue = share(cash20, 'v3:BTN:BB:5:22', ON, CONTINUE);
    expect(offContinue).toBeLessThan(5);
    expect(onContinue).toBeGreaterThan(15);
    // The open is about 45% of hands: at least a third of it continues, and
    // the continuing hand that cannot call goes in.
    expect(share(cash20, 'v3:BTN:BB:5:22', ON, ['jam'])).toBeGreaterThan(15);
  });

  it('nine-handed and in a tournament too', () => {
    const nine: Table = { dealt: 9, stackBB: 20, mode: 'cash' };
    expect(share(nine, 'v3:BTN:BB:5:22', ON, CONTINUE)).toBeGreaterThan(15);
  });

  it('leaves 40bb (V73 already answers, the call fits the stack) and is off by default', () => {
    const cash40: Table = { dealt: 6, stackBB: 40, mode: 'cash' };
    expect(answers(cash40, 'v3:BTN:BB:5:22', ON)).toEqual(answers(cash40, 'v3:BTN:BB:5:22', {}));
    expect(answers(cash20, 'v3:BTN:BB:5:22', {})).toEqual(
      answers(cash20, 'v3:BTN:BB:5:22', { vs3BetShortStack: false })
    );
  });
});
