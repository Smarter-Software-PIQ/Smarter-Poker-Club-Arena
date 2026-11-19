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
import { lightningVpipFloorLimpOnlyInputs, type HorseDecideOpts } from './HorseLogic.js';
import { LightningHorseVpipLedger } from '../lightning/LightningHorseVpipLedger.js';
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
/** The last nine hands hold two entered: folding this one leaves the ten-hand window two short of four. */
const UNDER: PoolFloor = { floor: 40, windowHands: 10, own: { hands: 9, vpipHands: 2 } };
/** The last nine hands hold four entered and none leaves entered: at the floor with this hand folded. */
const AT_LINE: PoolFloor = { floor: 40, windowHands: 10, own: { hands: 9, vpipHands: 4 } };
/** At the floor, but the entered hand that leaves next would leave the next window one short. */
const LEAVING: PoolFloor = {
  floor: 40,
  windowHands: 10,
  own: { hands: 9, vpipHands: 4, leavingEntered: true },
};
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

  it("judges the pool's own window, projected with this hand; a younger count takes no action", () => {
    const at = (own: PoolFloor['own'], floor = 40, windowHands = 10) =>
      lightningVpipFloorLimpOnlyInputs(gs({ floor, windowHands, own }), on, false);
    // ten-hand window at 40%: four entered; folding this hand leaves need - entered short
    expect(at({ hands: 9, vpipHands: 2 })).toMatchObject({
      needHands: 4,
      shortfallHands: 2,
      preempt: false,
    });
    expect(at({ hands: 9, vpipHands: 3 })).toMatchObject({ shortfallHands: 1, preempt: false });
    expect(at({ hands: 9, vpipHands: 4 })).toMatchObject({ shortfallHands: 0, preempt: false });
    // at the floor with an entered hand leaving next: the limp may be spent now, priced
    expect(at({ hands: 9, vpipHands: 4, leavingEntered: true })).toMatchObject({
      shortfallHands: 0,
      preempt: true,
    });
    // over the floor: a leaving hand still leaves enough
    expect(at({ hands: 9, vpipHands: 5, leavingEntered: true })).toMatchObject({
      shortfallHands: 0,
      preempt: false,
    });
    // a count carried over a restart, younger than the window: no action until it holds it
    for (const hands of [0, 2, 5, 8]) expect(at({ hands, vpipHands: 0 })).toBeNull();
    // a count that is not the window before this hand is refused (it would judge another sample)
    expect(at({ hands: 20, vpipHands: 4 })).toBeNull();
    expect(at({ hands: 400, vpipHands: 98 })).toBeNull();
    // the game's own floor and window are read, never assumed
    expect(at({ hands: 29, vpipHands: 9 }, 30, 30)).toMatchObject({
      needHands: 9,
      shortfallHands: 0,
    });
    expect(at({ hands: 9, vpipHands: 3 }, 50, 10)).toMatchObject({
      needHands: 5,
      shortfallHands: 2,
    });
  });

  it('a new sitting met from its first hand is judged from that hand: a tight Horse is never short at its first full window', () => {
    const fresh = (hands: number, vpipHands: number) =>
      lightningVpipFloorLimpOnlyInputs(
        gs({ floor: 40, windowHands: 10, own: { hands, vpipHands, fromFirstHand: true } }),
        on,
        false
      );
    // every prefix at the floor: ceil(0.4 x (hands + 1))
    expect(fresh(0, 0)).toMatchObject({ needHands: 1, shortfallHands: 1, preempt: false });
    expect(fresh(1, 1)).toMatchObject({ needHands: 1, shortfallHands: 0 });
    expect(fresh(2, 1)).toMatchObject({ needHands: 2, shortfallHands: 1 });
    expect(fresh(7, 3)).toMatchObject({ needHands: 4, shortfallHands: 1 });
    expect(fresh(8, 4)).toMatchObject({ needHands: 4, shortfallHands: 0, preempt: false });
    // carried over a restart (not from its first hand): nothing
    expect(
      lightningVpipFloorLimpOnlyInputs(
        gs({ floor: 40, windowHands: 10, own: { hands: 5, vpipHands: 0, fromFirstHand: false } }),
        on,
        false
      )
    ).toBeNull();
    // a Horse that would enter nothing on its own, every fold limpable: at the floor at hand ten,
    // and still there with one raised pot (no limp possible) anywhere in its first ten hands
    const ledger = new LightningHorseVpipLedger(100, () => 0, -1);
    for (const raisedAt of [-1, 0, 2, 5, 7, 9]) {
      const ps = 'fresh-' + raisedAt;
      const entered: boolean[] = [];
      for (let h = 0; h < 10; h++) {
        const own = ledger.readWindow(ps, 9);
        expect(own.fromFirstHand).toBe(true);
        const ask = lightningVpipFloorLimpOnlyInputs(
          gs({ floor: 40, windowHands: 10, own }),
          on,
          false
        );
        const limp = h !== raisedAt && ask !== null && ask.shortfallHands > 0;
        entered.push(limp);
        ledger.record(
          [{ playerId: 'h', poolSessionId: ps }],
          limp ? [{ userId: 'h', stage: 'preflop', action: 'call' }] : [],
          h + 1
        );
      }
      expect(entered.filter(Boolean).length).toBeGreaterThanOrEqual(4);
    }
  });

  it('lands on the floor, not over it: a 25% Horse limps only what the window needs, and no catch-up binge', () => {
    // Fail-before (integrator 2026-11-19): the first build judged the whole sitting plus a three-hand
    // buffer, so a Horse that had sat 400 hands at 24.5% before the switch was 65 hands short and limped
    // every unraised fold for about a hundred hands; replayed fast-table hands went 27.7% -> 87.1%.
    // Here the Horse enters a quarter of its hands on its own; every other hand is an unraised fold it
    // could limp, and it limps only when the rule forces it (a preempt is never priced here, the worst case).
    const run = (hands: number, seed: number) => {
      const ledger = new LightningHorseVpipLedger();
      let x = seed >>> 0;
      const rand = () => {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        return x / 2 ** 32;
      };
      // the sitting before the switch: 400 hands at the pool's own Horse rate, no floor action
      for (let h = 0; h < 400; h++) {
        const e = rand() < 0.245;
        ledger.record(
          [{ playerId: 'h', poolSessionId: 's' }],
          e ? [{ userId: 'h', stage: 'preflop', action: 'call' }] : []
        );
      }
      const entered: boolean[] = [];
      for (let h = 0; h < hands; h++) {
        const own = ledger.readWindow('s', 9);
        const ask = lightningVpipFloorLimpOnlyInputs(
          gs({ floor: 40, windowHands: 10, own }),
          on,
          false
        );
        const natural = rand() < 0.25;
        const limp = !natural && ask !== null && ask.shortfallHands > 0;
        const e = natural || limp;
        entered.push(e);
        ledger.record(
          [{ playerId: 'h', poolSessionId: 's' }],
          e ? [{ userId: 'h', stage: 'preflop', action: 'call' }] : []
        );
      }
      return entered;
    };
    // Twenty sittings. The rule is the fewest limps that keep every ten-hand window at four entered
    // (limping only when the window would otherwise fall short is the fewest possible), so what lands
    // over 40% is the Horse's own entries bunching: 44% on average when every fold could be limped,
    // nearer 40% when fewer folds are unraised (offline, 200 sittings: 44.3% / 41.6% / 38.1% at 100% /
    // 60% / 35% of folds limpable).
    const rates: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const e = run(400, seed);
      rates.push(e.filter(Boolean).length / e.length);
      // every ten-hand window holds the floor (the count already holds the sitting's last nine hands)
      for (let h = 9; h < e.length; h++)
        expect(e.slice(h - 9, h + 1).filter(Boolean).length).toBeGreaterThanOrEqual(4);
      // no catch-up binge after the switch: the first hundred hands land as the rest do
      expect(e.slice(0, 100).filter(Boolean).length / 100).toBeLessThanOrEqual(0.6);
    }
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    expect(mean).toBeGreaterThanOrEqual(0.4);
    expect(mean).toBeLessThanOrEqual(0.46);
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

  it('one hand early the limp is spent only when priced; at the floor with nothing leaving it does nothing', () => {
    let limps = 0;
    let kept = 0;
    for (const name of UNRAISED) {
      for (const [i, hole] of HANDS.entries()) {
        const seed = 9700 + i;
        const base = decideLightning(SPOTS[name], hole, BASE, seed, null);
        const still = decideLightning(SPOTS[name], hole, ON, seed, AT_LINE);
        expect(core(still)).toEqual(core(base));
        const early = decideLightning(SPOTS[name], hole, ON, seed, LEAVING);
        if (base.decision.action !== 'fold') {
          expect(core(early)).toEqual(core(base));
          continue;
        }
        if (early.decision.action === 'call') {
          expect(early.decision.amount).toBe(base.toCall);
          limps++;
        } else {
          expect(core(early)).toEqual(core(base));
          kept++;
        }
      }
    }
    // priced, not every: some limps spent early, some poor hands left to fold
    expect(limps).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
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
