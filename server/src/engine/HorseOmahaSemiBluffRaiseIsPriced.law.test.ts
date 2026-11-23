/**
 * LAW (omahaSemiBluffRaiseIsPriced, default OFF; lane REPLACEMENTS-1 2026-11-21). In PLO4/PLO5 cash the brain's two
 * semi-bluff raise sites (the flop/turn raise and the pressure semi-bluff) stop rolling a frequency: the raise is made
 * only where omahaPricedSemiBluffRaise prices it above the better of the call and the fold by more than its
 * uncertainty, at a pot-limit legal size. It stands alone (omahaNoDrawRaiseOutOfPosition and
 * v74OmahaSemiBluffNeedsDraw may be off). Off is identical; PLO6, tournaments, hi-lo and bomb pots are out of scope;
 * the option only ever makes or withholds a raise; the current nuts are never folded.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HorseDecision } from '../types.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  OMAHA_BIG_DRAW_SAMPLES,
  omahaBigDrawEquities,
  omahaBigDrawSampledRuns,
} from './HorseOmahaBigDrawAggression.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import {
  LIVE,
  LIVE_OPTIONS,
  cards,
  pricedSpot,
  type PricedSpot,
  type PricedState,
} from './HorseOmahaPricedRules.test-support.js';
import {
  OMAHA_SEMIBLUFF_FOLD_TO_RAISE_POPULATION,
  OMAHA_SEMIBLUFF_RERAISE_POPULATION,
  OMAHA_SEMIBLUFF_SIZE_MODEL_REF,
  omahaPricedSemiBluffRaise,
  omahaSemiBluffRaisePricedFinal,
  omahaSemiBluffRaiseHandMayRaise,
} from './HorseOmahaPricedWiring.js';
import {
  omahaFlopEvCountsResetCache,
  omahaFlopEvSampledRuns,
} from './HorseOmahaFlopFacingBetEv.js';
import {
  HUD_PACKET_VERSION,
  clearDecisionHud,
  installDecisionHud,
} from './opponentHud/OpponentHud.js';
import { HUD_PROFILE_VERSION } from './opponentHud/OpponentHudProfile.js';

const OPTION = 'omahaSemiBluffRaiseIsPriced';
const ALONE = { omahaNoDrawRaiseOutOfPosition: false, v74OmahaSemiBluffNeedsDraw: false };
const HOLES = [
  'AhKhJcTc2s', // nut flush draw and a wrap
  'JsTs8c7c2d', // a wrap, no flush draw
  'KhJh5c4s2d', // a bare second flush draw
  '7c6c5s2s2d', // nothing
  'AcKdQs4s2c', // overcards, a gutshot
  'QsQc9s8d2c', // top set
];
const BOARDS = ['Qh9h3d', 'Qh9h3d2c', 'Td8h4c', 'Td8h4cKs'];
const BETS: Array<[number, number]> = [
  [100, 30],
  [100, 50],
  [100, 100],
  [216, 100],
];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
/** FLOP ONLY (lead ruling 2026-11-21): the option prices the flop; a turn spot must be decided as with it off */
const isFlop = (s: PricedSpot) => s.board.length === 6;
const SPOTS: PricedSpot[] = [];
for (const hole of HOLES)
  for (const board of BOARDS)
    for (const [potBefore, bet] of BETS)
      for (const inPosition of [false, true]) {
        const used = new Set(board.match(/../g));
        if ((hole.match(/../g) ?? []).some((c) => used.has(c))) continue;
        SPOTS.push({ hole, board, potBefore, bet, inPosition });
      }
/**
 * Turn 5b (owner ruling 2026-11-15 12:30): the option prices a raise only with the combo draw IN POSITION.
 * Combo draws (a flush draw with eight or more straight outs, below two pair) that today's brain calls with.
 */
const COMBO_IP: PricedSpot[] = [];
for (const hole of ['ThJdJhQd5s', '2hTh2d5cJd', 'Th8dJhTc7s', '6hJc6dTc3h', 'ThJhJc5h9d'])
  for (const [potBefore, bet] of BETS)
    COMBO_IP.push({ hole, board: 'Qh9h3d', potBefore, bet, inPosition: true });
const FLOP_SPOTS: PricedSpot[] = [...SPOTS.filter(isFlop), ...COMBO_IP];

const told = (
  st: PricedState,
  opts: HorseDecideOpts,
  seed: number,
  mutate?: (now: ReturnType<PricedState['fresh']>) => void
) => {
  HorseMind.reset();
  const now = st.fresh();
  mutate?.(now);
  enableBrainTelemetry();
  drainFires();
  seedFastRandom(seed);
  seedHorseTimingRandom(seed);
  const d = withoutMeasurements(
    structuredClone(
      HorseLogic.decide(now.hero, now.gs, LIVE.style, LIVE.mods, {
        observeMind: false,
        decisionTimeMs: 1794938400000,
        telemetry: true,
        ...opts,
      } as never)
    )
  ) as HorseDecision;
  return { d, now, fires: drainFires().map((f) => f.feature) };
};
const raised = (d: HorseDecision) => d.action === 'raise' || d.action === 'all_in';
const ROLL_FIRES = (f: string) =>
  (f.startsWith('ft_semibluff_raise_') &&
    !f.startsWith('ft_semibluff_raise_skip_') &&
    f !== 'ft_semibluff_raise_call_or_fold') ||
  f === 'v53_pressure_semibluff_raise';

afterEach(() => {
  vi.restoreAllMocks();
  clearDecisionHud();
  HorseMind.reset();
});

describe('omahaSemiBluffRaiseIsPriced', () => {
  it('reads strictly: absent, false and any non-true value leave the decision as it is', () => {
    let seen = 0;
    for (const s of SPOTS.filter((_, i) => i % 5 === 0))
      for (const seed of [1, 2]) {
        const st = pricedSpot(s);
        const base = told(st, { ...LIVE_OPTIONS }, seed);
        for (const v of [false, undefined, 1, 'true'])
          expect(told(st, { ...LIVE_OPTIONS, [OPTION]: v } as never, seed).d).toEqual(base.d);
        seen++;
      }
    expect(seen).toBeGreaterThan(10);
  });

  it('is null out of scope: off, PLO6, a tournament, hi-lo, a bomb pot, hold’em', () => {
    const st = pricedSpot({ hole: 'AhKhJcTc2s', board: 'Qh9h3d', potBefore: 100, bet: 50 });
    const on = { ...LIVE_OPTIONS, [OPTION]: true } as HorseDecideOpts;
    const a = st.fresh();
    expect(omahaPricedSemiBluffRaise(a.hero, a.gs, { ...LIVE_OPTIONS })).toBeNull();
    expect(omahaPricedSemiBluffRaise(a.hero, a.gs, on)).not.toBeNull();
    const six = st.fresh();
    six.gs.gameVariant = 'plo6' as never;
    six.hero.cards = [...(six.hero.cards ?? []), { rank: '3', suit: 'spades' } as never];
    expect(omahaPricedSemiBluffRaise(six.hero, six.gs, on)).toBeNull();
    const nl = st.fresh();
    nl.gs.gameVariant = 'nlh' as never;
    expect(omahaPricedSemiBluffRaise(nl.hero, nl.gs, on)).toBeNull();
    const hilo = st.fresh();
    hilo.gs.variantRules = { ...(hilo.gs.variantRules ?? {}), splitLow8OrBetter: true } as never;
    expect(omahaPricedSemiBluffRaise(hilo.hero, hilo.gs, on)).toBeNull();
    const bomb = st.fresh();
    bomb.gs.bombPot = true;
    expect(omahaPricedSemiBluffRaise(bomb.hero, bomb.gs, on)).toBeNull();
    const mtt = st.fresh();
    (mtt.gs as { tournamentId?: string }).tournamentId = 't-1';
    (mtt.gs as { isTournament?: boolean }).isTournament = true;
    (mtt.gs as { gameMode?: string }).gameMode = 'tournament';
    expect(omahaPricedSemiBluffRaise(mtt.hero, mtt.gs, on)).toBeNull();
  });

  it('PLO6 whole decisions are identical with the option on', () => {
    for (const s of SPOTS.filter((_, i) => i % 9 === 0)) {
      const st = pricedSpot(s);
      const six = (now: ReturnType<PricedState['fresh']>) => {
        now.gs.gameVariant = 'plo6' as never;
        now.hero.cards = [...(now.hero.cards ?? []), { rank: '3', suit: 'spades' } as never];
      };
      for (const seed of [1, 2, 3])
        expect(
          told(st, { ...LIVE_OPTIONS, ...ALONE, [OPTION]: true } as never, seed, six).d
        ).toEqual(told(st, { ...LIVE_OPTIONS, ...ALONE } as never, seed, six).d);
    }
  });

  /** A lifetime HUD packet for every opponent of the spot: fold-to-raise and re-raise records (public counts). */
  const hud = (
    now: ReturnType<PricedState['fresh']>,
    r: { fold?: [number, number]; reraise?: [number, number] }
  ) => {
    const opp: Record<string, unknown> = {};
    for (const p of now.gs.players ?? []) {
      if (p.seat === now.hero.seat) continue;
      const eff: Record<string, [number, number]> = {};
      const rc: Record<string, number[]> = {};
      if (r.fold) for (const s of ['f', 't']) eff[`${s}.fRaise`] = r.fold;
      if (r.reraise) for (const s of ['f', 't']) eff[`${s}.rRaise`] = r.reraise;
      opp[String(p.user_id)] = { hands: 5000, eff, rc };
    }
    installDecisionHud({
      v: HUD_PACKET_VERSION,
      pv: HUD_PROFILE_VERSION,
      family: (now.hero.cards ?? []).length === 5 ? 'plo5' : 'plo4',
      pri: {},
      opp,
    });
  };
  const tookBack = (f: string[]) =>
    f.some(
      (x) =>
        x.startsWith('omaha_turn_river_raise_needs_nuts_') ||
        x.startsWith('omaha_bare_overpair_oop_flop_check_')
    );
  const ON = { ...LIVE_OPTIONS, ...ALONE, [OPTION]: true } as never;
  const OFF = { ...LIVE_OPTIONS, ...ALONE } as never;
  const legal = (x: ReturnType<typeof told>) => {
    const g = x.now.gs;
    expect(g.legalActions ?? [x.d.action]).toContain(x.d.action);
    if (x.d.action === 'raise') {
      expect(x.d.amount!).toBeGreaterThanOrEqual((g.minRaiseTo as number) - 0.005);
      expect(x.d.amount!).toBeLessThanOrEqual((g.maxRaiseTo as number) + 0.005);
    }
  };

  it('no provider installed: every opponent is the population exactly, no roll decides, every action is legal, the nuts are never folded', () => {
    let priced = 0;
    let proven = 0;
    let withheld = 0;
    let total = 0;
    for (const s of SPOTS.filter(isFlop)) {
      const st = pricedSpot(s);
      for (const seed of [1, 2]) {
        clearDecisionHud();
        const on = told(st, ON, seed);
        const off = told(st, OFF, seed);
        // an installed packet that knows nothing of him is the same answer as no provider
        const blank = told(st, ON, seed, (now) => hud(now, {}));
        clearDecisionHud();
        expect(blank.d).toEqual(on.d);
        total++;
        expect(on.fires.filter(ROLL_FIRES)).toEqual([]);
        legal(on);
        if (omahaNutClassNow(on.now.hero, on.now.gs)) expect(on.d.action).not.toBe('fold');
        if (on.fires.some((f) => f.startsWith('omaha_semibluff_raise_priced_'))) priced++;
        if (on.fires.includes('omaha_semibluff_raise_priced_raise')) {
          proven++;
          // a later LIVE rule may take the proven raise back (the turn nuts rule on its own pooled read, the bare
          // overpair flop check): then its receipt is there. Stated in the lane log; not this option's doing.
          if (!raised(on.d)) {
            expect(tookBack(on.fires)).toBe(true);
            continue;
          }
        }
        if (off.fires.some(ROLL_FIRES) && !raised(on.d)) withheld++;
        // the option only makes a raise or withholds a roll's raise
        if (on.d.action !== off.d.action || on.d.amount !== off.d.amount)
          expect(raised(on.d) || raised(off.d)).toBe(true);
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `[semi-bluff raise priced, no provider] decisions ${total}, priced ${priced}, raises proven from the prior ${proven}, roll raises withheld ${withheld}`
    );
    expect(priced).toBeGreaterThan(0);
  });

  it('against a lifetime folder (HUD f.fRaise / t.fRaise) a call or a fold becomes the priced raise, legal, through the whole decision', () => {
    let yes = 0;
    let made = 0;
    for (const s of FLOP_SPOTS) {
      const st = pricedSpot(s);
      for (const seed of [1, 2, 3]) {
        const on = told(st, ON, seed, (now) => hud(now, { fold: [400, 360] }));
        clearDecisionHud();
        const off = told(st, OFF, seed);
        legal(on);
        if (omahaNutClassNow(on.now.hero, on.now.gs)) expect(on.d.action).not.toBe('fold');
        if (!on.fires.includes('omaha_semibluff_raise_priced_raise')) continue;
        // Turn 5b: a raise is priced only with the combo draw in position
        expect(omahaSemiBluffRaiseHandMayRaise(on.now.hero, on.now.gs)).toBe(true);
        // a later LIVE rule may take the proven raise back (the turn nuts rule on its own pooled read, the bare
        // overpair flop check): then its receipt is there. Stated in the lane log; not this option's doing.
        if (!raised(on.d)) {
          expect(tookBack(on.fires)).toBe(true);
          continue;
        }
        yes++;
        expect(on.fires).toContain('omaha_semibluff_raise_priced_fold_measured');
        if (!raised(off.d)) made++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `[semi-bluff raise priced, lifetime folder] priced yes ${yes}, raises today's brain had not made ${made}`
    );
    expect(yes).toBeGreaterThan(0);
    expect(made).toBeGreaterThan(0);
  });

  it('the price moves with his lifetime record: a folder above a stranger on combo draws in position; a longer record needs less proof; his re-raise lowers it', () => {
    const on = { ...LIVE_OPTIONS, [OPTION]: true } as HorseDecideOpts;
    let moved = 0;
    let reraiseLowers = 0;
    // Combo draws in position (the only hands the rule prices since Turn 5b). On a combo draw that is an equity
    // favorite when called wide, a 0%-fold station can still raise value-jam EV, so the never-folder is not compared.
    for (const s of COMBO_IP) {
      const st = pricedSpot(s);
      const at = (r: Parameters<typeof hud>[1] | null) => {
        const now = st.fresh();
        if (r) hud(now, r);
        else clearDecisionHud();
        const v = omahaPricedSemiBluffRaise(now.hero, now.gs, on)!;
        clearDecisionHud();
        return v;
      };
      const none = at(null);
      const folder = at({ fold: [400, 360] });
      const short = at({ fold: [10, 9] });
      const mid = at({ fold: [40, 36] });
      // a record above the population re-raise figure (0.12 / 0.13): 30%
      const reraiser = at({ fold: [400, 360], reraise: [400, 120] });
      const wild = at({ fold: [400, 200], reraise: [400, 200] });
      const tame = at({ fold: [400, 200], reraise: [400, 0] });
      expect(folder.gap).toBeGreaterThan(none.gap);
      expect(short.gap).toBeLessThanOrEqual(folder.gap + 1e-6);
      // At the same empirical fold rate (90%), a longer record (n=400 vs n=40) needs strictly less proof
      if (Math.abs(folder.to - mid.to) < 0.01) expect(folder.proof).toBeLessThan(mid.proof);
      // Proven edge (gap - proof) is non-increasing in opponent re-raise rate by envelope theorem
      expect(reraiser.gap - reraiser.proof).toBeLessThanOrEqual(folder.gap - folder.proof + 1e-6);
      expect(wild.gap - wild.proof).toBeLessThanOrEqual(tame.gap - tame.proof + 1e-6);
      if (wild.gap - wild.proof < tame.gap - tame.proof - 1e-6) reraiseLowers++;
      if (folder.raise && !none.raise) moved++;
      expect(at(null)).toEqual(none);
    }
    expect(moved).toBeGreaterThan(0);
    expect(reraiseLowers).toBeGreaterThan(0);
  });

  it('FLOP ONLY: on the turn the whole decision, its roll and its receipts are those of the option off, whatever his record', () => {
    let n = 0;
    for (const s of SPOTS.filter((x) => !isFlop(x)))
      for (const r of [null, { fold: [400, 360] as [number, number] }]) {
        const st = pricedSpot(s);
        for (const seed of [1, 2]) {
          const on = told(st, ON, seed, (now) => r && hud(now, r));
          clearDecisionHud();
          const off = told(st, OFF, seed, (now) => r && hud(now, r));
          clearDecisionHud();
          expect(on.d).toEqual(off.d);
          expect(on.fires).toEqual(off.fires);
          expect(on.fires.some((f) => f.startsWith('omaha_semibluff_raise_priced_'))).toBe(false);
          n++;
        }
      }
    expect(n).toBeGreaterThan(100);
  });

  it('with no packet the re-raise figure is the measured population of the family, and a packet prior replaces it', () => {
    expect(OMAHA_SEMIBLUFF_RERAISE_POPULATION).toEqual({ plo4: 0.12, plo5: 0.13 });
  });

  it('a size cut to what a short opponent covers is never under the minimum raise (development run, PLO5 heads-up: raise to 191 with the minimum at 192)', () => {
    let raisedShort = 0;
    for (const s of FLOP_SPOTS) {
      const st = pricedSpot(s);
      for (const seed of [1, 2]) {
        const on = told(st, ON, seed, (now) => {
          // the bettor has one chip less behind than a minimum raise needs: he covers minRaiseTo - 1
          const min = Number(now.gs.minRaiseTo);
          for (const p of now.gs.players ?? [])
            if (p.seat !== now.hero.seat && !p.is_folded && Number(p.bet ?? 0) > 0)
              p.stack = Math.max(1, min - 1 - Number(p.bet ?? 0));
          hud(now, { fold: [400, 360] });
        });
        clearDecisionHud();
        legal(on);
        if (raised(on.d) && on.fires.includes('omaha_semibluff_raise_priced_raise')) raisedShort++;
      }
    }
    expect(raisedShort).toBeGreaterThan(0);
  });

  it('the answer does not depend on the roll: one spot, every seed, one priced verdict', () => {
    for (const s of SPOTS.filter((_, i) => i % 7 === 0)) {
      const st = pricedSpot(s);
      const seen = new Set<string>();
      for (const seed of SEEDS) {
        const on = told(st, ON, seed, (now) => hud(now, { fold: [400, 360] }));
        clearDecisionHud();
        const f = on.fires.filter((x) => x.startsWith('omaha_semibluff_raise_priced_')).sort();
        if (f.length) seen.add(f.join(','));
      }
      expect(seen.size).toBeLessThanOrEqual(1);
    }
  });

  it('the two invariants, literally: the current nuts are never folded and no stack is called off with zero equity', () => {
    let nuts = 0;
    let callOffs = 0;
    for (const s of SPOTS)
      for (const r of [
        null,
        { fold: [400, 360] as [number, number] },
        { fold: [400, 0] as [number, number] },
      ]) {
        const st = pricedSpot(s);
        for (const short of [false, true]) {
          const on = told(st, ON, 3, (now) => {
            if (short) now.hero.stack = Math.max(1, Number(now.gs.toCall ?? s.bet));
            if (r) hud(now, r);
          });
          clearDecisionHud();
          if (omahaNutClassNow(on.now.hero, on.now.gs)) {
            nuts++;
            expect(on.d.action).not.toBe('fold');
          }
          const puts = on.d.action === 'call' || on.d.action === 'all_in';
          if (puts && short) {
            callOffs++;
            const e = omahaBigDrawEquities(
              on.now.hero.cards ?? [],
              on.now.gs.communityCards ?? [],
              [],
              400
            );
            expect(e === null || e.bet > 0).toBe(true);
          }
        }
      }
    // eslint-disable-next-line no-console
    console.log(
      `[semi-bluff raise priced, invariants] nut-class decisions ${nuts}, stacks called off ${callOffs}`
    );
  });

  it('R1 v2 regression: small flop bets with n=0 never hallucinate fold equity above 0.26 (no weak-hand small-bet punts)', () => {
    expect(OMAHA_SEMIBLUFF_FOLD_TO_RAISE_POPULATION).toBe(0.26);
    expect(OMAHA_SEMIBLUFF_SIZE_MODEL_REF).toBe(0.45);
    const on = { ...LIVE_OPTIONS, [OPTION]: true } as HorseDecideOpts;
    for (const hole of ['7c6c5s2s2d', 'AcKdQs4s2c', 'KhJh5c4s2d']) {
      for (const board of ['Qh9h3d', 'Td8h4c']) {
        for (const inPosition of [false, true]) {
          const st = pricedSpot({ hole, board, potBefore: 100, bet: 30, inPosition });
          const now = st.fresh();
          clearDecisionHud();
          const v = omahaPricedSemiBluffRaise(now.hero, now.gs, on)!;
          expect(v).not.toBeNull();
          expect(v.raise).toBe(false);
        }
      }
    }
  });

  it('THE WORK: R1 v2 uses zero omahaBigDrawEquities deals and reuses memoized omahaFlopEvCounts (at most 1 deal per decision)', () => {
    let priced = 0;
    let decisions = 0;
    for (const s of FLOP_SPOTS) {
      const st = pricedSpot(s);
      for (const seed of [1, 2]) {
        omahaFlopEvCountsResetCache();
        const bigBefore = omahaBigDrawSampledRuns();
        const flopBefore = omahaFlopEvSampledRuns();
        const on = told(st, ON, seed);
        const bigDealt = omahaBigDrawSampledRuns() - bigBefore;
        const flopDealt = omahaFlopEvSampledRuns() - flopBefore;
        decisions++;
        // R1 v2 itself never calls omahaBigDrawEquities (omahaBigDrawAggression may call it at most once)
        expect(bigDealt).toBeLessThanOrEqual(1);
        // At most 2 distinct valueShare buckets (facing-bet verdict + semi-bluff), typically 1 shared cache hit
        expect(flopDealt).toBeLessThanOrEqual(2);
        const answered =
          on.fires.includes('omaha_semibluff_raise_priced_raise') ||
          on.fires.includes('omaha_semibluff_raise_priced_no_raise');
        if (answered) priced++;
      }
    }
    expect(priced).toBeGreaterThan(0);
    // Direct consult: 0 omahaBigDrawEquities deals, and second consult hits FLOP_SAMPLES cache (0 additional deals)
    for (const s of [...SPOTS.filter(isFlop).slice(0, 12), ...COMBO_IP.slice(0, 8)]) {
      const st = pricedSpot(s);
      const now = st.fresh();
      omahaFlopEvCountsResetCache();
      const big0 = omahaBigDrawSampledRuns();
      const first = omahaPricedSemiBluffRaise(now.hero, now.gs, ON);
      expect(omahaBigDrawSampledRuns()).toBe(big0);
      const afterFirst = omahaFlopEvSampledRuns();
      const second = omahaPricedSemiBluffRaise(now.hero, now.gs, ON);
      expect(omahaFlopEvSampledRuns()).toBe(afterFirst);
      expect(second).toEqual(first);
    }
    // eslint-disable-next-line no-console
    console.log(
      `[semi-bluff raise priced, work] flop decisions ${decisions}, priced ${priced}, 0 omahaBigDraw deals`
    );
  });

  it('R1 v2b multiway jam regression: adding a second live opponent facing a small flop bet lowers raise/jam surplus and never hallucinates a 3-way jam', () => {
    const on: HorseDecideOpts = { omahaSemiBluffRaiseIsPriced: true };
    for (const { hole, board } of [
      { hole: 'AhKhJcTc2s', board: 'Qh9h3d' },
      { hole: 'AsJsTd8c4s', board: '9s7s2c' },
      { hole: 'KhJh8c7d2s', board: 'Qh9h4d' },
    ]) {
      const st = pricedSpot({ hole, board, potBefore: 100, bet: 33, inPosition: false });
      const hu = st.fresh();
      const mw = st.fresh();
      // Add a 2nd live opponent (3-way flop pot, same stack as bettor, still to act behind)
      const bettor = (mw.gs.players ?? []).find((p) => p.seat !== mw.hero.seat)!;
      mw.gs.players.push({
        seat: 4,
        user_id: 'opp-mw-2',
        username: 'OppMw2',
        stack: bettor.stack,
        bet: 0,
        totalInvested: 33,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      });
      clearDecisionHud();
      const vHu = omahaPricedSemiBluffRaise(hu.hero, hu.gs, on)!;
      const vMw = omahaPricedSemiBluffRaise(mw.hero, mw.gs, on)!;
      expect(vHu).not.toBeNull();
      expect(vMw).not.toBeNull();
      // Adding a 2nd live opponent cannot inflate raise/jam proven surplus over HU
      expect(vMw.gap - vMw.proof).toBeLessThanOrEqual(vHu.gap - vHu.proof + 1e-6);
      // And must not flip an unread non-raising HU spot into a 3-way all-in jam
      if (!vHu.raise) expect(vMw.raise).toBe(false);
    }
  });

  it('R1 v3 regression: facing a flop raise uses the tighter raise range (strictly lower surplus than facing a first bet of the same size)', () => {
    const on: HorseDecideOpts = { omahaSemiBluffRaiseIsPriced: true };
    const st = pricedSpot({
      hole: 'AhKhJcTc2s',
      board: 'Qh9h3d',
      potBefore: 100,
      bet: 50,
      // Turn 5b: the rule prices only the combo draw in position
      inPosition: true,
    });
    const firstBet = st.fresh();
    const facingRaise = st.fresh();
    // Hero already bet 20 on the flop and opponent raised to 70 (same toCall = 50, same pot = 150)
    facingRaise.hero.bet = 20;
    facingRaise.gs.currentBet = 70;
    facingRaise.gs.toCall = 50;
    facingRaise.gs.minRaiseTo = 120;
    facingRaise.gs.maxRaiseTo = 270;
    for (const p of facingRaise.gs.players ?? []) {
      if (p.seat !== facingRaise.hero.seat) p.bet = 70;
    }
    clearDecisionHud();
    const vBet = omahaPricedSemiBluffRaise(firstBet.hero, firstBet.gs, on)!;
    const vRaise = omahaPricedSemiBluffRaise(facingRaise.hero, facingRaise.gs, on)!;
    expect(vBet).not.toBeNull();
    expect(vRaise).not.toBeNull();
    expect(vRaise.gap - vRaise.proof).toBeLessThan(vBet.gap - vBet.proof);
  });

  it('R1 v3 regression: large overbet flop jams tighten continuing range by pot-odds MDF (no thin pair+draw 10x-pot flop jams vs unread villain)', () => {
    const on: HorseDecideOpts = { omahaSemiBluffRaiseIsPriced: true };
    // Deep stack (1000 behind into 100 pot, facing 33 flop bet): a pair + non-nut draw must never jam 10x pot unread
    for (const { hole, board } of [
      { hole: 'QhTd8h7c2s', board: 'Qs9h4h' },
      { hole: 'KsJs9d8c3s', board: 'Kh7s4d' },
      { hole: 'AsQh9d8c4d', board: 'Qd7d3c' },
    ]) {
      const st = pricedSpot({ hole, board, potBefore: 100, bet: 33, inPosition: false });
      const now = st.fresh();
      now.hero.stack = 1000;
      for (const p of now.gs.players ?? []) {
        if (p.seat !== now.hero.seat) p.stack = 1000;
      }
      now.gs.maxRaiseTo = 1000;
      clearDecisionHud();
      const v = omahaPricedSemiBluffRaise(now.hero, now.gs, on)!;
      expect(v).not.toBeNull();
      expect(v.jam).toBe(false);
    }
  });

  it('R1 v3 regression: v86 flop nut-combo-draw pump stands aside when omahaSemiBluffRaiseIsPriced is on (even with omahaNoDrawRaiseOutOfPosition off)', () => {
    const st = pricedSpot({
      hole: 'AhKhJcTc2s',
      board: 'Qh9h3d',
      potBefore: 100,
      bet: 50,
      inPosition: false,
    });
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const on = told(st, ON, seed);
      expect(on.fires).not.toContain('v86_plo_combo_draw_pump');
    }
  });

  it('Turn 5b: omahaSemiBluffRaisePricedFinal turns a legacy flop draw raise the owner ruling bars into the call whatever his record (#06 on or off), and leaves a combo-draw raise in position as it came', () => {
    const proposedRaise: HorseDecision = { action: 'raise', amount: 250, thinkTime: 0 };
    // Out of position with a flush draw (omahaDrawRaiseBarOf === 'out_of_position'): never kept on price
    const oop = pricedSpot({
      hole: 'KhJh5c4s2d',
      board: 'Qh9h3d',
      potBefore: 100,
      bet: 50,
      inPosition: false,
    });
    const unread = oop.fresh();
    clearDecisionHud();
    const resUnread = omahaSemiBluffRaisePricedFinal(proposedRaise, unread.hero, unread.gs, ON);
    expect(resUnread.action).toBe('call');
    expect(resUnread.amount).toBe(50);
    // A lifetime folder (90% f.fRaise, n=400) changes nothing: the ruling is not priced
    const folder = oop.fresh();
    hud(folder, { fold: [400, 360] });
    const resFolder = omahaSemiBluffRaisePricedFinal(proposedRaise, folder.hero, folder.gs, ON);
    clearDecisionHud();
    expect(resFolder.action).toBe('call');
    expect(resFolder.amount).toBe(50);
    // In position with a bare flush draw: the same
    const bareIp = pricedSpot({
      hole: 'KhJh5c4s2d',
      board: 'Qh9h3d',
      potBefore: 100,
      bet: 50,
      inPosition: true,
    }).fresh();
    hud(bareIp, { fold: [400, 360] });
    const resBare = omahaSemiBluffRaisePricedFinal(proposedRaise, bareIp.hero, bareIp.gs, ON);
    clearDecisionHud();
    expect(resBare.action).toBe('call');
    // In position with the combo draw: the ruling allows the raise, it stands as it came
    const comboIp = pricedSpot(COMBO_IP[1]!).fresh();
    clearDecisionHud();
    expect(omahaSemiBluffRaisePricedFinal(proposedRaise, comboIp.hero, comboIp.gs, ON)).toEqual(
      proposedRaise
    );
  });
});
