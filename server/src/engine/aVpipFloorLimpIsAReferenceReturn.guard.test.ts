import { describe, expect, it } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import { HorseLogic, vpipFloorLimpOnlyStep, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { stateAt } from './HorseComplaintReplay.js';
import { publicMemoryDomainFromRules } from './HorsePublicMemoryDomain.js';
import {
  LIVE,
  PRODUCTION_28372C9A,
  SPOTS,
  buildFixture,
  cards,
  type Spot,
} from './HorseVpipFloorLimpOnly.test-support.js';
import {
  horsePhase6AttributionMismatch,
  necessaryReferenceRouteGates,
  referenceReturnShape,
} from './HorsePhase6Attribution.js';
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';

/*
 * THE FLOOR'S LIMP IS A REFERENCE RETURN, ALSO FOR A SHORT HOLD'EM STACK (2026-11-19).
 *
 * Production, build dfaa9717, with lightningVpipFloorLimpOnly on for 28 minutes
 * (18:27:30Z to 18:55:37Z): /health recoverableRequestErrors rose from 0 to 8,
 * every one "invalid policy receipt: reference_shape" on DECIDE_FAST, the last
 * at 18:38:22.516Z. The hand history holds the three that reached a real turn
 * as liveness folds (origin horse_fallback), and they are the only such folds
 * on any table between 15:00Z and 19:10Z: Lightning NLH 0.50/1.00 hands
 * 60140196, 60140303 and 60140317 (the last at 18:38:22.516Z to the
 * millisecond), one Horse on 8.92, 6.92 and 6.92 big blinds in a non-blind
 * seat, folded to, one big blind to call, a big-blind ante in the pot.
 *
 * A hold'em stack of 15 big blinds or less that is folded to is answered by the
 * push/fold source (route chart_open_jam: jam, check or fold). The pool floor
 * then turned that fold into the one-big-blind limp inside the reference node,
 * after the route had returned, and the shape check admitted a call on that
 * route only through the older floor call-down, which a pool never arms. The
 * Horse's own legal limp was refused and the engine folded the seat.
 *
 * The table option vpipFloorLimpOnly (on since 2026-11-18) has the same hole
 * under 6.67 big blinds, where the call-down's 15%-of-stack cap refuses the
 * limp: six liveness folds on NLH 0.50/1 tables in its first day (hands
 * 60022420, 60022464, 60033867, 60034175, 60074986, 60075065; stacks 5.85 to
 * 6.35 big blinds; none the day before).
 *
 * The spots below are that public shape on the shared six-seat fixture (blinds
 * 1/2, big-blind ante 2), anonymised to seats. Hole cards are seeded or
 * chosen here; no recorded card of any player is in this file.
 */

const BB = 2;
const UNDER = { floor: 40, windowHands: 10, own: { hands: 9, vpipHands: 2 } };
const AT_LINE = { floor: 40, windowHands: 10, own: { hands: 9, vpipHands: 4 } };
const LEAVING = {
  floor: 40,
  windowHands: 10,
  own: { hands: 9, vpipHands: 4, leavingEntered: true },
};
const POOL_ON: HorseDecideOpts = { ...PRODUCTION_28372C9A, lightningVpipFloorLimpOnly: true };
const TABLE_ON: HorseDecideOpts = { ...PRODUCTION_28372C9A, vpipFloorLimpOnly: true };
const TEN_HAND_ON: HorseDecideOpts = {
  ...PRODUCTION_28372C9A,
  vpipFloorLimpOnly: true,
  vpipFloorLimpOnlyTenHandWindow: true,
};

type Snap = { player: SeatPlayer; gameState: HorseGameStateV2; opts: HorseDecideOpts };

/** The public state of `spot` in hold'em with the hero on `stackBB` big blinds behind. */
function spotState(
  spot: Spot,
  hole: Card[],
  stackBB: number,
  kind: 'pool' | 'table',
  floor: unknown,
  extra?: (gs: Record<string, unknown>) => void,
  windowHands = 30
): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const table =
    kind === 'table'
      ? {
          variant: 'nlh' as const,
          floor: 40,
          window: windowHands,
          ownVpip: floor as { hands: number; vpip: number },
        }
      : { variant: 'nlh' as const, floor: 0 };
  const fx = buildFixture(spot, table, hole);
  const st = stateAt(fx, fx.actions[fx.actions.length - 1]);
  const gs = st.gs as unknown as Record<string, unknown>;
  const hero = st.hero;
  hero.stack = stackBB * BB;
  const row = (gs.players as SeatPlayer[]).find((p) => p.seat === hero.seat)!;
  row.stack = hero.stack;
  gs.maxRaiseTo = hero.stack + hero.bet;
  gs.minRaiseTo = Math.min(Number(gs.maxRaiseTo), Number(gs.minRaiseTo));
  gs.publicMemoryDomain = publicMemoryDomainFromRules(
    kind === 'pool' ? 'lightning' : 'table',
    typeof gs.ante === 'number' ? gs.ante : 0,
    gs.bigBlindAnte === true
  );
  if (kind === 'pool') {
    delete gs.vpipFloor;
    delete gs.vpipWindowHands;
    delete gs.ownVpip;
    if (floor) gs.lightningVpipFloor = JSON.parse(JSON.stringify(floor));
  }
  extra?.(gs);
  return { hero, gs: gs as unknown as HorseGameStateV2 };
}

function decide(hero: SeatPlayer, gs: HorseGameStateV2, opts: HorseDecideOpts, seed: number) {
  HorseMind.reset();
  seedFastRandom(seed);
  seedHorseTimingRandom(seed);
  const decision = HorseLogic.decide(hero, gs, LIVE.style, LIVE.mods, { mind: false, ...opts });
  return { decision, next: fastRandom() };
}

/** Weak offsuit hands the push/fold source folds from every seat at these depths. */
const WEAK = ['7c2d', '8h3s', '9d2c', '6s2h', 'Tc3d', '5h2s', '8d2s', '7s3h'].map(cards);
const FIRST_IN = ['utgFirstIn', 'hjFirstIn', 'coFirstIn', 'btnFirstIn', 'sbFirstIn'] as const;
const DEPTHS = [5.85, 6.35, 6.92, 8.92, 12, 14.5];
const core = (d: HorseDecision) => ({ action: d.action, amount: d.amount, thinkTime: d.thinkTime });

describe('the pool floor limp of a short hold’em stack (lightningVpipFloorLimpOnly)', () => {
  it('reproduces the live refusal: chart_open_jam, a one-big-blind limp, now admitted', () => {
    let limps = 0;
    const seats = new Set<string>();
    for (const name of FIRST_IN)
      for (const depth of DEPTHS)
        for (const [i, hole] of WEAK.entries()) {
          const { hero, gs } = spotState(SPOTS[name], hole, depth, 'pool', UNDER);
          const { decision } = decide(hero, gs, POOL_ON, 4100 + i);
          const r = decision.tournamentPreflopAttribution;
          if (r?.route !== 'chart_open_jam' || decision.action !== 'call') continue;
          limps++;
          seats.add(name);
          const toCall = gs.currentBet - hero.bet;
          expect(toCall).toBeLessThanOrEqual(BB);
          expect(r.referenceProposal).toEqual({ action: 'call', amount: toCall });
          const snapshot: Snap = { player: hero, gameState: gs, opts: POOL_ON };
          expect(necessaryReferenceRouteGates('chart_open_jam', snapshot)).toBe(true);
          // Before the fix: 'reference_shape' (the engine then folded the seat).
          expect(horsePhase6AttributionMismatch(decision, snapshot)).toBeNull();
        }
    expect(limps).toBeGreaterThan(40);
    // every first-in seat, the small blind's completion included
    expect([...seats].sort()).toEqual([...FIRST_IN].sort());
  });

  it('admits the limp only where the option could produce it', () => {
    const { hero, gs } = spotState(SPOTS.btnFirstIn, WEAK[0], 6.92, 'pool', UNDER);
    const limp = {
      route: 'chart_open_jam' as const,
      referenceProposal: { action: 'call' as const, amount: BB },
    };
    const ask = (
      g: HorseGameStateV2,
      opts: HorseDecideOpts,
      p = hero,
      amount: number | null = BB
    ) =>
      referenceReturnShape({ ...limp, referenceProposal: { action: 'call', amount } } as never, {
        player: p,
        gameState: g,
        opts,
      });
    expect(ask(gs, POOL_ON)).toBe(true);
    // the request's opts never carry the pool option: the switch delivers it
    // inside the worker after the request is built (#11491), so a limp the
    // pool floor COULD make is admitted whatever the opts say
    expect(ask(gs, PRODUCTION_28372C9A)).toBe(true);
    expect(ask(gs, { ...PRODUCTION_28372C9A, lightningVpipFloorLimpOnly: false })).toBe(true);
    expect(
      ask(gs, { ...PRODUCTION_28372C9A, lightningVpipFloorLimpOnly: 'on' as unknown as boolean })
    ).toBe(true);
    expect(ask(gs, TABLE_ON)).toBe(true);
    // any other amount
    for (const amount of [BB - 0.01, BB + 0.01, 1, 2 * BB, null])
      expect(ask(gs, POOL_ON, hero, amount)).toBe(false);
    // at the floor with nothing leaving, no pool field, a carried count, a table, a tournament,
    // an All-In-Or-Fold game, a bomb pot, a straddle: no limp exists, none is admitted
    const variants: Array<[string, (g: Record<string, unknown>) => void]> = [
      ['at the floor', (g) => (g.lightningVpipFloor = AT_LINE)],
      ['no field', (g) => delete g.lightningVpipFloor],
      [
        'carried count',
        (g) =>
          (g.lightningVpipFloor = { floor: 40, windowHands: 10, own: { hands: 4, vpipHands: 0 } }),
      ],
      ['a table', (g) => (g.publicMemoryDomain = publicMemoryDomainFromRules('table', 2, true))],
      ['tournament', (g) => (g.gameMode = 'tournament')],
      ['all-in-or-fold', (g) => (g.allInOrFold = true)],
      ['bomb pot', (g) => (g.bombPot = true)],
      ['straddle', (g) => (g.straddleActive = true)],
    ];
    for (const [name, change] of variants) {
      const v = spotState(SPOTS.btnFirstIn, WEAK[0], 6.92, 'pool', UNDER, change);
      expect(ask(v.gs, POOL_ON, v.hero), name).toBe(false);
    }
    // one hand early (preempt): the priced limp is possible, so its shape is admitted
    const early = spotState(SPOTS.btnFirstIn, WEAK[0], 6.92, 'pool', LEAVING);
    expect(ask(early.gs, POOL_ON, early.hero)).toBe(true);
    // a raised pot has no limp: the floor folds to a raise
    const raised = spotState(
      {
        hero: 4,
        prior: [
          [1, 'fold'],
          [2, 'fold'],
          [3, 'raise', 6],
        ],
      },
      WEAK[0],
      6.92,
      'pool',
      UNDER
    );
    expect(ask(raised.gs, POOL_ON, raised.hero, 6)).toBe(false);
    expect(ask(raised.gs, POOL_ON, raised.hero, BB)).toBe(false);
    // a stack that cannot cover the limp has none (the step requires chips behind)
    const dust = spotState(SPOTS.btnFirstIn, WEAK[0], 1, 'pool', UNDER);
    expect(ask(dust.gs, POOL_ON, dust.hero)).toBe(false);
  });

  it('the small blind completion is admitted at its own price, cent stakes included', () => {
    const { hero, gs } = spotState(SPOTS.sbFirstIn, WEAK[0], 6.92, 'pool', UNDER);
    const r = {
      route: 'chart_open_jam',
      referenceProposal: { action: 'call', amount: 1 },
    } as never;
    expect(referenceReturnShape(r, { player: hero, gameState: gs, opts: POOL_ON })).toBe(true);
    // 0.02/0.05: the completion owes 0.05 - 0.02 = 0.030000000000000002; the step returns 0.03
    const cent = spotState(SPOTS.sbFirstIn, WEAK[0], 6.92, 'pool', UNDER, (g) => {
      g.bigBlind = 0.05;
      g.smallBlind = 0.02;
      g.currentBet = 0.05;
      g.ante = 0.05;
    });
    cent.hero.bet = 0.02;
    cent.hero.stack = 0.33;
    expect(cent.gs.currentBet - cent.hero.bet).not.toBe(0.03);
    const step = vpipFloorLimpOnlyStep(
      { action: 'fold', thinkTime: 0 },
      cent.hero,
      cent.gs,
      () => 0,
      'every',
      2
    );
    expect(step.decision).toMatchObject({ action: 'call', amount: 0.03 });
    const rc = {
      route: 'chart_open_jam',
      referenceProposal: { action: 'call', amount: 0.03 },
    } as never;
    expect(referenceReturnShape(rc, { player: cent.hero, gameState: cent.gs, opts: POOL_ON })).toBe(
      true
    );
  });

  it('option off: the decision, its receipt and the random stream are the ones they were', () => {
    let seen = 0;
    for (const name of FIRST_IN)
      for (const depth of [6.92, 12])
        for (const [i, hole] of WEAK.slice(0, 4).entries()) {
          const a = spotState(SPOTS[name], hole, depth, 'pool', UNDER);
          const b = spotState(SPOTS[name], hole, depth, 'pool', null);
          const off = decide(a.hero, a.gs, PRODUCTION_28372C9A, 4300 + i);
          const bare = decide(b.hero, b.gs, PRODUCTION_28372C9A, 4300 + i);
          expect(core(off.decision)).toEqual(core(bare.decision));
          expect(off.decision.tournamentPreflopAttribution).toEqual(
            bare.decision.tournamentPreflopAttribution
          );
          expect(off.next).toBe(bare.next);
          expect(
            horsePhase6AttributionMismatch(off.decision, {
              player: a.hero,
              gameState: a.gs,
              opts: PRODUCTION_28372C9A,
            })
          ).toBeNull();
          seen++;
        }
    expect(seen).toBe(40);
  });
});

describe('the table floor limp of a short hold’em stack (vpipFloorLimpOnly)', () => {
  /** 30-hand window at 40%: the line is 15 of 30; 20% is nine hands short. */
  const OWN = { hands: 30, vpip: 20 };

  it('under 6.67 big blinds the limp was refused on chart_open_jam; it is admitted', () => {
    let limps = 0;
    let underCap = 0;
    for (const name of FIRST_IN)
      for (const depth of DEPTHS)
        for (const [i, hole] of WEAK.entries()) {
          const { hero, gs } = spotState(SPOTS[name], hole, depth, 'table', OWN);
          const { decision } = decide(hero, gs, TABLE_ON, 4500 + i);
          const r = decision.tournamentPreflopAttribution;
          if (r?.route !== 'chart_open_jam' || decision.action !== 'call') continue;
          limps++;
          const toCall = gs.currentBet - hero.bet;
          if (toCall > 0.15 * hero.stack) underCap++;
          expect(r.referenceProposal).toEqual({ action: 'call', amount: toCall });
          expect(
            horsePhase6AttributionMismatch(decision, {
              player: hero,
              gameState: gs,
              opts: TABLE_ON,
            })
          ).toBeNull();
        }
    expect(limps).toBeGreaterThan(20);
    // the part the call-down admission never covered (the six live folds were here)
    expect(underCap).toBeGreaterThan(5);
  });

  it('admits it only under the line, on a floored table; the request opts need not carry the option', () => {
    const limp = {
      route: 'chart_open_jam',
      referenceProposal: { action: 'call', amount: BB },
    } as never;
    const at = (
      own: unknown,
      opts: HorseDecideOpts,
      change?: (g: Record<string, unknown>) => void
    ) => {
      const { hero, gs } = spotState(SPOTS.btnFirstIn, WEAK[0], 6.35, 'table', own, change);
      return referenceReturnShape(limp, { player: hero, gameState: gs, opts });
    };
    expect(at(OWN, TABLE_ON)).toBe(true);
    // The switch delivers vpipFloorLimpOnly inside the worker after the request
    // is built (as #11491 found for the pool option): silent request opts must
    // not refuse the table floor's limp. The public conditions below still do.
    expect(at(OWN, PRODUCTION_28372C9A)).toBe(true);
    expect(at(OWN, POOL_ON)).toBe(true);
    expect(at(OWN, PRODUCTION_28372C9A, (g) => delete g.vpipFloor)).toBe(false);
    expect(at({ hands: 30, vpip: 60 }, PRODUCTION_28372C9A)).toBe(false);
    expect(at({ hands: 30, vpip: 60 }, TABLE_ON)).toBe(false); // over the line
    expect(at({ hands: 2, vpip: 0 }, TABLE_ON)).toBe(false); // no judged sample yet
    expect(at(OWN, TABLE_ON, (g) => delete g.vpipFloor)).toBe(false); // no floor
    expect(at(OWN, TABLE_ON, (g) => (g.gameMode = 'tournament'))).toBe(false);
    expect(at(OWN, TABLE_ON, (g) => (g.straddleActive = true))).toBe(false);
  });
});

describe('the ten-hand table floor limp of a short hold’em stack (vpipFloorLimpOnlyTenHandWindow)', () => {
  /** 10-hand window at 40%: the target is 7 of 10; 20% over 9 hands is well short. */
  const OWN_TEN = { hands: 9, vpip: 22 };

  it('on a ten-hand table, chart_open_jam limps at short depths are admitted (including under 6.67bb)', () => {
    let limps = 0;
    let underCap = 0;
    const seats = new Set<string>();
    for (const name of FIRST_IN)
      for (const depth of DEPTHS)
        for (const [i, hole] of WEAK.entries()) {
          const { hero, gs } = spotState(SPOTS[name], hole, depth, 'table', OWN_TEN, undefined, 10);
          const { decision } = decide(hero, gs, TEN_HAND_ON, 4700 + i);
          const r = decision.tournamentPreflopAttribution;
          if (r?.route !== 'chart_open_jam' || decision.action !== 'call') continue;
          limps++;
          seats.add(name);
          const toCall = gs.currentBet - hero.bet;
          if (toCall > 0.15 * hero.stack) underCap++;
          expect(toCall).toBeLessThanOrEqual(BB);
          expect(r.referenceProposal).toEqual({ action: 'call', amount: toCall });
          const snapshot: Snap = { player: hero, gameState: gs, opts: TEN_HAND_ON };
          expect(necessaryReferenceRouteGates('chart_open_jam', snapshot)).toBe(true);
          expect(horsePhase6AttributionMismatch(decision, snapshot)).toBeNull();
        }
    expect(limps).toBeGreaterThan(20);
    expect(underCap).toBeGreaterThan(5);
    expect([...seats].sort()).toEqual([...FIRST_IN].sort());
  });

  it('admits the ten-hand table limp only under the line; switch delivery need not appear in request opts', () => {
    const limp = {
      route: 'chart_open_jam',
      referenceProposal: { action: 'call', amount: BB },
    } as never;
    const at = (
      own: unknown,
      opts: HorseDecideOpts,
      change?: (g: Record<string, unknown>) => void
    ) => {
      const { hero, gs } = spotState(SPOTS.btnFirstIn, WEAK[0], 6.35, 'table', own, change, 10);
      return referenceReturnShape(limp, { player: hero, gameState: gs, opts });
    };
    expect(at(OWN_TEN, TEN_HAND_ON)).toBe(true);
    expect(at(OWN_TEN, TABLE_ON)).toBe(true);
    expect(at(OWN_TEN, PRODUCTION_28372C9A)).toBe(true);
    expect(at({ hands: 10, vpip: 70 }, TEN_HAND_ON)).toBe(false); // at/over the 7-of-10 line
    expect(at({ hands: 2, vpip: 0 }, TEN_HAND_ON)).toBe(false); // no judged sample yet
    expect(at(OWN_TEN, TEN_HAND_ON, (g) => delete g.vpipFloor)).toBe(false); // no floor
    expect(at(OWN_TEN, TEN_HAND_ON, (g) => (g.gameMode = 'tournament'))).toBe(false);
    expect(at(OWN_TEN, TEN_HAND_ON, (g) => (g.straddleActive = true))).toBe(false);
  });
});
