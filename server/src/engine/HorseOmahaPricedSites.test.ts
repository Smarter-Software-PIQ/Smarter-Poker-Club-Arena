/**
 * HorseOmahaPricedSites (sites-013U37): each site's answer is the priced
 * comparison of HorseOmahaPricedRules.omahaPricedBet, with the option off or
 * out of scope nothing changes, and a whole decision with every site on is
 * legal and fails no rule.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { omahaPricedBet } from './HorseOmahaPricedRules.js';
import {
  omahaPricedSitesBlockerBluffAdmits,
  omahaPricedSitesMadeHandBet,
  omahaPricedSitesOwnsBlockerBluff,
  omahaPricedSitesReadOf,
  omahaPricedSitesTurnSetSize,
} from './HorseOmahaPricedSites.js';
import { allSitesPriced } from './HorseOmahaPricedSites.test-support.js';
import {
  LIVE,
  LIVE_OPTIONS,
  pricedSpot,
  type PricedSpot,
} from './HorseOmahaPricedRules.test-support.js';
import type { HorseDecision } from '../types.js';

afterEach(() => {
  HorseMind.reset();
});

const ON: HorseDecideOpts = { ...allSitesPriced(true), telemetry: true } as HorseDecideOpts;
const OFF: HorseDecideOpts = { telemetry: true } as HorseDecideOpts;
const fires = (): string[] => drainFires().map((f) => f.feature);

const TURN_OOP: PricedSpot = { hole: 'AcQd6c5d2h', board: '9dQs3h7h', bet: 0, heroBetFlop: true };
const TURN_SET: PricedSpot = { hole: '9c9s6c5d2h', board: '9dQs3h8h', bet: 0, heroBetFlop: true };
const RIVER_AIR: PricedSpot = {
  hole: 'AhKh6c5d2s',
  board: '9dQsJh7h2c',
  bet: 0,
  heroBetTurn: true,
};

describe('with the options off, or out of scope, every site returns the rule its place', () => {
  it('off: null / false and no receipt', () => {
    enableBrainTelemetry();
    for (const s of [TURN_OOP, TURN_SET, RIVER_AIR]) {
      const st = pricedSpot(s);
      const bet: HorseDecision = { action: 'bet', amount: 100, thinkTime: 0 };
      drainFires();
      expect(omahaPricedSitesMadeHandBet(bet, st.hero as never, st.gs as never, OFF)).toBeNull();
      expect(omahaPricedSitesTurnSetSize(bet, st.hero as never, st.gs as never, OFF)).toBeNull();
      expect(omahaPricedSitesOwnsBlockerBluff(st.hero as never, st.gs as never, OFF)).toBe(false);
      expect(fires().filter((f) => f.startsWith('omaha_priced_site_'))).toEqual([]);
    }
  });
  it('a bomb pot is out of scope even with the options on', () => {
    const st = pricedSpot(TURN_OOP);
    const gs = { ...(st.gs as object), bombPot: true } as never;
    const bet: HorseDecision = { action: 'bet', amount: 100, thinkTime: 0 };
    expect(omahaPricedSitesMadeHandBet(bet, st.hero as never, gs, ON)).toBeNull();
    expect(omahaPricedSitesTurnSetSize(bet, st.hero as never, gs, ON)).toBeNull();
    expect(omahaPricedSitesOwnsBlockerBluff(st.hero as never, gs, ON)).toBe(false);
  });
});

describe('each site answers by the priced comparison', () => {
  it('made-hand defence: the wager stands iff it is priced at least at the check', () => {
    enableBrainTelemetry();
    for (const amount of [40, 100, 216]) {
      const st = pricedSpot(TURN_OOP);
      const v = omahaPricedBet(
        st.hero as never,
        st.gs as never,
        omahaPricedSitesReadOf(st.gs as never, ON),
        amount
      );
      expect(v?.proposed).not.toBeNull();
      drainFires();
      const d = omahaPricedSitesMadeHandBet(
        { action: 'bet', amount, thinkTime: 0 },
        st.hero as never,
        st.gs as never,
        ON
      )!;
      const keep = v!.proposed!.ev >= v!.evCheck;
      expect(d.action).toBe(keep ? 'bet' : 'check');
      expect(fires()).toContain(
        keep ? 'omaha_priced_site_made_hand_bet_kept' : 'omaha_priced_site_made_hand_bet_checked'
      );
    }
  });
  it('turn set pound: the size is the highest-valued candidate, the check only above every size', () => {
    const st = pricedSpot(TURN_SET);
    const proposed = 180;
    const v = omahaPricedBet(
      st.hero as never,
      st.gs as never,
      omahaPricedSitesReadOf(st.gs as never, ON),
      proposed
    )!;
    expect(v.best).not.toBeNull();
    const d = omahaPricedSitesTurnSetSize(
      { action: 'bet', amount: proposed, thinkTime: 0 },
      st.hero as never,
      st.gs as never,
      ON
    )!;
    const maxEv = Math.max(...v.rows.map((r) => r.ev));
    if (v.evCheck > maxEv) expect(d.action).toBe('check');
    else {
      const chosen = v.rows.find((r) =>
        d.action === 'all_in'
          ? r.action === 'all_in'
          : Math.abs(r.amount - (d.amount ?? -1)) < 0.006
      );
      expect(chosen, JSON.stringify(d)).toBeDefined();
      expect(chosen!.ev).toBe(maxEv);
    }
  });
  it('river blocker bluff: admitted iff some bet is priced above the check', () => {
    enableBrainTelemetry();
    const st = pricedSpot(RIVER_AIR);
    const v = omahaPricedBet(
      st.hero as never,
      st.gs as never,
      omahaPricedSitesReadOf(st.gs as never, ON)
    )!;
    drainFires();
    const ok = omahaPricedSitesBlockerBluffAdmits(st.hero as never, st.gs as never, ON);
    expect(ok).toBe(v.best !== null && v.best.ev > v.evCheck);
    expect(fires()).toContain(
      ok ? 'omaha_priced_site_blocker_bluff_admitted' : 'omaha_priced_site_blocker_bluff_refused'
    );
  });
  it('a spot it cannot price keeps the engine decision and says so', () => {
    enableBrainTelemetry();
    const st = pricedSpot(TURN_OOP);
    drainFires();
    // an amount of no chips cannot be priced
    const d = omahaPricedSitesMadeHandBet(
      { action: 'bet', thinkTime: 0 } as HorseDecision,
      st.hero as never,
      st.gs as never,
      ON
    )!;
    expect(d.action).toBe('bet');
    expect(fires()).toContain('omaha_priced_site_made_hand_bet_unpriced_kept');
  });
});

describe('whole decisions with every site on', () => {
  it('are legal, fail no rule, and equal the off decision outside the sites', () => {
    enableBrainTelemetry();
    const spots: PricedSpot[] = [TURN_OOP, TURN_SET, RIVER_AIR, { ...TURN_OOP, inPosition: true }];
    for (const seed of [1, 7, 42])
      for (const s of spots) {
        const run = (opts: HorseDecideOpts) => {
          HorseMind.reset();
          const st = pricedSpot(s);
          drainFires();
          seedFastRandom(seed);
          const d = HorseLogic.decide(st.hero as never, st.gs as never, LIVE.style, LIVE.mods, {
            telemetry: true,
            observeMind: false,
            decisionTimeMs: 1794938400000,
            ...opts,
          } as never);
          return { d, f: fires(), legal: (st.gs as { legalActions?: string[] }).legalActions };
        };
        const off = run(LIVE_OPTIONS);
        const on = run({ ...LIVE_OPTIONS, ...allSitesPriced(true) });
        expect(on.legal).toContain(on.d.action);
        expect(on.f).not.toContain('omaha_strategy_rule_failed');
        if (!on.f.some((f) => f.startsWith('omaha_priced_site_')))
          // the action and the chips (timings and latencies are wall-clock and differ run to run)
          expect(
            { action: on.d.action, amount: on.d.amount },
            `${s.hole} ${s.board} seed ${seed}`
          ).toEqual({ action: off.d.action, amount: off.d.amount });
      }
  }, 300000);
});
