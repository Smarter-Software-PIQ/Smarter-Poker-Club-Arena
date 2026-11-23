/**
 * LAW (PLO-OWNER lead-5, Turn 5b, 2026-11-22): omahaSemiBluffRaiseIsPriced obeys the owner ruling of
 * 2026-11-15 12:30, "RAISING WITH DRAWS SHOULD NEVER HAPPEN OUT OF POSITION. ONLY IN POSITION WHEN ITS COMBO
 * DRAWS, NOT NAKED NUT FLUSH DRAWS". No price overrides it.
 *
 * With the option ON, through the whole decision (HorseLogic.decide), on PLO4 and PLO5 cash flops:
 *  1. a draw out of position (omahaDrawRaiseBarOf === 'out_of_position') is never raised, against an unread
 *     opponent and against opponents whose lifetime record folds to 50%, 90% and 99% of raises, with the
 *     owner's bar switch (omahaNoDrawRaiseOutOfPosition) on and off;
 *  2. in position a bare flush draw and a bare straight draw are never raised either;
 *  3. the option makes a raise (a call or a fold of the option-off arm becomes a raise) only with the combo
 *     draw in position (omahaComboDrawForRaise), and it does make that raise against a measured folder, so
 *     the rule is not dead.
 * Before Turn 5b the rule read no position and no hand class: against the 90% folder it raised every one of
 * the out-of-position draws below.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { HorseDecision } from '../types.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  omahaComboDrawForRaise,
  omahaDrawRaiseBarOf,
  omahaHeroInPosition,
} from './HorseOmahaBigDrawAggression.js';
import {
  omahaPricedSemiBluffRaise,
  omahaSemiBluffRaiseHandMayRaise,
} from './HorseOmahaPricedWiring.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import {
  LIVE,
  LIVE_OPTIONS,
  pricedSpot,
  type PricedSpot,
  type PricedState,
} from './HorseOmahaPricedRules.test-support.js';
import {
  HUD_PACKET_VERSION,
  clearDecisionHud,
  installDecisionHud,
} from './opponentHud/OpponentHud.js';
import { HUD_PROFILE_VERSION } from './opponentHud/OpponentHudProfile.js';

// PLO5 and PLO4 hands: combo draws, bare flush draws, bare wraps, pairs with draws, made hands, air.
const HOLES = [
  'AhKhJcTc2s',
  'JsTs8c7c2d',
  'KhJh5c4s2d',
  '7c6c5s2s2d',
  'AcKdQs4s2c',
  'QsQc9s8d2c',
  'AhKh7c6c',
  'JsTs8c7c',
  'KhJh5c4s',
  'KhJhTc8s',
  'Ah5h7s2c',
  'JcTc8d7s',
];
const BOARDS = ['Qh9h3d', 'Td8h4c'];
const BETS: Array<[number, number]> = [
  [100, 30],
  [100, 50],
  [100, 100],
  [216, 100],
];
const spotsOf = (inPosition: boolean): PricedSpot[] => {
  const out: PricedSpot[] = [];
  for (const hole of HOLES)
    for (const board of BOARDS)
      for (const [potBefore, bet] of BETS) {
        const used = new Set(board.match(/../g));
        if ((hole.match(/../g) ?? []).some((c) => used.has(c))) continue;
        out.push({ hole, board, potBefore, bet, inPosition });
      }
  return out;
};
type Now = ReturnType<PricedState['fresh']>;
type Folds = [number, number] | null;
const installHud = (now: Now, fold: [number, number]) => {
  const opp: Record<string, unknown> = {};
  for (const p of now.gs.players ?? []) {
    if (p.seat === now.hero.seat) continue;
    opp[String(p.user_id)] = { hands: 5000, eff: { 'f.fRaise': fold, 't.fRaise': fold }, rc: {} };
  }
  installDecisionHud({
    v: HUD_PACKET_VERSION,
    pv: HUD_PROFILE_VERSION,
    family: (now.hero.cards ?? []).length === 5 ? 'plo5' : 'plo4',
    pri: {},
    opp,
  } as never);
};
const told = (st: PricedState, opts: HorseDecideOpts, seed: number, folds: Folds) => {
  HorseMind.reset();
  clearDecisionHud();
  const now = st.fresh();
  if (folds) installHud(now, folds);
  seedFastRandom(seed);
  seedHorseTimingRandom(seed);
  const d = withoutMeasurements(
    structuredClone(
      HorseLogic.decide(now.hero, now.gs, LIVE.style, LIVE.mods, {
        observeMind: false,
        decisionTimeMs: 1794938400000,
        ...opts,
      } as never)
    )
  ) as HorseDecision;
  clearDecisionHud();
  return { d, now };
};
const raised = (d: HorseDecision) => d.action === 'raise' || d.action === 'all_in';
const BAR_ON: HorseDecideOpts = { ...LIVE_OPTIONS };
const BAR_OFF: HorseDecideOpts = {
  ...LIVE_OPTIONS,
  omahaNoDrawRaiseOutOfPosition: false,
  v74OmahaSemiBluffNeedsDraw: false,
};
const RECORDS: Array<[string, Folds]> = [
  ['an unread opponent', null],
  ['a 50% folder', [400, 200]],
  ['a 90% folder', [400, 360]],
  ['a 99% folder', [400, 396]],
];
const SEEDS = [1, 2, 3];

afterEach(() => {
  clearDecisionHud();
  HorseMind.reset();
});

describe('LAW: omahaSemiBluffRaiseIsPriced never raises a draw out of position, and in position only the combo draw', () => {
  for (const [barLabel, base] of [
    ['the owner bar switch ON', BAR_ON],
    ['the owner bar switch OFF', BAR_OFF],
  ] as const)
    for (const [who, folds] of RECORDS)
      it(`out of position, ${barLabel}, against ${who}: 0 draw raises with the option on`, () => {
        let barred = 0;
        const raises: string[] = [];
        for (const s of spotsOf(false)) {
          const st = pricedSpot(s);
          for (const seed of SEEDS) {
            const on = told(st, { ...base, omahaSemiBluffRaiseIsPriced: true }, seed, folds);
            if (omahaDrawRaiseBarOf(on.now.hero, on.now.gs) !== 'out_of_position') continue;
            barred++;
            if (raised(on.d))
              raises.push(`${s.hole}|${s.board}|pot${s.potBefore} bet${s.bet}|seed${seed}`);
          }
        }
        // the sample is not empty: the law is about spots that exist
        expect(barred).toBeGreaterThanOrEqual(40);
        expect(raises).toEqual([]);
      });

  for (const [who, folds] of RECORDS)
    it(`in position against ${who}: a bare flush draw or bare straight draw is never raised, and the option only ever adds a raise with the combo draw`, () => {
      let bare = 0;
      const bareRaises: string[] = [];
      const addedWithoutCombo: string[] = [];
      for (const s of spotsOf(true)) {
        const st = pricedSpot(s);
        for (const seed of SEEDS) {
          const on = told(st, { ...BAR_ON, omahaSemiBluffRaiseIsPriced: true }, seed, folds);
          const off = told(st, BAR_ON, seed, folds);
          const { hero, gs } = on.now;
          const bar = omahaDrawRaiseBarOf(hero, gs);
          const label = `${s.hole}|${s.board}|pot${s.potBefore} bet${s.bet}|seed${seed}`;
          if (bar === 'bare_flush_draw' || bar === 'bare_straight_draw') {
            bare++;
            if (raised(on.d)) bareRaises.push(label);
          }
          const combo = omahaComboDrawForRaise(
            hero.cards ?? [],
            gs.communityCards ?? [],
            hero.knownDeadCards ?? []
          );
          if (raised(on.d) && !raised(off.d) && !combo) addedWithoutCombo.push(label);
        }
      }
      expect(bare).toBeGreaterThanOrEqual(20);
      expect(bareRaises).toEqual([]);
      expect(addedWithoutCombo).toEqual([]);
    });

  it('the price itself answers "no raise" wherever the ruling forbids one, and still raises the combo draw in position against a measured folder', () => {
    const on: HorseDecideOpts = { ...BAR_ON, omahaSemiBluffRaiseIsPriced: true };
    let forbidden = 0;
    let allowed = 0;
    let allowedRaises = 0;
    for (const inPosition of [false, true])
      for (const s of spotsOf(inPosition)) {
        const now = pricedSpot(s).fresh();
        HorseMind.reset();
        installHud(now, [400, 360]);
        const { hero, gs } = now;
        const live = (gs.players ?? []).filter((p) => p.seat !== hero.seat && !p.is_folded);
        const ip = omahaHeroInPosition(
          hero.seat,
          gs.dealerSeat,
          live.map((p) => p.seat)
        );
        const combo = omahaComboDrawForRaise(hero.cards ?? [], gs.communityCards ?? [], []);
        const may = omahaSemiBluffRaiseHandMayRaise(hero, gs);
        // the gate is exactly the two existing definitions, nothing else
        expect(may).toBe(ip && combo);
        expect(ip).toBe(inPosition);
        const priced = omahaPricedSemiBluffRaise(hero, gs, on);
        clearDecisionHud();
        if (!may) {
          forbidden++;
          expect(priced?.raise ?? false).toBe(false);
        } else {
          allowed++;
          if (priced?.raise) allowedRaises++;
        }
      }
    expect(forbidden).toBeGreaterThan(100);
    expect(allowed).toBeGreaterThan(0);
    expect(allowedRaises).toBeGreaterThan(0);
  });
});
