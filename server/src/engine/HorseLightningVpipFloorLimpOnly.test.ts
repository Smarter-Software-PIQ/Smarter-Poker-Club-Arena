/**
 * A LIGHTNING POOL'S VPIP FLOOR BINDS ITS HORSES, BY THE LIMP AND NOTHING
 * ELSE (option lightningVpipFloorLimpOnly, default OFF).
 *
 * Owner 2026-11-18 10:52 Chicago: "yes if a game requires a vpip horses must
 * always follow". The spots are six-handed PLO5 1/2 Lightning with a
 * big-blind ante, every Horse on the option set production decided with
 * (HorseLightningParity.test-support). First-in hands are seeded deals: a
 * Horse that pressed the fast fold has no recorded cards.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  VPIP_LIMP_BUFFER_HANDS,
  lightningVpipFloorLimpOnlyInputs,
  vpipFloorLimpOnlyShortfall,
  type HorseDecideOpts,
} from './HorseLogic.js';
import { disarmBrainTelemetryForTest, drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  validatedHorsePolicySamplingKey,
  buildHorseDecisionKey,
} from './horseDecision/protocol.js';
import { limpedThenRaised, SPOTS, decideAt } from './HorseVpipFloorLimpOnly.test-support.js';
import {
  BASE,
  RECORDED_LINES,
  asTable,
  deals,
  decideLightning,
  type PoolFloor,
} from './HorseLightningParity.test-support.js';

const ON: HorseDecideOpts = { ...BASE, lightningVpipFloorLimpOnly: true };
/** Twenty hands dealt, four entered: under the line (ceil(0.40 x 20) + 3 = 11). */
const UNDER: PoolFloor = { floor: 40, windowHands: 10, own: { hands: 20, vpipHands: 4 } };
/** Twenty hands dealt, eleven entered: at the line. */
const AT_LINE: PoolFloor = { floor: 40, windowHands: 10, own: { hands: 20, vpipHands: 11 } };
const UNRAISED = [
  'utgFirstIn',
  'hjFirstIn',
  'coFirstIn',
  'btnFirstIn',
  'sbFirstIn',
  'hjLimped',
] as const;
const RAISED = ['sbFacingButtonOpen', 'bbFacingCutoffOpenAndCall', 'bbFacingReRaise'] as const;
const HANDS = deals(20261118, 24);
/** What the Horse does: the action, its amount and its think time (diagnostics and state hashes aside). */
const core = (d: { decision: { action: string; amount?: number; thinkTime?: number } }) => ({
  action: d.decision.action,
  amount: d.decision.amount,
  thinkTime: d.decision.thinkTime,
});

describe('lightningVpipFloorLimpOnlyInputs', () => {
  const gs = (f: PoolFloor | undefined, more: Record<string, unknown> = {}) => ({
    gameMode: 'cash',
    publicMemoryDomain: { speed: 'lightning' },
    lightningVpipFloor: f,
    ...more,
  });
  const on: HorseDecideOpts = { lightningVpipFloorLimpOnly: true };

  it('is null with the option absent, false or a truthy non-boolean', () => {
    expect(lightningVpipFloorLimpOnlyInputs(gs(UNDER), {}, false)).toBeNull();
    expect(
      lightningVpipFloorLimpOnlyInputs(gs(UNDER), { lightningVpipFloorLimpOnly: false }, false)
    ).toBeNull();
    expect(
      lightningVpipFloorLimpOnlyInputs(
        gs(UNDER),
        { lightningVpipFloorLimpOnly: 'on' as unknown as boolean },
        false
      )
    ).toBeNull();
  });

  it('is null at a table, in a tournament, on an All-In-Or-Fold hand and without the count', () => {
    expect(
      lightningVpipFloorLimpOnlyInputs(
        gs(UNDER, { publicMemoryDomain: { speed: 'table' } }),
        on,
        false
      )
    ).toBeNull();
    expect(
      lightningVpipFloorLimpOnlyInputs(gs(UNDER, { publicMemoryDomain: null }), on, false)
    ).toBeNull();
    expect(lightningVpipFloorLimpOnlyInputs(gs(UNDER), on, true)).toBeNull();
    expect(
      lightningVpipFloorLimpOnlyInputs(gs(UNDER, { allInOrFold: true }), on, false)
    ).toBeNull();
    expect(lightningVpipFloorLimpOnlyInputs(gs(undefined), on, false)).toBeNull();
    for (const bad of [
      { floor: 0, windowHands: 10, own: { hands: 20, vpipHands: 4 } },
      { floor: 40, windowHands: 0, own: { hands: 20, vpipHands: 4 } },
      { floor: 40, windowHands: 10, own: { hands: 20, vpipHands: 21 } },
      { floor: 40, windowHands: 10, own: { hands: 2.5, vpipHands: 1 } },
      { floor: 40, windowHands: 10, own: { hands: -1, vpipHands: 0 } },
    ])
      expect(lightningVpipFloorLimpOnlyInputs(gs(bad), on, false)).toBeNull();
  });

  it('judges the whole sitting, never fewer hands than the window', () => {
    // 20 dealt, 4 entered: needs ceil(8) + buffer, is 4 short of 8 and the buffer on top
    const a = lightningVpipFloorLimpOnlyInputs(gs(UNDER), on, false)!;
    expect(a.vpipWindowHands).toBe(20);
    expect(vpipFloorLimpOnlyShortfall(a)).toBeCloseTo(8 + VPIP_LIMP_BUFFER_HANDS - 4, 9);
    // 5 dealt, 1 entered: judged over the ten-hand window (ceil(4) + buffer - 1)
    const b = lightningVpipFloorLimpOnlyInputs(
      gs({ floor: 40, windowHands: 10, own: { hands: 5, vpipHands: 1 } }),
      on,
      false
    )!;
    expect(b.vpipWindowHands).toBe(10);
    expect(vpipFloorLimpOnlyShortfall(b)).toBeCloseTo(4 + VPIP_LIMP_BUFFER_HANDS - 1, 9);
    // at the line: nothing short
    expect(
      vpipFloorLimpOnlyShortfall(lightningVpipFloorLimpOnlyInputs(gs(AT_LINE), on, false)!)
    ).toBe(0);
    // fewer than three hands on the count: no judged sample, no action
    expect(
      vpipFloorLimpOnlyShortfall(
        lightningVpipFloorLimpOnlyInputs(
          gs({ floor: 40, windowHands: 10, own: { hands: 2, vpipHands: 0 } }),
          on,
          false
        )!
      )
    ).toBeNull();
    // 200 dealt at 41.5%: the buffer is three hands, not thirty points
    expect(
      vpipFloorLimpOnlyShortfall(
        lightningVpipFloorLimpOnlyInputs(
          gs({ floor: 40, windowHands: 10, own: { hands: 200, vpipHands: 83 } }),
          on,
          false
        )!
      )
    ).toBe(0);
  });
});

describe('lightningVpipFloorLimpOnly off: a pool decision is the one it was', () => {
  it('carrying the pool floor changes no decision and no draw (option absent, false, non-boolean)', () => {
    let compared = 0;
    for (const name of [...UNRAISED, ...RAISED]) {
      for (const [i, hole] of HANDS.slice(0, 8).entries()) {
        const seed = 7000 + i;
        const base = decideLightning(SPOTS[name], hole, BASE, seed, null);
        for (const opts of [
          BASE,
          { ...BASE, lightningVpipFloorLimpOnly: false },
          { ...BASE, lightningVpipFloorLimpOnly: 'on' as unknown as boolean },
          // the table option never governs a pool, with or without the pool field
          { ...BASE, vpipFloorLimpOnly: true },
        ]) {
          const got = decideLightning(SPOTS[name], hole, opts, seed, UNDER);
          expect(core(got)).toEqual(core(base));
          expect(got.next).toBe(base.next);
          compared++;
        }
      }
    }
    expect(compared).toBe(9 * 8 * 4);
  });

  it('the pool floor is outside the policy sampling key', () => {
    const snapshot = (withFloor: boolean) => {
      const gameState = {
        stage: 'preflop',
        smallBlind: 1,
        bigBlind: 2,
        players: [],
        ...(withFloor ? { lightningVpipFloor: UNDER } : {}),
      } as never;
      const input = {
        fence: 'f',
        decisionTimeMs: 1_795_000_000_000,
        player: { seat: 1 } as never,
        gameState,
        style: 'balanced' as never,
        mods: undefined,
        opts: undefined,
        handJournalContext: undefined,
        handJournalCoordinate: undefined,
      };
      return { ...input, decisionKey: buildHorseDecisionKey(input) };
    };
    const a = snapshot(false);
    const b = snapshot(true);
    expect(a.decisionKey).not.toBe(b.decisionKey);
    expect(validatedHorsePolicySamplingKey(b)).toBe(validatedHorsePolicySamplingKey(a));
  });
});

describe('lightningVpipFloorLimpOnly on', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    drainFires();
  });
  afterEach(() => {
    drainFires();
    disarmBrainTelemetryForTest();
  });

  it('under the line, every unraised fold becomes the limp for at most one big blind; nothing else moves', () => {
    let limps = 0;
    let kept = 0;
    for (const name of UNRAISED) {
      for (const [i, hole] of HANDS.entries()) {
        const seed = 9000 + i;
        const base = decideLightning(SPOTS[name], hole, BASE, seed, UNDER);
        const on = decideLightning(SPOTS[name], hole, { ...ON, telemetry: true }, seed, UNDER);
        if (base.decision.action === 'fold') {
          expect(on.decision.action).toBe('call');
          expect(on.decision.amount).toBe(base.toCall);
          expect(base.toCall).toBeGreaterThan(0);
          expect(base.toCall).toBeLessThanOrEqual(2);
          limps++;
        } else {
          expect(core(on)).toEqual(core(base));
          expect(on.next).toBe(base.next);
          kept++;
        }
      }
    }
    expect(limps).toBeGreaterThan(20);
    expect(kept).toBeGreaterThan(0);
    const fires = Object.fromEntries(drainFires().map((f) => [f.feature, f.fires]));
    expect(fires.lightning_vpip_floor_limp_only_limp).toBe(limps);
    expect(fires.vpip_floor_call_down ?? 0).toBe(0);
    expect(fires.vpip_floor_limp_only_limp ?? 0).toBe(0);
  });

  it('the small blind completes for half a big blind', () => {
    let seen = 0;
    for (const [i, hole] of HANDS.entries()) {
      const base = decideLightning(SPOTS.sbFirstIn, hole, BASE, 9100 + i, UNDER);
      if (base.decision.action !== 'fold') continue;
      const on = decideLightning(SPOTS.sbFirstIn, hole, ON, 9100 + i, UNDER);
      expect(on.decision).toMatchObject({ action: 'call', amount: 1 });
      seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('never calls a raise and never raises: a raised pot is the unfloored decision, draw for draw', () => {
    let compared = 0;
    const raised = [
      ...RAISED.map((n) => SPOTS[n]),
      limpedThenRaised(SPOTS.utgFirstIn),
      limpedThenRaised(SPOTS.coFirstIn),
      limpedThenRaised(SPOTS.sbFirstIn),
    ];
    for (const spot of raised) {
      for (const [i, hole] of HANDS.entries()) {
        const base = decideLightning(spot, hole, BASE, 9200 + i, UNDER);
        const on = decideLightning(spot, hole, ON, 9200 + i, UNDER);
        expect(core(on)).toEqual(core(base));
        expect(on.next).toBe(base.next);
        compared++;
      }
    }
    expect(compared).toBe(6 * HANDS.length);
    // the recorded Lightning lines (a re-raise in front): the recorded Horse cards
    for (const line of Object.values(RECORDED_LINES)) {
      const base = decideLightning(line.spot, line.hole, BASE, 9300, UNDER);
      const on = decideLightning(line.spot, line.hole, ON, 9300, UNDER);
      expect(core(on)).toEqual(core(base));
      expect(on.next).toBe(base.next);
    }
  });

  it('at or over the line, with no count, at a table and on an All-In-Or-Fold hand it does nothing', () => {
    for (const name of UNRAISED) {
      for (const [i, hole] of HANDS.slice(0, 6).entries()) {
        const seed = 9400 + i;
        const base = decideLightning(SPOTS[name], hole, BASE, seed, null);
        for (const floor of [
          AT_LINE,
          { floor: 40, windowHands: 10, own: { hands: 2, vpipHands: 0 } },
          null,
        ]) {
          const on = decideLightning(SPOTS[name], hole, ON, seed, floor);
          expect(core(on)).toEqual(core(base));
          expect(on.next).toBe(base.next);
        }
        const aof = (gs: Record<string, unknown>) => {
          gs.allInOrFold = true;
        };
        const baseAof = decideLightning(SPOTS[name], hole, BASE, seed, UNDER, aof);
        const onAof = decideLightning(SPOTS[name], hole, ON, seed, UNDER, aof);
        expect(core(onAof)).toEqual(core(baseAof));
        const table = { variant: 'plo5' as const, floor: 0 };
        const baseTable = decideAt(SPOTS[name], table, hole, BASE, seed, asTable(UNDER));
        const onTable = decideAt(SPOTS[name], table, hole, ON, seed, asTable(UNDER));
        expect(core(onTable)).toEqual(core(baseTable));
        expect(onTable.next).toBe(baseTable.next);
      }
    }
  });

  it('a pool whose game has no floor sees no change at all (owner 2026-11-18 11:03)', () => {
    // "NO, ONLY IF THE GAME HAS A VPIP, DON'T MAKE THEM VPIP REQUIRED IF THE GAME DOESN'T HAVE ONE!"
    // The host builds no field for an unfloored game (lightningHorseVpipFloorInput: nit_game and a
    // positive maintain_percent_min, as the table engine reads it), and a zero floor is refused too.
    let compared = 0;
    for (const name of [...UNRAISED, ...RAISED]) {
      for (const [i, hole] of HANDS.slice(0, 8).entries()) {
        const seed = 9600 + i;
        const base = decideLightning(SPOTS[name], hole, BASE, seed, null);
        for (const floor of [
          null,
          { floor: 0, windowHands: 10, own: { hands: 20, vpipHands: 0 } },
        ]) {
          const on = decideLightning(SPOTS[name], hole, ON, seed, floor);
          expect(core(on)).toEqual(core(base));
          expect(on.next).toBe(base.next);
          compared++;
        }
      }
    }
    expect(compared).toBe(9 * 8 * 2);
  });

  it('vpipFloorLimpOnly on beside it changes nothing in a pool', () => {
    for (const [i, hole] of HANDS.slice(0, 8).entries()) {
      const one = decideLightning(SPOTS.coFirstIn, hole, ON, 9500 + i, UNDER);
      const both = decideLightning(
        SPOTS.coFirstIn,
        hole,
        { ...ON, vpipFloorLimpOnly: true },
        9500 + i,
        UNDER
      );
      expect(core(both)).toEqual(core(one));
      expect(both.next).toBe(one.next);
    }
  });
});
