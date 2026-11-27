/**
 * LAW: THE TEN-HAND WINDOW SWITCH CAN BE CONFINED TO GAMES (lead-8 lane tenhand 2026-11-27;
 * HorseVpipFloorTenHandWindowGames.ts). Owner 2026-11-17 14:34 / 18:38 Chicago: a VPIP-floor limp folds to a raise,
 * the floor never buys a call of a raise. vpipFloorLimpOnlyTenHandWindow ends the integrator's exception of
 * 2026-11-18 on tables judged at ten hands; its eviction cost differs by game, so it is to go on PLO5 first.
 *
 * Held here:
 *  - no list (absent, empty, not an array): the switch as published, decision for decision and draw for draw;
 *  - a list: the switch is on only at a ten-hand table whose variant is listed; every other table (PLO4, hold'em,
 *    PLO6) decides exactly as with the switch off (today's exception), receipts included;
 *  - the list never turns the switch on;
 *  - the runtime settings set the list only from 1s, in registry order, and are absent at the compiled defaults
 *    (and with the production version 14 values alone);
 *  - the added read costs nothing measurable (relative, same machine).
 * Spots: HorseVpipFloorLimpOnly.test-support.ts (production seats anonymised, synthesised hole cards), production
 * option set PRODUCTION_28372C9A with vpipFloorLimpOnly on, tables at a 40% floor judged at ten (production mode).
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  vpipFloorLimpOnlyApplies,
  vpipFloorLimpOnlyGovernsTenHandTable,
  type HorseDecideOpts,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  decideAt,
  PRODUCTION_28372C9A,
  SPOTS,
  type FloorVariant,
  type Spot,
  type SpotName,
  type Table,
} from './HorseVpipFloorLimpOnly.test-support.js';
import {
  VPIP_FLOOR_TEN_HAND_WINDOW_GAMES,
  VPIP_FLOOR_TEN_HAND_WINDOW_GAME_SETTING_PREFIX,
  vpipFloorLimpOnlyTenHandWindowOn,
  vpipFloorTenHandWindowGamesFromSettings,
} from './HorseVpipFloorTenHandWindowGames.js';
import { horseDecideOptsFromRuntimeSettings } from './runtimeSettings/apply.js';
import { parseRuntimeSettings } from './runtimeSettings/snapshot.js';
import { OPTION_SWITCH_NAMES, OPTION_SWITCH_NOT_A_SWITCH } from './HorseOptionSwitch.js';
import { measureRelativeCost } from '../testing/relativeCost.js';
import type { HorseDecision } from '../types.js';

const P = PRODUCTION_28372C9A;
const TODAY: HorseDecideOpts = { ...P, vpipFloorLimpOnly: true };
const ON: HorseDecideOpts = { ...TODAY, vpipFloorLimpOnlyTenHandWindow: true };
const PLO5_ONLY: HorseDecideOpts = { ...ON, vpipFloorLimpOnlyTenHandWindowGames: ['plo5'] };
const SEEDS = [1, 7, 42, 2026];

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const tenHand = (variant: FloorVariant, vpip = 30): Table => ({
  variant,
  floor: 40,
  window: 10,
  ownVpip: { hands: 10, vpip },
});
const digest = (d: HorseDecision): string =>
  createHash('sha256')
    .update(JSON.stringify(withoutMeasurements(d)))
    .digest('hex')
    .slice(0, 16);
interface Played {
  bytes: string[];
  next: number[];
  fires: string[][];
}
function play(spot: Spot, table: Table, hole: string, opts: HorseDecideOpts): Played {
  enableBrainTelemetry();
  const out: Played = { bytes: [], next: [], fires: [] };
  for (const seed of SEEDS) {
    drainFires();
    const d = decideAt(spot, table, hole, { telemetry: true, ...opts }, seed);
    out.bytes.push(digest(d.decision));
    out.next.push(d.next);
    out.fires.push(
      drainFires()
        .map((f) => f.feature)
        // the floor's receipts; seen-once receipts elsewhere depend on test order, not on the decision
        .filter((f) => /^(second_look_)?(omaha_)?vpip_floor/.test(f))
        .sort()
    );
  }
  return out;
}
const S = (name: SpotName): Spot => SPOTS[name] as Spot;
const HANDS: Record<FloorVariant, string[]> = {
  plo5: ['Kc9d7h5s3c', 'JcTd6h5s2c', 'AhAs8h7c4c'],
  plo6: ['Kc9d7h5s3c2d', 'AhAsKhKs8c7c'],
  plo4: ['Kc9d7h3s', 'Jc6h5s2c', 'AhAsKhKs'],
  nlh: ['7c2d', 'Jc3h', 'AcKc'],
};
const VARIANTS: FloorVariant[] = ['plo5', 'plo4', 'nlh', 'plo6'];
const SPOT_NAMES: SpotName[] = [
  'coFirstIn',
  'btnFirstIn',
  'btnFacingOpenTwoCalls',
  'bbFacingReRaise',
];

describe('the read site', () => {
  const g = (gameVariant: string) => ({
    gameVariant,
    vpipFloor: 40,
    vpipWindowHands: 10,
    ownVpip: { hands: 10, vpip: 30 },
  });
  it('no list (absent, empty, not an array) is the switch as published', () => {
    for (const games of [undefined, [], 'plo5', { plo5: 1 }, null] as unknown[])
      for (const v of ['plo5', 'plo4', 'nlh', 'plo6', '']) {
        expect(
          vpipFloorLimpOnlyTenHandWindowOn(g(v), {
            vpipFloorLimpOnlyTenHandWindow: true,
            vpipFloorLimpOnlyTenHandWindowGames: games,
          })
        ).toBe(true);
        expect(
          vpipFloorLimpOnlyTenHandWindowOn(g(v), { vpipFloorLimpOnlyTenHandWindowGames: games })
        ).toBe(false);
      }
  });
  it('a list confines it to the listed variants (case-insensitive variant), never turns it on', () => {
    const on = {
      vpipFloorLimpOnlyTenHandWindow: true,
      vpipFloorLimpOnlyTenHandWindowGames: ['plo5'],
    };
    expect(vpipFloorLimpOnlyTenHandWindowOn(g('plo5'), on)).toBe(true);
    expect(vpipFloorLimpOnlyTenHandWindowOn(g('PLO5'), on)).toBe(true);
    for (const v of ['plo4', 'nlh', 'plo6', 'plo8', 'short_deck', ''])
      expect([v, vpipFloorLimpOnlyTenHandWindowOn(g(v), on)]).toEqual([v, false]);
    for (const w of [false, undefined, 1, 'true'])
      expect(
        vpipFloorLimpOnlyTenHandWindowOn(g('plo5'), {
          vpipFloorLimpOnlyTenHandWindow: w,
          vpipFloorLimpOnlyTenHandWindowGames: ['plo5'],
        })
      ).toBe(false);
  });
  it('both readers of the switch go through it', () => {
    const both = { vpipFloorLimpOnly: true, vpipFloorLimpOnlyTenHandWindow: true };
    const scoped = { ...both, vpipFloorLimpOnlyTenHandWindowGames: ['plo5'] };
    expect(vpipFloorLimpOnlyGovernsTenHandTable(g('plo5'), scoped, false)).toBe(true);
    expect(vpipFloorLimpOnlyApplies(g('plo5'), scoped, false)).toBe(true);
    for (const v of ['plo4', 'nlh', 'plo6']) {
      expect(vpipFloorLimpOnlyGovernsTenHandTable(g(v), scoped, false)).toBe(false);
      expect(vpipFloorLimpOnlyApplies(g(v), scoped, false)).toBe(false);
      expect(vpipFloorLimpOnlyApplies(g(v), both, false)).toBe(true);
    }
    // a Classic (thirty-hand) table of an unlisted game is governed by vpipFloorLimpOnly as before
    const classic = {
      gameVariant: 'plo4',
      vpipFloor: 40,
      vpipWindowHands: 30,
      ownVpip: { hands: 30, vpip: 30 },
    };
    expect(vpipFloorLimpOnlyApplies(classic, scoped, false)).toBe(true);
  });
  it('the list is a parameter, not a switch', () => {
    expect(OPTION_SWITCH_NOT_A_SWITCH.vpipFloorLimpOnlyTenHandWindowGames).toBeDefined();
    expect(OPTION_SWITCH_NAMES).not.toContain('vpipFloorLimpOnlyTenHandWindowGames');
    expect(OPTION_SWITCH_NAMES).toContain('vpipFloorLimpOnlyTenHandWindow');
  });
});

describe('decisions at ten-hand tables', () => {
  it('a list [plo5]: PLO5 decides as the switch on everywhere; PLO4, hold’em and PLO6 decide as the switch off (today), receipts included', () => {
    let plo5Changed = 0;
    let othersWouldChange = 0;
    for (const variant of VARIANTS)
      for (const hole of HANDS[variant])
        for (const spot of SPOT_NAMES) {
          const table = tenHand(variant);
          const scoped = play(S(spot), table, hole, PLO5_ONLY);
          const today = play(S(spot), table, hole, TODAY);
          const on = play(S(spot), table, hole, ON);
          const want = variant === 'plo5' ? on : today;
          expect([variant, spot, hole, scoped.bytes, scoped.next, scoped.fires]).toEqual([
            variant,
            spot,
            hole,
            want.bytes,
            want.next,
            want.fires,
          ]);
          const differs = on.bytes.join() !== today.bytes.join();
          if (variant === 'plo5' && differs) plo5Changed++;
          if (variant !== 'plo5' && differs) othersWouldChange++;
        }
    // not vacuous: the switch changes decisions in PLO5 and would in the other games
    expect(plo5Changed).toBeGreaterThan(0);
    expect(othersWouldChange).toBeGreaterThan(0);
  }, 300_000);

  it('no list, an empty list, or a list with the switch off: byte-identical to the switch as published', () => {
    for (const variant of ['plo5', 'plo4'] as FloorVariant[])
      for (const spot of ['btnFirstIn', 'btnFacingOpenTwoCalls'] as SpotName[]) {
        const hole = HANDS[variant][0]!;
        const table = tenHand(variant);
        const on = play(S(spot), table, hole, ON);
        const today = play(S(spot), table, hole, TODAY);
        expect(
          play(S(spot), table, hole, { ...ON, vpipFloorLimpOnlyTenHandWindowGames: [] })
        ).toEqual(on);
        expect(
          play(S(spot), table, hole, {
            ...TODAY,
            vpipFloorLimpOnlyTenHandWindowGames: ['plo5', 'plo4'],
          })
        ).toEqual(today);
      }
  }, 120_000);
});

describe('the runtime settings', () => {
  const V14 = {
    'horse.v65TurnShadeCap': 0.12,
    'horse.v68AirShadeScale': 1,
    'lightning.fastFoldMaxMs': 3000,
    'lightning.fastFoldSigma': 0.5,
    'horse.tournamentFlatBump': 0,
    'horse.v67RiverRaiseShade': 0.1,
    'lightning.fastFoldFloorMs': 450,
    'lightning.fastFoldMedianMs': 600,
    'lightning.fastFoldTempoMax': 1.25,
    'lightning.fastFoldTempoMin': 0.8,
    'horse.blanketRowOffInPlo45Cash.v9Mood': 0,
    'horse.omahaGameScope.omahaFlopPressureCapIsPriced': 5,
  };
  const opts = (settings: Record<string, number>) => {
    const parsed = parseRuntimeSettings({ version: 15, settings });
    expect(parsed.ok).toBe(true);
    return parsed.ok ? horseDecideOptsFromRuntimeSettings(parsed.snapshot) : undefined;
  };
  const key = (g: string) => VPIP_FLOOR_TEN_HAND_WINDOW_GAME_SETTING_PREFIX + g;
  it('version 14 alone sets no list; v14 + plo5 = 1 lists PLO5 only and changes nothing else', () => {
    const v14 = opts(V14);
    expect(v14?.vpipFloorLimpOnlyTenHandWindowGames).toBeUndefined();
    const v15 = opts({ ...V14, [key('plo5')]: 1 });
    expect(v15?.vpipFloorLimpOnlyTenHandWindowGames).toEqual(['plo5']);
    const { vpipFloorLimpOnlyTenHandWindowGames: _l, ...rest } = v15 as Record<string, unknown>;
    expect(rest).toEqual(v14);
  });
  it('only 1s list a game, in registry order; 0s are the compiled default', () => {
    expect(VPIP_FLOOR_TEN_HAND_WINDOW_GAMES).toEqual(['nlh', 'plo4', 'plo5']);
    expect(vpipFloorTenHandWindowGamesFromSettings(undefined)).toBeUndefined();
    expect(
      vpipFloorTenHandWindowGamesFromSettings({
        [key('nlh')]: 0,
        [key('plo4')]: 0,
        [key('plo5')]: 0,
      })
    ).toBeUndefined();
    expect(
      vpipFloorTenHandWindowGamesFromSettings({
        [key('plo5')]: 1,
        [key('nlh')]: 1,
        [key('plo4')]: 0,
      })
    ).toEqual(['nlh', 'plo5']);
    // the database refuses an underscore in a key: every key matches its shape rule
    for (const g of VPIP_FLOOR_TEN_HAND_WINDOW_GAMES)
      expect(key(g)).toMatch(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/);
    // out of range is refused by the engine (the whole version, so publish only after a build with the key serves)
    expect(parseRuntimeSettings({ version: 15, settings: { [key('plo5')]: 2 } }).ok).toBe(false);
  });
});

describe('cost', () => {
  it('the scoped read costs nothing measurable at ten-hand tables (relative, same machine)', () => {
    const quiet = { ...ON, telemetry: false } as HorseDecideOpts;
    const run = (o: HorseDecideOpts) => () => {
      for (const variant of VARIANTS)
        for (const spot of SPOT_NAMES)
          decideAt(S(spot), tenHand(variant), HANDS[variant][0]!, o, 7);
    };
    const cost = measureRelativeCost(
      run({ ...quiet, vpipFloorLimpOnlyTenHandWindowGames: ['plo5'] }),
      run(quiet)
    );
    // scoped tables run either the switch-on or the switch-off path (both already priced); bound leaves room for load
    expect(cost.ratio).toBeLessThan(2.5);
  }, 120_000);
});
