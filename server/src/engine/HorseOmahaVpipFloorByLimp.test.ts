/**
 * THE VPIP FLOOR IS MET BY A LIMP, NOT BY A RAISE (2026-11-15; option
 * omahaVpipFloorByLimp, default OFF). Owner 11:35: "ADD IN A LIMP FOLD TO GET
 * THE VPIP UP ... THEY SHOULDN'T BE PUTTING IN TON'S OF CHIPS AND RAISING JUST
 * TO MEET THE 50% VPIP. LIMP FOLD IS VPIP." On the recorded hand 59518335
 * (PLO5 1/2 cash, a 50% VPIP floor table, anonymised to seats) the button
 * re-raised an open and two calls to 50 (decision 7) with a hand that folds
 * to the open on a table without a floor, and facing the cold 4-bet
 * (decision 13) the floored jam bar shoves the stack.
 *
 *  - unset, false and a truthy non-boolean decide byte-identically;
 *  - first in, a hand the unfloored brain folds limps instead of raising, and
 *    having limped it folds to a raise (the call-down does not buy it back);
 *  - the recorded re-raise becomes a call; the shove facing the 4-bet becomes
 *    the unfloored call;
 *  - a premium, and any hand the unfloored brain raises, still raises;
 *  - a floor already met, a table without a floor, calls the floor buys,
 *    Hi-Lo and the postflop streets are unchanged;
 *  - the league seats no floored table: the two arms play identical poker.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import {
  HorseLogic,
  omahaVpipFloorByLimpIntent,
  VPIP_LIMP_BUFFER_HANDS,
  vpipFloorMul,
  vpipLimpTargetFor,
  vpipTargetFor,
  type HorseDecideOpts,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintFixture,
  type ComplaintPublicNode,
} from './HorseComplaintReplay.js';
import { runMatchup } from '../benchmark/HorseLeague.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import RECORDED from './HorseOmahaUnderpair.fixture.json';

const FX = RECORDED as unknown as ComplaintFixture;
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = Array.from({ length: 16 }, (_, i) => 6000 + i);
const KEPT = 'omaha_vpip_floor_three_bet_bar_kept';
const LIMP = 'omaha_vpip_floor_limp';
const LIMP_FOLD = 'omaha_vpip_floor_limp_fold';
const ON: HorseDecideOpts = { omahaVpipFloorByLimp: true };

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

interface Variation {
  hole?: string;
  variant?: 'plo4' | 'plo5' | 'plo8';
  node?: (pn: ComplaintPublicNode) => void;
  /** Replace the recorded line: the button first in ('unopened'), or the
   *  button having limped and the big blind having raised the pot ('limped'). */
  line?: 'unopened' | 'limped';
}
/** The Horse's own judged VPIP over the table's window, in percent. */
const ownVpip =
  (vpip: number) =>
  (pn: ComplaintPublicNode): void => {
    pn.ownVpip = { hands: 30, vpip };
  };
const noFloor = (pn: ComplaintPublicNode): void => {
  delete pn.vpipFloor;
  delete pn.vpipWindowHands;
};

/**
 * The recorded table with everyone folded to the button (seat 4): first in
 * for 2 with the blinds behind, or, having limped, facing the big blind's
 * pot raise to 9 (7 more into 14).
 */
function firstIn(fx: ComplaintFixture, line: 'unopened' | 'limped'): void {
  const pn = JSON.parse(
    JSON.stringify(fx.actions.find((a) => a.ord === 7)!.publicNode)
  ) as ComplaintPublicNode;
  const acts = fx.actions.slice(0, 3);
  const add = (seat: number, action: string, amount: number, full = false) =>
    acts.push({
      ord: acts.length + 1,
      seat,
      stage: 'preflop',
      action,
      amount,
      origin: 'horse_policy',
      isFullRaise: full,
      dead: false,
    });
  add(1, 'fold', 0);
  add(2, 'fold', 0);
  add(3, 'fold', 0);
  pn.seats = [
    [1, 1426.9, 0, 0, 0, 0, 1],
    [2, 1172.95, 0, 0, 0, 0, 1],
    [3, 400, 0, 0, 0, 0, 1],
    [4, 400.4, 0, 0, 0, 0, 0],
    [5, 379.65, 1, 1, 0, 0, 0],
    [6, 795.5, 2, 4, 2, 0, 0],
  ];
  Object.assign(pn, { pot: 5, toCall: 2, currentBet: 2, minRaiseTo: 4, maxRaiseTo: 9 });
  if (line === 'limped') {
    add(4, 'call', 2);
    add(5, 'fold', 0);
    add(6, 'raise', 9, true);
    pn.seats[3] = [4, 398.4, 2, 2, 0, 0, 0];
    pn.seats[4] = [5, 379.65, 1, 1, 0, 0, 1];
    pn.seats[5] = [6, 788.5, 9, 11, 2, 0, 0];
    Object.assign(pn, { pot: 14, toCall: 7, currentBet: 9, minRaiseTo: 16, maxRaiseTo: 30 });
  }
  add(4, 'call', 2);
  acts[acts.length - 1].publicNode = pn;
  fx.actions = acts;
}

function spot(ord: number, v: Variation = {}) {
  const fx = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
  let at = ord;
  if (v.line) {
    firstIn(fx, v.line);
    at = fx.actions.length;
  }
  const node = fx.actions.find((a) => a.ord === at)!;
  if (v.hole) fx.hole[String(node.seat)] = cards(v.hole);
  if (v.variant) {
    fx.variant = v.variant;
    node.publicNode!.variant = v.variant;
  }
  v.node?.(node.publicNode!);
  return stateAt(fx, node);
}

interface Outcome {
  bytes: string[];
  actions: string[];
  fires: string[][];
  next: number[];
}
function playMany(ord: number, opts: HorseDecideOpts, v: Variation = {}): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [], next: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    drainFires();
    seedFastRandom(s);
    const st = spot(ord, v);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      mind: false,
      telemetry: true,
      ...opts,
    });
    out.next.push(fastRandom());
    out.bytes.push(
      createHash('sha256')
        .update(
          JSON.stringify(d, (k, x) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : x))
        )
        .digest('hex')
        .slice(0, 16)
    );
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
  }
  return out;
}
const hasFire = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
const all = (a: string) => SEEDS.map(() => a);

describe('the limp target', () => {
  it('is three hands of the judged window above the floor', () => {
    expect(VPIP_LIMP_BUFFER_HANDS).toBe(3);
    expect(vpipLimpTargetFor(50, 30)).toBeCloseTo(18 / 30, 9);
    expect(vpipLimpTargetFor(30, 30)).toBeCloseTo(12 / 30, 9);
    expect(vpipLimpTargetFor(50, 10)).toBeCloseTo(0.8, 9);
    expect(vpipLimpTargetFor(0, 30)).toBe(0);
    // against the standard-error target the Omaha strategy reads over ten hands
    expect(vpipTargetFor(50, 10) - vpipLimpTargetFor(50, 30)).toBeGreaterThan(0.1);
  });
});

/**
 * 300 hands for one Horse at the recorded 50% table, one preflop decision a
 * hand: 40% first in on the button, 40% facing the recorded open and two
 * calls (4.5 big blinds to call), 20% in the big blind facing the recorded
 * re-raise to 50 (24 big blinds to call, past the call-down's price). Its own
 * judged VPIP is the rolling thirty hands, as the Classic floor judges it.
 */
function sitting(opts: HorseDecideOpts, hands = 300, seed = 20261115) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const RANKS = '23456789TJQKA';
  const SUITS = 'cdhs';
  const deal = (): string => {
    const seen = new Set<string>();
    while (seen.size < 5) seen.add(RANKS[Math.floor(rnd() * 13)] + SUITS[Math.floor(rnd() * 4)]);
    return [...seen].join('');
  };
  const played: boolean[] = [];
  const out = {
    judged: 0,
    below: 0,
    longestBelow: 0,
    lowest: 100,
    vpip: 0,
    forced: 0,
    forcedRaises: 0,
  };
  let run = 0;
  for (let h = 0; h < hands; h++) {
    const hole = deal();
    const r = rnd();
    const ord = r < 0.8 ? 7 : 9;
    const line = r < 0.4 ? ('unopened' as const) : undefined;
    const recent = played.slice(-30);
    const own =
      recent.length >= 3
        ? { hands: recent.length, vpip: (100 * recent.filter(Boolean).length) / recent.length }
        : undefined;
    const act = (floor: boolean, o: HorseDecideOpts): string => {
      HorseMind.reset();
      seedFastRandom(h + 1);
      const st = spot(ord, {
        line,
        hole,
        node: (pn) => {
          if (!floor) noFloor(pn);
          else if (own) pn.ownVpip = own;
        },
      });
      return HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, { mind: false, ...o }).action;
    };
    const a = act(true, opts);
    const entered = a === 'call' || a === 'raise' || a === 'all_in';
    if (entered && act(false, {}) === 'fold') {
      out.forced++;
      if (a !== 'call') out.forcedRaises++;
    }
    if (entered) out.vpip++;
    played.push(entered);
    if (played.length >= 30) {
      const k = played.slice(-30).filter(Boolean).length;
      out.judged++;
      out.lowest = Math.min(out.lowest, (100 * k) / 30);
      if (k < 15) out.below++;
      run = k < 15 ? run + 1 : 0;
      out.longestBelow = Math.max(out.longestBelow, run);
    }
  }
  return out;
}

describe('300-hand sittings at the 50% table', () => {
  it('on: the rolling thirty-hand VPIP holds the floor, with fewer floor-forced entries and none of them a raise', () => {
    const today = sitting({});
    const on = sitting(ON);
    // the recorded seed: every one of the 271 judged windows is at or above 50%
    expect(on.judged).toBe(271);
    expect(on.below).toBe(0);
    expect(on.lowest).toBeGreaterThanOrEqual(50);
    // today plays about 64% of hands (production census: 63.3%); the option about 58%
    expect(today.vpip / 300).toBeGreaterThan(0.6);
    expect(on.vpip / 300).toBeGreaterThan(0.54);
    expect(on.vpip).toBeLessThan(today.vpip);
    expect(on.forced).toBeLessThan(today.forced);
    expect(today.forcedRaises).toBeGreaterThan(0);
    expect(on.forcedRaises).toBe(0);
    // four more sittings: a window under the floor is rare (no more often than
    // today) and never lasts the ten hands that turn a warning into a boot
    let belowOn = on.below;
    let belowToday = today.below;
    for (const seed of [1, 2, 3, 4]) {
      const t = sitting({}, 300, seed);
      const o = sitting(ON, 300, seed);
      belowOn += o.below;
      belowToday += t.below;
      expect(o.longestBelow).toBeLessThan(10);
      expect(o.forced).toBeLessThan(t.forced);
      expect(o.forcedRaises).toBe(0);
    }
    expect(belowOn).toBeLessThanOrEqual(belowToday);
    expect(belowOn / (5 * 271)).toBeLessThan(0.01);
  }, 300_000);

  it('unset and false play the same sitting', () => {
    expect(sitting({ omahaVpipFloorByLimp: false }, 60)).toEqual(sitting({}, 60));
  }, 120_000);
});

describe('the floor and its target', () => {
  it('a 50% floor steers a PLO seat to about 70% over its ten-hand window; at the target nothing is lowered', () => {
    expect(vpipTargetFor(50, 10)).toBeCloseTo(0.7055, 3);
    const gs = { vpipFloor: 50, vpipWindowHands: 30, gameVariant: 'plo5' };
    expect(vpipFloorMul(gs)).toBeLessThan(1); // no sample yet: the prior
    expect(vpipFloorMul({ ...gs, ownVpip: { hands: 30, vpip: 50 } })).toBeLessThan(1);
    expect(vpipFloorMul({ ...gs, ownVpip: { hands: 30, vpip: 71 } })).toBe(1);
    expect(vpipFloorMul({ gameVariant: 'plo5' })).toBe(1);
  });
});

describe('the rule (omahaVpipFloorByLimpIntent)', () => {
  const at = (raises: number, toCall: number, heroLimped = false) => ({
    raises,
    toCall,
    stack: 400,
    bigBlind: 2,
    heroLimped,
  });
  const raise = { a: 'raiseTo' as const, to: 9 };
  it('unopened: a raise only the floor makes is the limp; a raise both make stands', () => {
    expect(omahaVpipFloorByLimpIntent(raise, { a: 'fold' }, at(0, 2))).toEqual({
      intent: { a: 'call' },
      receipt: LIMP,
    });
    expect(omahaVpipFloorByLimpIntent(raise, { a: 'call' }, at(0, 2))!.intent).toEqual({
      a: 'call',
    });
    expect(omahaVpipFloorByLimpIntent(raise, raise, at(0, 2))).toBeNull();
    expect(omahaVpipFloorByLimpIntent({ a: 'call' }, { a: 'fold' }, at(0, 2))).toBeNull();
    expect(omahaVpipFloorByLimpIntent({ a: 'fold' }, { a: 'fold' }, at(0, 2))).toBeNull();
    // the big blind's option: nothing cheaper than the check
    expect(omahaVpipFloorByLimpIntent(raise, { a: 'check' }, at(0, 0))).toEqual({
      intent: { a: 'check' },
      receipt: null,
    });
  });
  it('facing a raise: no re-raise or shove on the floor’s account', () => {
    expect(omahaVpipFloorByLimpIntent({ a: 'jam' }, { a: 'call' }, at(3, 130))).toEqual({
      intent: { a: 'call' },
      receipt: KEPT,
    });
    // the unfloored brain folds: a call only at the call-down's cheap price
    expect(omahaVpipFloorByLimpIntent(raise, { a: 'fold' }, at(1, 9))!.intent).toEqual({
      a: 'call',
    });
    expect(omahaVpipFloorByLimpIntent(raise, { a: 'fold' }, at(1, 14))!.intent).toEqual({
      a: 'fold',
    });
    expect(omahaVpipFloorByLimpIntent(raise, { a: 'jam' }, at(1, 9))).toBeNull();
    // a call the floor buys is left alone
    expect(omahaVpipFloorByLimpIntent({ a: 'call' }, { a: 'fold' }, at(1, 9))).toBeNull();
  });
  it('having limped, facing a raise: the unfloored decision stands', () => {
    expect(omahaVpipFloorByLimpIntent({ a: 'call' }, { a: 'fold' }, at(1, 7, true))).toEqual({
      intent: { a: 'fold' },
      receipt: LIMP_FOLD,
    });
    expect(omahaVpipFloorByLimpIntent(raise, { a: 'call' }, at(1, 7, true))!.intent).toEqual({
      a: 'call',
    });
    expect(omahaVpipFloorByLimpIntent({ a: 'call' }, { a: 'call' }, at(1, 7, true))).toBeNull();
    expect(omahaVpipFloorByLimpIntent(raise, raise, at(1, 7, true))).toBeNull();
  });
});

/** Hands the unfloored brain folds first in on the button. */
const WEAK = ['Kc9d7h5s3c', 'JcTd6h5s2c', 'Qc8d6h3s2c'];
/** Hands it open-raises. */
const STRONG = ['AhAs8h7c4c', 'KhQhJsTs9c', '7c4c8hQhQs'];

describe('first in on the button', () => {
  it('today: under the floor a weak hand open-raises; without a floor it folds', () => {
    for (const hole of WEAK) {
      expect(playMany(0, {}, { line: 'unopened', hole }).actions).toEqual(all('raise'));
      expect(playMany(0, {}, { line: 'unopened', hole, node: noFloor }).actions).toEqual(
        all('fold')
      );
    }
  });

  it('off: unset, false and a truthy non-boolean decide byte-identically', () => {
    for (const hole of [WEAK[0], STRONG[0]]) {
      const unset = playMany(0, {}, { line: 'unopened', hole });
      for (const opts of [
        { omahaVpipFloorByLimp: false },
        { omahaVpipFloorByLimp: 1 as unknown as boolean },
      ])
        expect(playMany(0, opts, { line: 'unopened', hole }).bytes).toEqual(unset.bytes);
    }
  });

  it('on: the weak hand limps, with the receipt, and never raises', () => {
    for (const hole of WEAK) {
      // Unknown, far under and just under the limp target (60%): the limp
      // is certain, whether the floored bar raised the hand or folded it.
      for (const node of [undefined, ownVpip(30), ownVpip(50)]) {
        const on = playMany(0, ON, { line: 'unopened', hole, node });
        expect([hole, on.actions]).toEqual([hole, all('call')]);
        expect(hasFire(on, LIMP)).toBe(SEEDS.length);
      }
      // At the limp target (18 of 30) the floor asks for nothing: the fold.
      const at = { line: 'unopened' as const, hole, node: ownVpip(60) };
      expect(playMany(0, ON, at).actions).toEqual(all('fold'));
    }
  });

  it('a premium and every hand the unfloored brain raises still raise', () => {
    for (const hole of STRONG) {
      const off = playMany(0, {}, { line: 'unopened', hole });
      const on = playMany(0, ON, { line: 'unopened', hole });
      expect(off.actions).toEqual(all('raise'));
      expect([hole, on.actions]).toEqual([hole, off.actions]);
      expect(hasFire(on, LIMP)).toBe(0);
    }
  });

  it('a floor already met, and a table without a floor: today’s play', () => {
    for (const node of [ownVpip(90), noFloor])
      for (const hole of [...WEAK, STRONG[0]]) {
        const v = { line: 'unopened' as const, hole, node };
        expect([hole, playMany(0, ON, v).bytes]).toEqual([hole, playMany(0, {}, v).bytes]);
      }
  });
});

describe('having limped, facing the big blind’s raise', () => {
  it('today: the floor call-down buys the call; without a floor the hand folds', () => {
    for (const hole of WEAK) {
      expect(playMany(0, {}, { line: 'limped', hole }).actions).toEqual(all('call'));
      expect(playMany(0, {}, { line: 'limped', hole, node: noFloor }).actions).toEqual(all('fold'));
    }
  });

  it('off: unset and false decide byte-identically', () => {
    const v = { line: 'limped' as const, hole: WEAK[0] };
    expect(playMany(0, { omahaVpipFloorByLimp: false }, v).bytes).toEqual(playMany(0, {}, v).bytes);
  });

  it('on: the limp is folded, with the receipt, and the call-down does not buy it back', () => {
    for (const hole of WEAK)
      for (const node of [undefined, ownVpip(30), ownVpip(50)]) {
        const on = playMany(0, ON, { line: 'limped', hole, node });
        expect([hole, on.actions]).toEqual([hole, all('fold')]);
        expect(hasFire(on, LIMP_FOLD)).toBe(SEEDS.length);
        expect(hasFire(on, 'vpip_floor_call_down')).toBe(0);
      }
  });

  it('a hand that clears the ordinary calling bar calls; a premium re-raises as today', () => {
    // the recorded queens: the unfloored brain calls 7 more, the floored one re-raises
    const queens = { line: 'limped' as const, hole: '7c4c8hQhQs' };
    expect(playMany(0, {}, queens).actions).toEqual(all('raise'));
    expect(playMany(0, ON, queens).actions).toEqual(all('call'));
    expect(playMany(0, {}, { ...queens, node: noFloor }).actions).toEqual(all('call'));
    const aces = { line: 'limped' as const, hole: 'AhAs8h7c4c' };
    expect(playMany(0, ON, aces).actions).toEqual(all('raise'));
  });

  it('a floor already met: today’s play', () => {
    for (const hole of [WEAK[0], '7c4c8hQhQs']) {
      const v = { line: 'limped' as const, hole, node: ownVpip(90) };
      expect(playMany(0, ON, v).bytes).toEqual(playMany(0, {}, v).bytes);
    }
  });
});

describe('the recorded re-raise to 50 (decision 7)', () => {
  it('today: the floor makes it a re-raise; without a floor the hand folds to the open', () => {
    expect(playMany(7, {}).actions).toEqual(all('raise'));
    expect(playMany(7, {}, { node: ownVpip(30) }).actions).toEqual(all('raise'));
    expect(playMany(7, {}, { node: noFloor }).actions).toEqual(all('fold'));
  });

  it('off: unset, false and a truthy non-boolean decide byte-identically', () => {
    for (const v of [{}, { node: ownVpip(30) }]) {
      const unset = playMany(7, {}, v);
      for (const opts of [
        { omahaVpipFloorByLimp: false },
        { omahaVpipFloorByLimp: 1 as unknown as boolean },
      ])
        expect(playMany(7, opts, v).bytes).toEqual(unset.bytes);
    }
  });

  it('on: the re-raise does not happen; the hand calls 9, with the receipt', () => {
    for (const v of [{}, { node: ownVpip(20) }, { node: ownVpip(30) }, { node: ownVpip(40) }]) {
      const on = playMany(7, ON, v);
      expect(on.actions).toEqual(all('call'));
    }
    // with no sample yet the floored bar still re-raises it, and the rule withholds that
    expect(hasFire(playMany(7, ON), KEPT)).toBe(SEEDS.length);
  });

  it('suited aces still re-raise', () => {
    for (const hole of ['AhAs8h7c4c', 'AhAsKhKsQc']) {
      const off = playMany(7, {}, { hole });
      const on = playMany(7, ON, { hole });
      expect(off.actions).toEqual(all('raise'));
      expect(on.actions).toEqual(off.actions);
      expect(hasFire(on, KEPT)).toBe(0);
    }
  });

  it('a floor already met and a table without a floor are unchanged; just under the limp target the hand calls', () => {
    for (const node of [ownVpip(90), noFloor]) {
      const off = playMany(7, {}, { node });
      const on = playMany(7, ON, { node });
      expect(on.bytes).toEqual(off.bytes);
    }
    expect(playMany(7, {}, { node: ownVpip(50) }).actions).toEqual(all('call'));
    expect(playMany(7, ON, { node: ownVpip(50) }).actions).toEqual(all('call'));
    // at the limp target the floor asks for nothing: the unfloored fold
    expect(playMany(7, ON, { node: ownVpip(60) }).actions).toEqual(all('fold'));
  });

  it('PLO4 gets the rule; Hi-Lo does not', () => {
    const plo4 = { hole: '7c8hQhQs', variant: 'plo4' as const };
    const off4 = playMany(7, {}, plo4);
    const on4 = playMany(7, ON, plo4);
    const raisedOff = off4.actions.filter((a) => a === 'raise').length;
    expect(raisedOff).toBeGreaterThan(0);
    expect(on4.actions.filter((a) => a === 'raise').length).toBe(0);
    expect(hasFire(on4, KEPT)).toBe(raisedOff);
    const plo8 = { hole: '7c8hQhQs', variant: 'plo8' as const };
    expect(playMany(7, ON, plo8).bytes).toEqual(playMany(7, {}, plo8).bytes);
  });
});

describe('facing the cold 4-bet (decision 13)', () => {
  it('today: with the own VPIP unknown or well under the target the floored bar shoves', () => {
    expect(playMany(13, {}).actions).toEqual(all('all_in'));
    expect(playMany(13, {}, { node: ownVpip(30) }).actions).toEqual(all('all_in'));
    expect(playMany(13, {}, { node: noFloor }).actions).toEqual(all('call'));
  });

  it('off: unset and false decide byte-identically', () => {
    expect(playMany(13, { omahaVpipFloorByLimp: false }).bytes).toEqual(playMany(13, {}).bytes);
  });

  it('on: the shove becomes the call the unfloored table makes, with the receipt', () => {
    for (const v of [{}, { node: ownVpip(20) }, { node: ownVpip(30) }, { node: ownVpip(40) }]) {
      const on = playMany(13, ON, v);
      expect(on.actions).toEqual(all('call'));
    }
    expect(hasFire(playMany(13, ON), KEPT)).toBe(SEEDS.length);
  });

  it('aces still put the stack in; a floor already met is unchanged', () => {
    const aces = { hole: 'AhAs8h7c4c' };
    expect(playMany(13, ON, aces).actions).toEqual(playMany(13, {}, aces).actions);
    const met = { node: ownVpip(90) };
    expect(playMany(13, ON, met).bytes).toEqual(playMany(13, {}, met).bytes);
  });
});

describe('the flop and the turn (decisions 16 and 19)', () => {
  it('are unchanged: the floor does not enter a postflop decision', () => {
    for (const ord of [16, 19]) {
      const off = playMany(ord, {});
      expect(playMany(ord, ON).bytes).toEqual(off.bytes);
      expect(playMany(ord, {}, { node: noFloor }).actions).toEqual(off.actions);
    }
  });
});

describe('in the league', () => {
  it('seats no floored table: the refused matchup plays identical poker in both arms', async () => {
    for (const variant of ['plo4', 'plo5']) {
      const r = await runMatchup(
        {
          name: `${variant}_omaha_vpip_floor_by_limp`,
          variant,
          a: { omahaVpipFloorByLimp: true },
          b: {},
        },
        300,
        20261115
      );
      expect(r.divergentPairs).toBe(0);
      expect(r.illegalActions).toBe(0);
    }
  }, 600_000);
});
