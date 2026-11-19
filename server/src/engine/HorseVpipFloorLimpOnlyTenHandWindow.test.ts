/**
 * THE LIMP-ONLY FLOOR ON A TABLE JUDGED AT TEN HANDS (option
 * vpipFloorLimpOnlyTenHandWindow, default OFF; it acts only together with
 * vpipFloorLimpOnly). Owner 2026-11-17 14:34 Chicago: "Table VPIP must limp
 * fold for a bb. smh nothing else if there vpip drops."; 18:38: a Horse the
 * limp cannot keep over the floor is "booted and replaced with a new horse".
 *
 * vpipFloorLimpOnly left one kind of floored cash table on the old floor on
 * purpose: a table KNOWN to be judged the Action / Madness way (the sitting,
 * at ten hands or fewer, no warning, no grace). There the floor still widened
 * ranges and called raises. This option ends the exception.
 *
 * The spots are the six-seat table of HorseVpipFloorLimpOnly.test-support.ts
 * (anonymised to seats, synthesised hole cards), every Horse with the option
 * set production decided with (PRODUCTION_28372C9A), on the declared variant
 * table as it ships (VPIP_FLOOR_LIMP_ONLY_VARIANTS). The tables are the ones
 * production carries in this mode on 2026-11-19: a 40% floor judged at ten.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  vpipFloorLimpOnlyApplies,
  vpipFloorLimpOnlyGovernsTenHandTable,
  vpipFloorLimpOnlyTenHandTable,
  vpipLimpTargetFor,
  type HorseDecideOpts,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  decideAt,
  limpedThenRaised,
  PRODUCTION_28372C9A,
  sitting,
  SPOTS,
  tableSitting,
  type FloorVariant,
  type Spot,
  type SpotName,
  type Table,
} from './HorseVpipFloorLimpOnly.test-support.js';
import type { HorseDecision } from '../types.js';

const P = PRODUCTION_28372C9A;
/** Production today: vpipFloorLimpOnly on, the ten-hand table not governed. */
const TODAY: HorseDecideOpts = { ...P, vpipFloorLimpOnly: true };
const ON: HorseDecideOpts = { ...TODAY, vpipFloorLimpOnlyTenHandWindow: true };
const SEEDS = [1, 7, 42, 99, 2026, 3, 11, 17];

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

/** A table judged at ten hands with the Horse's own judged row (so it is KNOWN to be one). */
const tenHand = (variant: FloorVariant, floor: number, vpip: number, hands = 10): Table => ({
  variant,
  floor,
  window: 10,
  ownVpip: { hands, vpip },
});
const unfloored = (variant: FloorVariant): Table => ({ variant, floor: 0 });

interface Played {
  actions: string[];
  amounts: (number | undefined)[];
  bytes: string[];
  /** the bytes without jointPolicy.stateKey, the hash of the public state, which names the table's floor */
  sameAsTable: string[];
  next: number[];
  fires: string[][];
}
const digest = (d: HorseDecision): string =>
  createHash('sha256')
    .update(JSON.stringify(withoutMeasurements(d)))
    .digest('hex')
    .slice(0, 16);
function play(spot: Spot, table: Table, hole: string, opts: HorseDecideOpts): Played {
  enableBrainTelemetry();
  const out: Played = { actions: [], amounts: [], bytes: [], sameAsTable: [], next: [], fires: [] };
  for (const seed of SEEDS) {
    drainFires();
    const d = decideAt(spot, table, hole, { telemetry: true, ...opts }, seed);
    out.actions.push(d.decision.action);
    out.amounts.push(d.decision.amount);
    out.bytes.push(digest(d.decision));
    const jp = (d.decision as { jointPolicy?: Record<string, unknown> }).jointPolicy;
    out.sameAsTable.push(
      digest({
        ...d.decision,
        ...(jp ? { jointPolicy: { ...jp, stateKey: null } } : {}),
      } as HorseDecision)
    );
    out.next.push(d.next);
    out.fires.push(drainFires().map((f) => f.feature));
  }
  return out;
}
const fired = (p: Played, f: string) => p.fires.filter((x) => x.includes(f)).length;
const S = (name: SpotName): Spot => SPOTS[name] as Spot;

/** Hands per variant: weak ones the unfloored brain folds, and ones it plays. */
const HANDS: Record<'plo5' | 'plo4' | 'nlh' | 'plo6', string[]> = {
  plo5: ['Kc9d7h5s3c', 'JcTd6h5s2c', 'Qc8d6h3s2c', 'Th8c5d3s2h', 'AhAs8h7c4c', 'KhQhJsTs9c'],
  plo6: ['Kc9d7h5s3c2d', 'JcTd6h5s2c3h', 'AhAsKhKs8c7c'],
  plo4: ['Kc9d7h3s', 'Jc6h5s2c', 'Qc8d3s2h', 'AhAsKhKs'],
  nlh: ['7c2d', '9c4d', 'Jc3h', 'AhAs', 'AcKc'],
};
const VARIANTS = ['plo5', 'plo6', 'plo4', 'nlh'] as const;
const UNRAISED: SpotName[] = ['utgFirstIn', 'coFirstIn', 'btnFirstIn', 'btnLimped', 'sbFirstIn'];
const RAISED: SpotName[] = [
  'btnFacingOpenTwoCalls',
  'sbFacingButtonOpen',
  'bbFacingCutoffOpenAndCall',
  'bbFacingReRaise',
];
const OLD_FLOOR_RECEIPTS = [
  'vpip_floor_call_down',
  'omaha_vpip_floor_limp',
  'omaha_vpip_floor_limp_fold',
  'omaha_vpip_floor_three_bet_bar_kept',
  'vpip_floor_closing',
  'vpip_floor_prior',
  'vpip_floor_clamped',
];

describe('the rule, as functions', () => {
  const t = { vpipFloor: 40, vpipWindowHands: 10, gameVariant: 'plo5' };
  const row = { hands: 10, vpip: 30 };
  const both = { vpipFloorLimpOnly: true, vpipFloorLimpOnlyTenHandWindow: true };

  it('with both options on, a table known to be judged at ten hands or fewer is governed', () => {
    for (const vpipWindowHands of [10, 5, 1]) {
      const g = { ...t, vpipWindowHands, ownVpip: row };
      expect(vpipFloorLimpOnlyTenHandTable(g, both, false)).toBe(true);
      expect(vpipFloorLimpOnlyApplies(g, both, false)).toBe(true);
      expect(vpipFloorLimpOnlyGovernsTenHandTable(g, both, false)).toBe(true);
      // without the new option: the exception stands, exactly as before
      expect(vpipFloorLimpOnlyApplies(g, { vpipFloorLimpOnly: true }, false)).toBe(false);
      expect(vpipFloorLimpOnlyGovernsTenHandTable(g, { vpipFloorLimpOnly: true }, false)).toBe(
        false
      );
    }
  });

  it('read `=== true`: false and a truthy non-boolean leave the exception in place', () => {
    const g = { ...t, ownVpip: row };
    for (const v of [false, undefined, 1, 'on', 'true', {}])
      for (const f of [vpipFloorLimpOnlyApplies, vpipFloorLimpOnlyGovernsTenHandTable])
        expect([
          String(v),
          f(
            g,
            { vpipFloorLimpOnly: true, vpipFloorLimpOnlyTenHandWindow: v as unknown as boolean },
            false
          ),
        ]).toEqual([String(v), false]);
  });

  it('alone (vpipFloorLimpOnly off or not a boolean true) it governs nothing', () => {
    const g = { ...t, ownVpip: row };
    for (const v of [undefined, false, 1 as unknown as boolean]) {
      const o = { vpipFloorLimpOnly: v, vpipFloorLimpOnlyTenHandWindow: true };
      expect(vpipFloorLimpOnlyApplies(g, o, false)).toBe(false);
      expect(vpipFloorLimpOnlyGovernsTenHandTable(g, o, false)).toBe(false);
    }
  });

  it('never a tournament, All-In-Or-Fold, a bomb pot, Lightning or an unfloored table', () => {
    const g = { ...t, ownVpip: row };
    const out = [
      vpipFloorLimpOnlyApplies(g, both, true),
      vpipFloorLimpOnlyApplies({ ...g, allInOrFold: true }, both, false),
      vpipFloorLimpOnlyApplies({ ...g, bombPot: true }, both, false),
      vpipFloorLimpOnlyApplies({ ...g, publicMemoryDomain: { speed: 'lightning' } }, both, false),
      vpipFloorLimpOnlyApplies({ ...g, vpipFloor: 0 }, both, false),
      vpipFloorLimpOnlyGovernsTenHandTable(g, both, true),
      vpipFloorLimpOnlyGovernsTenHandTable({ ...g, allInOrFold: true }, both, false),
      vpipFloorLimpOnlyGovernsTenHandTable({ ...g, bombPot: true }, both, false),
      vpipFloorLimpOnlyGovernsTenHandTable(
        { ...g, publicMemoryDomain: { speed: 'lightning' } },
        both,
        false
      ),
      vpipFloorLimpOnlyGovernsTenHandTable({ ...g, vpipFloor: 0 }, both, false),
    ];
    expect(out).toEqual(out.map(() => false));
  });

  it('a Classic table, and a table whose window is not known, are governed as before and are not "ten-hand governed"', () => {
    for (const g of [
      { ...t, vpipWindowHands: 30, ownVpip: { hands: 30, vpip: 30 } },
      { ...t, vpipWindowHands: 10 }, // no judged row: the window proves nothing
      { ...t, vpipWindowHands: undefined, ownVpip: row },
    ]) {
      expect(vpipFloorLimpOnlyApplies(g, both, false)).toBe(true);
      expect(vpipFloorLimpOnlyApplies(g, { vpipFloorLimpOnly: true }, false)).toBe(true);
      expect(vpipFloorLimpOnlyGovernsTenHandTable(g, both, false)).toBe(false);
    }
  });

  it('the line on a 40% table judged at ten is the same product buffer: 7 of 10', () => {
    expect(vpipLimpTargetFor(40, 10)).toBeCloseTo(0.7, 12);
  });
});

describe('off: the ten-hand table keeps the old floor and the old receipt, byte for byte', () => {
  it('unset, false and a truthy non-boolean decide as today, draw for draw; the not-governed receipt still fires', () => {
    let floorActsToday = 0;
    for (const variant of VARIANTS)
      for (const hole of HANDS[variant].slice(0, 2))
        for (const spot of [...UNRAISED.slice(0, 2), ...RAISED.slice(0, 2)]) {
          const table = tenHand(variant, 40, 30);
          const today = play(S(spot), table, hole, TODAY);
          for (const v of [false, 1, 'on'] as unknown as boolean[]) {
            const off = play(S(spot), table, hole, { ...TODAY, vpipFloorLimpOnlyTenHandWindow: v });
            expect([variant, spot, hole, String(v), off.bytes, off.next]).toEqual([
              variant,
              spot,
              hole,
              String(v),
              today.bytes,
              today.next,
            ]);
            expect(fired(off, 'vpip_floor_limp_only_not_governed_ten_hand_window')).toBe(
              SEEDS.length
            );
            expect(fired(off, 'vpip_floor_limp_only_governed_ten_hand_window')).toBe(0);
            expect(fired(off, 'vpip_floor_limp_only_seen')).toBe(0);
          }
          if (
            today.actions.join() !== play(S(spot), unfloored(variant), hole, TODAY).actions.join()
          )
            floorActsToday++;
        }
    // not vacuous: the old floor changes decisions on these tables today
    expect(floorActsToday).toBeGreaterThan(0);
  }, 240_000);

  it('alone, without vpipFloorLimpOnly, it changes nothing anywhere (ten-hand or Classic)', () => {
    for (const [variant, table] of [
      ['plo5', tenHand('plo5', 40, 30)],
      ['nlh', tenHand('nlh', 40, 30)],
      ['plo5', { variant: 'plo5', floor: 40, window: 30, ownVpip: { hands: 30, vpip: 30 } }],
    ] as Array<[FloorVariant, Table]>)
      for (const spot of ['btnFirstIn', 'btnFacingOpenTwoCalls'] as const) {
        const base = play(S(spot), table, HANDS[variant as 'plo5' | 'nlh'][0], P);
        const alone = play(S(spot), table, HANDS[variant as 'plo5' | 'nlh'][0], {
          ...P,
          vpipFloorLimpOnlyTenHandWindow: true,
        });
        expect([variant, spot, alone.bytes, alone.next, alone.fires]).toEqual([
          variant,
          spot,
          base.bytes,
          base.next,
          base.fires,
        ]);
      }
  }, 120_000);

  it('on a Classic table (thirty hands) and an unfloored table, both options on decide as vpipFloorLimpOnly alone', () => {
    for (const table of [
      { variant: 'plo5', floor: 40, window: 30, ownVpip: { hands: 30, vpip: 30 } },
      { variant: 'plo5', floor: 40, window: 30, ownVpip: { hands: 30, vpip: 60 } },
      { variant: 'plo5', floor: 40, window: 10 }, // no judged row
      unfloored('plo5'),
    ] as Table[])
      for (const spot of ['btnFirstIn', 'btnFacingOpenTwoCalls', 'bbFacingReRaise'] as const) {
        const a = play(S(spot), table, HANDS.plo5[0], TODAY);
        const b = play(S(spot), table, HANDS.plo5[0], ON);
        expect([spot, b.bytes, b.next, b.fires]).toEqual([spot, a.bytes, a.next, a.fires]);
        expect(fired(b, 'vpip_floor_limp_only_governed_ten_hand_window')).toBe(0);
      }
  }, 120_000);
});

describe('on: the ten-hand table has the one action of the limp-only floor', () => {
  it('facing a raise or a re-raise, under the floor: the decision is the unfloored one on every hand (no floor call, no floor raise); failing before: today the floor buys some of these', () => {
    let todayDiffers = 0;
    let checked = 0;
    for (const variant of VARIANTS)
      for (const hole of HANDS[variant])
        for (const spot of RAISED) {
          const table = tenHand(variant, 40, 30);
          const none = play(S(spot), unfloored(variant), hole, ON);
          const on = play(S(spot), table, hole, ON);
          expect([variant, spot, hole, on.sameAsTable, on.next]).toEqual([
            variant,
            spot,
            hole,
            none.sameAsTable,
            none.next,
          ]);
          for (const f of OLD_FLOOR_RECEIPTS)
            expect([variant, spot, f, fired(on, f)]).toEqual([variant, spot, f, 0]);
          expect(fired(on, 'vpip_floor_limp_only_not_governed_ten_hand_window')).toBe(0);
          expect(fired(on, 'vpip_floor_limp_only_governed_ten_hand_window')).toBe(SEEDS.length);
          expect(fired(on, 'vpip_floor_limp_only_seen')).toBe(SEEDS.length);
          expect(fired(on, 'vpip_floor_limp_only_limp')).toBe(0);
          checked++;
          if (play(S(spot), table, hole, TODAY).actions.join() !== none.actions.join())
            todayDiffers++;
        }
    expect(checked).toBe(RAISED.length * VARIANTS.reduce((s, v) => s + HANDS[v].length, 0));
    expect(todayDiffers).toBeGreaterThan(0);
  }, 480_000);

  it('unraised pot, under the floor: a hand the unfloored brain folds limps for exactly the price to call (one big blind, the small blind one chip); every other hand is the unfloored decision', () => {
    let limps = 0;
    let kept = 0;
    for (const variant of VARIANTS)
      for (const hole of HANDS[variant])
        for (const spot of UNRAISED) {
          const table = tenHand(variant, 40, 30);
          const none = play(S(spot), unfloored(variant), hole, ON);
          const on = play(S(spot), table, hole, ON);
          const price = spot === 'sbFirstIn' ? 1 : 2;
          SEEDS.forEach((_, i) => {
            if (none.actions[i] === 'fold') {
              // the floor's only change: the limp, never a raise
              expect([variant, spot, hole, i, on.actions[i], on.amounts[i]]).toEqual([
                variant,
                spot,
                hole,
                i,
                'call',
                price,
              ]);
              limps++;
            } else {
              expect([variant, spot, hole, i, on.sameAsTable[i]]).toEqual([
                variant,
                spot,
                hole,
                i,
                none.sameAsTable[i],
              ]);
              kept++;
            }
          });
          for (const f of OLD_FLOOR_RECEIPTS)
            expect([variant, spot, f, fired(on, f)]).toEqual([variant, spot, f, 0]);
          expect(fired(on, 'vpip_floor_limp_only_governed_ten_hand_window')).toBe(SEEDS.length);
        }
    expect(limps).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  }, 480_000);

  it('limped, then raised behind: the unfloored decision stands (the floor does not call the raise)', () => {
    for (const variant of VARIANTS)
      for (const hole of HANDS[variant].slice(0, 3)) {
        const spot = limpedThenRaised(S('btnFirstIn'));
        const none = play(spot, unfloored(variant), hole, ON);
        const on = play(spot, tenHand(variant, 40, 30), hole, ON);
        expect([variant, hole, on.sameAsTable]).toEqual([variant, hole, none.sameAsTable]);
        expect(fired(on, 'vpip_floor_call_down')).toBe(0);
      }
  }, 240_000);

  it('at or over the line (7 of 10 at 40%), and with no judged sample yet (under three hands): nothing, in any spot', () => {
    for (const variant of ['plo5', 'nlh'] as const)
      for (const hole of HANDS[variant].slice(0, 3))
        for (const spot of [...UNRAISED, ...RAISED])
          for (const table of [
            tenHand(variant, 40, 70),
            tenHand(variant, 40, 90),
            tenHand(variant, 40, 72.2, 18),
            tenHand(variant, 40, 0, 2),
            { variant, floor: 40, window: 10, ownVpip: { hands: 0, vpip: null } } as Table,
          ]) {
            const none = play(S(spot), unfloored(variant), hole, ON);
            const on = play(S(spot), table, hole, ON);
            expect([variant, spot, hole, JSON.stringify(table.ownVpip), on.sameAsTable]).toEqual([
              variant,
              spot,
              hole,
              JSON.stringify(table.ownVpip),
              none.sameAsTable,
            ]);
            expect(fired(on, 'vpip_floor_limp_only_limp')).toBe(0);
          }
  }, 480_000);

  it('between the floor and the line the sitting is still judged whole: a long sitting at 50% of 40 hands limps a weak hand first in (PLO5, selection every)', () => {
    const on = play(S('btnFirstIn'), tenHand('plo5', 40, 50, 40), HANDS.plo5[0], ON);
    expect(on.actions).toEqual(SEEDS.map(() => 'call'));
    expect(on.amounts).toEqual(SEEDS.map(() => 2));
  });
});

describe('the sitting model of a table judged at ten hands (test support, sittingMode)', () => {
  it('judges the whole sitting from hand ten on and evicts on the spot, with no warning', () => {
    // every hand faces a re-raise, where the limp-only floor has no action: the Horse enters only
    // the hands its own unfloored decision plays, far under four in ten
    const r = sitting({
      variant: 'nlh',
      floor: 40,
      opts: ON,
      hands: 40,
      seed: 3,
      window: 10,
      grace: 0,
      sittingMode: true,
      mix: [['bbFacingReRaise', 1]],
    });
    expect(r.evictedAtHand).toBe(10);
    expect(r.hands).toBe(10);
    expect(r.warnings).toBe(0);
    expect(r.judged).toBe(1);
    expect(r.judgedUnder).toBe(1);
    expect(r.floorRaises).toBe(0);
    expect(r.floorRaisedPotCalls).toBe(0);
    // a Horse that enters every hand is never judged under: the whole sitting is the sample
    const stays = sitting({
      variant: 'plo5',
      floor: 40,
      opts: ON,
      hands: 25,
      seed: 3,
      window: 10,
      grace: 0,
      sittingMode: true,
      mix: [['btnFirstIn', 1]],
    });
    expect(stays.evictedAtHand).toBeNull();
    expect(stays.judged).toBe(16);
    expect(stays.judgedUnder).toBe(0);
  }, 120_000);

  it('six Horses, 20 table hands: on, the floor makes no raise and calls no raised pot; today it does both or either', () => {
    const cfg = {
      variant: 'plo5' as const,
      floor: 40,
      hands: 20,
      seed: 5,
      window: 10,
      grace: 0,
      sittingMode: true,
    };
    const today = tableSitting({ ...cfg, opts: TODAY });
    const on = tableSitting({ ...cfg, opts: ON });
    expect(on.floorRaises).toBe(0);
    expect(on.floorRaisedPotCalls).toBe(0);
    expect(today.floorRaises + today.floorRaisedPotCalls).toBeGreaterThan(0);
    // an eviction is a fresh Horse in the chair, counted
    expect(on.horseSittings).toBe(6 + on.evictions);
    for (const at of on.evictedAtHands) expect(at).toBeGreaterThanOrEqual(10);
  }, 120_000);
});
