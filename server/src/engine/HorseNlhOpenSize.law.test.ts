/**
 * NO-LIMIT HOLD'EM OPEN SIZES (Dan 2026-10-31, BINDING).
 *
 * "WHY ARE ALL HORSES MIN RAISING WHEN THEY ARE OPENING... OPENING RANGES
 * SHOULD BE RANDOMLY DONE, MIN RAISE TO 2.5-4X OPENING RANGES. NOT ALWAYS THE
 * MINIMUM RAISE POSSIBLE".
 *
 * Before this law a 0.50/1 cash table opened 86.8% exact min-raises through
 * HorseLogic.decide and a 9-handed ante tournament 30.0% (median 2.13bb).
 * The pins below are what stops it coming back:
 *
 *  - the size never reads the hand (same random values, same size, for AA
 *    and 72o, and the same sampled distribution through the real brain);
 *  - each spot draws from its own band (seat, table, format, depth, antes);
 *  - a CASH open is never under 2.5bb (Dan 2026-11-01: "THEY ARE LITERALLY
 *    MIN RAISING IN A CASH GAME THAT DOESN'T HAPPEN"), while a fifth of
 *    tournament opens deeper than 25bb are an exact min-raise;
 *  - a tournament short stack never opens above 2.3bb, a 25-40bb tournament stack never
 *    above 2.5bb (small blind 2.8bb), and nothing is ever below a min-raise;
 *  - whole chips at whole-chip tables, without collapsing back to 2bb.
 */
import { describe, expect, it } from 'vitest';
import {
  NLH_CASH_OPEN_FLOOR_BB,
  NLH_OPEN_BANDS_CASH,
  NLH_OPEN_BANDS_CASH_ANTE,
  NLH_OPEN_BANDS_TOURNAMENT,
  NLH_OPEN_BANDS_TOURNAMENT_ANTE,
  NLH_OPEN_BANDS_TOURNAMENT_MID,
  NLH_OPEN_BAND_CASH_SHORT,
  NLH_OPEN_BAND_SHORT,
  NLH_TOURNAMENT_MIN_RAISE_SHARE,
  chipStepFor,
  nlhOpenBand,
  nlhOpenRaiseTo,
  nlhOpenSeat,
  type NlhOpenSeat,
  type NlhOpenSpot,
} from './HorseNlhOpenSize.js';
import { decidePreflopV7 } from './HorsePreflop.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import { buildTournamentMState } from './HorseTournamentPreflop.js';
import type { ActionRecord, Card, HorseStyle, SeatPlayer } from '../types.js';

const SEATS: NlhOpenSeat[] = ['early', 'middle', 'cutoff', 'button', 'blind', 'heads_up'];

/** A deterministic uniform stream (mulberry32). */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(
  spot: NlhOpenSpot,
  opts: {
    bigBlind?: number;
    limpers?: number;
    mult?: number;
    n?: number;
    seed?: number;
    chips?: boolean;
  } = {}
): number[] {
  const bb = opts.bigBlind ?? 100;
  const rand = stream(opts.seed ?? 7);
  const out: number[] = [];
  for (let i = 0; i < (opts.n ?? 4000); i++) {
    out.push(
      nlhOpenRaiseTo({
        ...spot,
        openUnit: bb,
        bigBlind: bb,
        limpers: opts.limpers ?? 0,
        sizingMultiplier: opts.mult ?? 1,
        rand,
      }) / (opts.chips ? 1 : bb)
    );
  }
  return out;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const deep = (seat: NlhOpenSeat, extra: Partial<NlhOpenSpot> = {}): NlhOpenSpot => ({
  seat,
  depthBB: 100,
  tournament: false,
  anteInPlay: false,
  tableSize: 6,
  ...extra,
});

describe('the open size never reads the hand', () => {
  // decidePreflopV7 is the live owner of every no-limit raise-first-in open
  // (proved through HorseLogic.decide below). A constant random source makes
  // the result independent of how many values each hand consumed on its way
  // to the sizer, so any difference could only come from the cards.
  const v7 = (strength: number, c: number, extra: Record<string, unknown> = {}) =>
    decidePreflopV7({
      position: 'early',
      raiserPosition: null,
      strength,
      raises: 0,
      limpers: 0,
      callers: 0,
      oppsLeft: 5,
      toCall: 1,
      currentBet: 1,
      pot: 1.5,
      contestablePot: 1.5,
      bigBlind: 1,
      stack: 100,
      stackBB: 100,
      effectiveStackBB: 100,
      tightness: 0.01, // every hand clears the bar, so 72o opens too
      bluffFreq: 0,
      aggression: 1,
      slowplayFreq: 0,
      sizingMultiplier: 1,
      isOmaha: false,
      isPotLimit: false,
      riskAdd: 0,
      mode: 'cash',
      anteInPlay: false,
      tableSize: 6,
      v13: true,
      rand: () => c,
      ...extra,
    } as never);

  it('AA and 72o open to the same size for the same random values, in every spot', () => {
    const spots: Record<string, unknown>[] = [
      {},
      { position: 'late', isButton: true },
      { position: 'middle', bigBlind: 0.1, stack: 10, pot: 0.15, toCall: 0.1, currentBet: 0.1 },
      {
        mode: 'tournament',
        anteInPlay: true,
        bigBlind: 200,
        stack: 12000,
        stackBB: 60,
        effectiveStackBB: 60,
        toCall: 200,
        currentBet: 200,
        pot: 500,
      },
      {
        mode: 'tournament',
        anteInPlay: true,
        bigBlind: 200,
        stack: 6000,
        stackBB: 30,
        effectiveStackBB: 30,
        toCall: 200,
        currentBet: 200,
        pot: 500,
      },
      {
        mode: 'tournament',
        anteInPlay: true,
        position: 'late',
        isButton: true,
        bigBlind: 200,
        stack: 4800,
        stackBB: 24,
        effectiveStackBB: 24,
        toCall: 200,
        currentBet: 200,
        pot: 500,
      },
    ];
    let compared = 0;
    for (const spot of spots) {
      for (let c = 0.005; c < 1; c += 0.033) {
        const aa = v7(0.995, c, spot);
        const sevenDeuce = v7(0.02, c, spot);
        expect(aa.a).toBe('raiseTo');
        // Whether 72o opens may depend on the draw (a short stack mixes some
        // folds); WHEN it opens, it opens to exactly the size AA does.
        if (sevenDeuce.a !== 'raiseTo') continue;
        expect(sevenDeuce).toEqual(aa);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(170); // of 186
  });

  it('the draw always consumes exactly three random values', () => {
    for (const seat of SEATS) {
      for (const depthBB of [12, 30, 100, 300]) {
        for (const bigBlind of [0.1, 1, 200]) {
          let calls = 0;
          nlhOpenRaiseTo({
            ...deep(seat, { depthBB, tournament: depthBB === 30 }),
            openUnit: bigBlind,
            bigBlind,
            limpers: 1,
            sizingMultiplier: 1,
            rand: () => (calls++, 0.4),
          });
          expect(calls).toBe(3);
        }
      }
    }
  });
});

describe('each spot draws from its own band', () => {
  const allSpots = (): NlhOpenSpot[] => {
    const cases: NlhOpenSpot[] = [];
    for (const seat of SEATS)
      for (const tournament of [false, true]) {
        cases.push(deep(seat, { tournament }));
        cases.push(deep(seat, { tournament, anteInPlay: true }));
        cases.push(deep(seat, { tournament, tableSize: 9 }));
        cases.push(deep(seat, { tournament, depthBB: 250 }));
        cases.push(deep(seat, { tournament, anteInPlay: tournament, depthBB: 35 }));
        cases.push(deep(seat, { tournament, anteInPlay: tournament, depthBB: 18 }));
      }
    return cases;
  };

  it('every draw is the min-raise atom or inside its band, never past 4x', () => {
    for (const spot of allSpots()) {
      const band = nlhOpenBand(spot);
      for (const mult of [0.88, 1, 1.12]) {
        const xs = sample(spot, { mult, n: 800 });
        const banded = xs.filter((x) => !(band.minRaiseShare > 0 && x === 2));
        expect(Math.min(...banded)).toBeGreaterThanOrEqual(Math.max(2, band.lo) - 1e-9);
        expect(Math.max(...xs)).toBeLessThanOrEqual(Math.min(4, band.hi) + 0.01 + 1e-9);
        // The band is used, not a point inside it.
        expect(Math.max(...banded) - Math.min(...banded)).toBeGreaterThan(
          (band.hi - band.lo) * 0.8
        );
      }
    }
  });

  it('a cash open is never under 2.5bb: no min-raise, any seat, depth, dial or grid', () => {
    for (const spot of allSpots().filter((x) => !x.tournament)) {
      expect(nlhOpenBand(spot).minRaiseShare).toBe(0);
      for (const bigBlind of [0.1, 1, 2, 100])
        for (const mult of [0.88, 1.12]) {
          const xs = sample(spot, { bigBlind, mult, n: 500 });
          expect(Math.min(...xs)).toBeGreaterThanOrEqual(NLH_CASH_OPEN_FLOOR_BB - 1e-9);
        }
    }
    // Dan's shape: 2.5-3.5bb, the small blind 3-3.5bb, deep early up to 4bb.
    expect(NLH_OPEN_BANDS_CASH.blind).toEqual([3.0, 3.5]);
    for (const seat of SEATS) {
      expect(NLH_OPEN_BANDS_CASH[seat][0]).toBeGreaterThanOrEqual(2.5);
      expect(NLH_OPEN_BANDS_CASH[seat][1]).toBeLessThanOrEqual(3.5);
    }
    expect(nlhOpenBand(deep('early', { depthBB: 200, tableSize: 9 })).hi).toBe(4);
  });

  it('a fifth of tournament opens deeper than 25bb are an exact min-raise', () => {
    for (const seat of SEATS)
      for (const spot of [
        deep(seat, { tournament: true, anteInPlay: true, depthBB: 60 }),
        deep(seat, { tournament: true, depthBB: 100 }),
        deep(seat, { tournament: true, anteInPlay: true, depthBB: 32 }),
      ]) {
        expect(nlhOpenBand(spot).minRaiseShare).toBe(NLH_TOURNAMENT_MIN_RAISE_SHARE);
        const xs = sample(spot, { bigBlind: 200, n: 5000 });
        const share = xs.filter((x) => x === 2).length / xs.length;
        expect(share).toBeGreaterThan(NLH_TOURNAMENT_MIN_RAISE_SHARE - 0.03);
        expect(share).toBeLessThan(NLH_TOURNAMENT_MIN_RAISE_SHARE + 0.06);
      }
  });

  it('early seats open largest, the button smallest, the small blind largest of all', () => {
    for (const tournament of [false, true])
      for (const ante of [false, true]) {
        const m = (seat: NlhOpenSeat) =>
          mean(sample(deep(seat, { anteInPlay: ante, tournament }), { n: 6000 }));
        expect(m('early')).toBeGreaterThan(m('middle'));
        expect(m('middle')).toBeGreaterThan(m('cutoff'));
        expect(m('cutoff')).toBeGreaterThan(m('button'));
        expect(m('blind')).toBeGreaterThan(m('early'));
      }
    expect(mean(sample(deep('blind')))).toBeCloseTo(3.25, 1);
  });

  it('antes open smaller, deep cash larger, a full ring early seat larger', () => {
    for (const seat of SEATS) {
      for (const tournament of [false, true])
        expect(mean(sample(deep(seat, { tournament, anteInPlay: true })))).toBeLessThanOrEqual(
          mean(sample(deep(seat, { tournament })))
        );
      expect(mean(sample(deep(seat, { depthBB: 200 })))).toBeGreaterThan(mean(sample(deep(seat))));
    }
    expect(mean(sample(deep('early', { tableSize: 9 })))).toBeGreaterThan(
      mean(sample(deep('early'))) + 0.2
    );
    // Deep tournament stacks keep the tournament bands: no deep-cash bump.
    expect(nlhOpenBand(deep('early', { tournament: true, depthBB: 200 }))).toEqual(
      nlhOpenBand(deep('early', { tournament: true, depthBB: 100 }))
    );
  });

  it('the bands are the documented constants', () => {
    for (const seat of SEATS) {
      const pairs: [NlhOpenSpot, readonly [number, number]][] = [
        [deep(seat), NLH_OPEN_BANDS_CASH[seat]],
        [deep(seat, { anteInPlay: true }), NLH_OPEN_BANDS_CASH_ANTE[seat]],
        [deep(seat, { tournament: true }), NLH_OPEN_BANDS_TOURNAMENT[seat]],
        [deep(seat, { tournament: true, anteInPlay: true }), NLH_OPEN_BANDS_TOURNAMENT_ANTE[seat]],
        [deep(seat, { tournament: true, depthBB: 30 }), NLH_OPEN_BANDS_TOURNAMENT_MID[seat]],
        [deep(seat, { tournament: true, depthBB: 20 }), NLH_OPEN_BAND_SHORT],
        [deep(seat, { depthBB: 20 }), NLH_OPEN_BAND_CASH_SHORT],
      ];
      for (const [spot, [lo, hi]] of pairs) expect(nlhOpenBand(spot)).toMatchObject({ lo, hi });
    }
  });

  it('every limper adds one open unit', () => {
    for (const seat of SEATS)
      for (const tournament of [false, true]) {
        const none = sample(deep(seat, { tournament }), { seed: 11 });
        const two = sample(deep(seat, { tournament }), { seed: 11, limpers: 2 });
        expect(mean(two) - mean(none)).toBeCloseTo(2, 1);
      }
  });

  it('the persona dial leans inside the band without leaving it', () => {
    const low = sample(deep('cutoff'), { mult: 0.88 });
    const high = sample(deep('cutoff'), { mult: 1.12 });
    expect(mean(high)).toBeGreaterThan(mean(low));
    expect(Math.min(...low)).toBeGreaterThanOrEqual(NLH_OPEN_BANDS_CASH.cutoff[0] - 1e-9);
  });
});

describe('short stacks and tournaments keep their constraints', () => {
  it('a tournament stack of 25bb or less opens 2.0-2.3bb, every seat, every grid', () => {
    for (const seat of SEATS)
      for (const bigBlind of [1, 2, 20, 200]) {
        const xs = sample(deep(seat, { depthBB: 25, tournament: true, anteInPlay: true }), {
          bigBlind,
          mult: 1.12,
          n: 500,
        });
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(NLH_OPEN_BAND_SHORT[0]);
        expect(Math.max(...xs)).toBeLessThanOrEqual(NLH_OPEN_BAND_SHORT[1] + 1e-9);
      }
  });

  it('a short cash stack opens 2.5-2.8bb: above the cash floor, never committing', () => {
    for (const seat of SEATS)
      for (const bigBlind of [0.1, 1, 2]) {
        const xs = sample(deep(seat, { depthBB: 20 }), { bigBlind, mult: 1.12, n: 500 });
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(2.5 - 1e-9);
        expect(Math.max(...xs)).toBeLessThanOrEqual(3 + 1e-9);
      }
  });

  it('a 25-40bb tournament stack opens at most 2.5bb (small blind 2.8bb)', () => {
    for (const seat of SEATS) {
      const xs = sample(deep(seat, { depthBB: 40, tournament: true, anteInPlay: true }), {
        bigBlind: 300,
        mult: 1.12,
      });
      expect(Math.max(...xs)).toBeLessThanOrEqual(NLH_OPEN_BANDS_TOURNAMENT_MID[seat][1] + 1e-9);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('the open lands on the chip grid without collapsing to a min-raise', () => {
  it('whole chips at a whole-chip big blind, cents otherwise', () => {
    expect(chipStepFor(1)).toBe(1);
    expect(chipStepFor(200)).toBe(1);
    expect(chipStepFor(0.1)).toBe(0.01);
    for (const seat of SEATS)
      for (const tournament of [false, true])
        for (const bigBlind of [1, 2, 300]) {
          const xs = sample(deep(seat, { tournament }), { bigBlind, n: 300, chips: true });
          for (const chips of xs) expect(Number.isInteger(chips)).toBe(true);
        }
  });

  it('a 1-chip cash big blind opens 3 or 4 chips, never 2', () => {
    for (const seat of SEATS) {
      const xs = sample(deep(seat), { bigBlind: 1, n: 3000 });
      expect(xs.filter((x) => x === 2).length).toBe(0);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(3);
      expect(Math.max(...xs)).toBeLessThanOrEqual(4);
    }
    expect(new Set(sample(deep('early'), { bigBlind: 1, n: 3000 }))).toEqual(new Set([3, 4]));
  });

  it('the seat map follows HorsePreflop position buckets', () => {
    expect(nlhOpenSeat({ position: 'late', isButton: true, trueHeadsUp: false })).toBe('button');
    expect(nlhOpenSeat({ position: 'late', trueHeadsUp: false })).toBe('cutoff');
    expect(nlhOpenSeat({ position: 'sb', trueHeadsUp: false })).toBe('blind');
    expect(nlhOpenSeat({ position: 'sb', trueHeadsUp: true })).toBe('heads_up');
    expect(nlhOpenSeat({ position: 'bb', trueHeadsUp: true })).toBe('blind');
  });
});

// ── Through the real brain: HorseLogic.decide, every hand class ─────────────
const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANKS = 'AKQJT98765432'.split('');
interface Table {
  seats: number;
  stackBB: number;
  mode: 'cash' | 'tournament';
  ante: boolean;
  bb: number;
}
function holeFor(cls: string, s: number): Card[] {
  const su = (s * 3) % 4;
  const suited = cls.length === 3 && cls[2] === 's';
  const s2 = suited ? su : (su + 1 + (s % 3)) % 4;
  return [{ rank: cls[0], suit: SUITS[su] } as Card, { rank: cls[1], suit: SUITS[s2] } as Card];
}
/** Hero first in at `posIdx` (0 = first seat after the big blind; last = SB). */
function decideFirstIn(t: Table, posIdx: number, cls: string, seed: number, style: HorseStyle) {
  const BB = t.bb;
  const n = t.seats;
  const sbSeat = 1;
  const bbSeat = 2;
  const order = [...Array(n - 2).keys()].map((k) => 3 + k).concat([sbSeat]);
  const heroSeat = order[posIdx];
  const hole = holeFor(cls, seed);
  const used = new Set(hole.map((h) => h.rank + h.suit));
  const deck: Card[] = [];
  for (const r of RANKS)
    for (const su of SUITS) if (!used.has(r + su)) deck.push({ rank: r, suit: su } as Card);
  const ante = t.ante ? BB : 0;
  const players: SeatPlayer[] = [];
  for (let seat = 1; seat <= n; seat++) {
    const bet = seat === sbSeat ? BB / 2 : seat === bbSeat ? BB : 0;
    const dead = seat === bbSeat ? ante : 0;
    players.push({
      seat,
      user_id: `open-${seat}`,
      username: `Open${seat}`,
      stack: t.stackBB * BB - bet - dead,
      bet,
      totalInvested: bet + dead,
      cards: seat === heroSeat ? hole : [deck[seat * 2], deck[seat * 2 + 1]],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer);
  }
  const history: ActionRecord[] = [];
  let ts = 100;
  for (const seat of order) {
    if (seat === heroSeat) break;
    players[seat - 1].is_folded = true;
    history.push({
      seat,
      userId: `open-${seat}`,
      action: 'fold',
      amount: 0,
      timestamp: ts++,
      stage: 'preflop',
    } as ActionRecord);
  }
  const tournament =
    t.mode === 'tournament'
      ? {
          tournament: {
            schemaVersion: 1,
            contextStatus: 'complete',
            contextIssues: [],
            playersLeft: 180,
            spotsPaid: 30,
            entrants: 300,
            avgStackChips: t.stackBB * BB,
            medianStackChips: t.stackBB * BB,
            seatsPerTable: n,
            playersAtTable: n,
            nearBubble: false,
            inMoney: false,
            payoutPct: [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
            currentSmallBlind: BB / 2,
            currentBigBlind: BB,
            currentAnte: ante,
            anteType: t.ante ? 'big_blind' : 'none',
            nextSmallBlind: BB,
            nextBigBlind: 2 * BB,
            nextAnte: ante * 2,
            nextBlindInMin: 10,
            m: buildTournamentMState({
              stackChips: t.stackBB * BB,
              smallBlind: BB / 2,
              bigBlind: BB,
              ante,
              anteType: t.ante ? 'big_blind' : 'none',
              playersAtTable: n,
              opponentStacks: players
                .filter((p) => p.seat !== heroSeat)
                .map((p) => ({ userId: p.user_id, stackChips: p.stack + p.bet })),
            }),
          },
        }
      : {};
  const gs = {
    players,
    communityCards: [],
    pot: 1.5 * BB + ante,
    currentBet: BB,
    minRaise: BB,
    lastRaise: BB,
    stage: 'preflop',
    gameVariant: 'nlh',
    bigBlind: BB,
    dealerSeat: n === 2 ? 1 : n,
    actionHistory: history,
    gameMode: t.mode,
    ante,
    bigBlindAnte: t.ante,
    format: t.mode === 'cash' ? 'cash' : 'mtt',
    ...tournament,
  } as unknown as HorseGameStateV2;
  // Seeded from the whole hand class: a seed built from its first letter
  // gives every ace (or king) hand the same random stream.
  const classHash = [...cls].reduce((h, ch) => (h * 131 + ch.charCodeAt(0)) >>> 0, 7);
  seedFastRandom(((classHash ^ Math.imul(seed, 2654435761)) >>> 0) + posIdx * 104729);
  const hero = players[heroSeat - 1];
  const d = HorseLogic.decide(hero, gs, style, {}, { mind: false, telemetry: false } as never);
  return { d, hero, gs };
}

const STYLES: HorseStyle[] = ['tag', 'lag', 'balanced'];
const PREMIUMS = new Set(['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo', 'AQs']);
function opens(t: Table, seeds = 2) {
  const all: { bb: number; chips: number; premium: boolean; pos: number }[] = [];
  for (let pos = 0; pos < t.seats - 1; pos++)
    for (const style of STYLES)
      for (const h of HAND_CLASSES)
        for (let s = 1; s <= seeds; s++) {
          const { d, hero, gs } = decideFirstIn(t, pos, h.cls, s, style);
          if (d.action !== 'raise') continue;
          const chips = d.amount ?? 0;
          // Legal: a real min-raise or more, never past the stack.
          expect(chips).toBeGreaterThanOrEqual(gs.currentBet + gs.minRaise - 1e-9);
          expect(chips).toBeLessThanOrEqual(hero.stack + hero.bet + 1e-9);
          if (Number.isInteger(t.bb) && t.bb >= 1) expect(Number.isInteger(chips)).toBe(true);
          all.push({ bb: chips / t.bb, chips, premium: PREMIUMS.has(h.cls), pos });
        }
  return all;
}

describe('through HorseLogic.decide', () => {
  it('a cash table never opens to the minimum (86.8% at 0.50/1 before)', () => {
    for (const bb of [1, 0.1]) {
      const xs = opens({ seats: 6, stackBB: 100, mode: 'cash', ante: false, bb });
      expect(xs.length).toBeGreaterThan(500);
      expect(Math.min(...xs.map((x) => x.bb))).toBeGreaterThanOrEqual(2.5 - 1e-9);
      expect(mean(xs.map((x) => x.bb))).toBeGreaterThan(2.8); // 2.13 at 0.50/1 before
      expect(Math.max(...xs.map((x) => x.bb))).toBeLessThanOrEqual(4);
    }
  });

  it('premiums and the rest of the range open from the same distribution', () => {
    const xs = opens({ seats: 6, stackBB: 100, mode: 'cash', ante: false, bb: 0.1 }, 4);
    for (let pos = 0; pos < 5; pos++) {
      const prem = xs.filter((x) => x.pos === pos && x.premium).map((x) => x.bb);
      const rest = xs.filter((x) => x.pos === pos && !x.premium).map((x) => x.bb);
      expect(prem.length).toBeGreaterThan(40);
      expect(rest.length).toBeGreaterThan(40);
      expect(Math.abs(mean(prem) - mean(rest))).toBeLessThan(0.12);
    }
  });

  it('a 9-handed ante tournament mixes a fifth of min-raises, a short stack at 2.0-2.3bb', () => {
    const mid = opens({ seats: 9, stackBB: 60, mode: 'tournament', ante: true, bb: 200 }, 1);
    const sizes = mid.map((x) => x.bb);
    const minShare = sizes.filter((x) => x === 2).length / sizes.length;
    expect(minShare).toBeGreaterThan(0.15); // the tournament mix, not every open
    expect(minShare).toBeLessThan(0.27); // 30.0% before, plus 7% more at 2.0-2.05
    expect(Math.max(...sizes)).toBeLessThanOrEqual(
      NLH_OPEN_BANDS_TOURNAMENT_ANTE.blind[1] + 0.25 + 1e-9
    );
    const short = opens({ seats: 6, stackBB: 24, mode: 'tournament', ante: true, bb: 200 }, 1);
    expect(short.length).toBeGreaterThan(200);
    for (const x of short) {
      expect(x.bb).toBeGreaterThanOrEqual(2);
      expect(x.bb).toBeLessThanOrEqual(2.3 + 1e-9);
    }
  });
});
