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
import { omahaFlopEvCounts } from './HorseOmahaFlopFacingBetEv.js';
import { omahaBareBigPairOnFlop, omahaHeroHasPreflopLead } from './HorseOmahaOopChecks.js';
import {
  omahaPricedSitesFlopBet,
  omahaPricedSitesFlopBetEv,
  omahaPricedSitesBlockerBluffAdmits,
  omahaPricedSitesMadeHandBet,
  omahaPricedSitesOwnsBlockerBluff,
  omahaPricedSitesReadOf,
  omahaPricedSitesTurnSetSize,
} from './HorseOmahaPricedSites.js';
import { allSitesPriced } from './HorseOmahaPricedSites.test-support.js';
import {
  cards,
  LIVE,
  LIVE_OPTIONS,
  pricedSpot,
  type PricedSpot,
} from './HorseOmahaPricedRules.test-support.js';
import type { HorseDecision } from '../types.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';

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
  it('turn set pound: the size is the highest-valued candidate (the wager stays)', () => {
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
    expect(d.action).not.toBe('check');
    {
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
    const spots: PricedSpot[] = [
      TURN_OOP,
      TURN_SET,
      RIVER_AIR,
      { ...TURN_OOP, inPosition: true },
      { hole: 'AdAhKdJd4h', board: '8s6c9s', bet: 0, inPosition: true },
      { hole: 'KdKhAdJd4h', board: '8s6c9s', bet: 0 },
      { hole: 'QdQhKdJd4h', board: '9h7s3d', bet: 0 },
    ];
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

describe('omahaFlopBetIsPriced: the owner fixture txHiARhC (hand 59833576) and its KK / QQ forms', () => {
  // PLO5 1/2 Madness: the Horse 4-bet to 148 and was called; flop 8s 6c 9s, pot 315, he checked;
  // the Horse IN POSITION with 361.6 behind bet 252 (he check-raised with a flopped straight).
  const FIXTURE = { board: '8s6c9s', pot: 315, bet: 252, effective: 361.6 };
  const HANDS = { AA: 'AdAhKdJd4h', KK: 'KdKhAdJd4h', QQ: 'QdQhKdJd4h' };
  const verdict = (hole: string, foldToBet: number) => {
    const counts = omahaFlopEvCounts(cards(hole), cards(FIXTURE.board), [], 0.15)!;
    expect(counts).not.toBeNull();
    return omahaPricedSitesFlopBetEv({
      equityTop: (x) => counts.top(x).win + counts.top(x).tie / 2,
      pot: FIXTURE.pot,
      bet: FIXTURE.bet,
      effective: FIXTURE.effective,
      inPosition: true,
      foldToBet,
    })!;
  };
  it('each is the spot (a bare big pair: no flush draw, few straight outs)', () => {
    for (const hole of Object.values(HANDS))
      expect(omahaBareBigPairOnFlop(cards(hole), cards(FIXTURE.board)), hole).toBe(true);
  });
  it('the bet is priced (both lines in chips), deterministically, and moves with his fold share only continuously', () => {
    const rows: string[] = [];
    for (const [name, hole] of Object.entries(HANDS)) {
      const at = [0.3, 0.42, 0.5, 0.6].map((f) => verdict(hole, f));
      for (const v of at) {
        expect(Number.isFinite(v.evBet) && Number.isFinite(v.evCheck)).toBe(true);
        expect(v.fold + v.call + v.raise).toBeCloseTo(1, 9);
      }
      // more folds: the bet is worth more; the check does not move
      for (let k = 1; k < at.length; k++) {
        expect(at[k].evBet).toBeGreaterThan(at[k - 1].evBet);
        expect(at[k].evCheck).toBeCloseTo(at[0].evCheck, 9);
      }
      expect(verdict(hole, 0.42)).toEqual(at[1]);
      rows.push(
        `${name} ${hole}: ` +
          at
            .map(
              (v) =>
                `fold ${v.fold.toFixed(2)} bet ${v.evBet.toFixed(1)} check ${v.evCheck.toFixed(1)} (eq all ${v.equityAll.toFixed(3)} call ${v.equityCall.toFixed(3)} raise ${v.equityRaise.toFixed(3)}${v.callsRaise ? ', calls his raise' : ''})`
            )
            .join(' | ')
      );
    }
    // eslint-disable-next-line no-console
    console.log('[txHiARhC]\n' + rows.join('\n'));
  });
});

describe('omahaFlopBetIsPriced: scope', () => {
  it('off, or not the spot: null', () => {
    const st = pricedSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s', bet: 0, inPosition: true });
    const bet: HorseDecision = { action: 'bet', amount: 100, thinkTime: 0 };
    expect(omahaPricedSitesFlopBet(bet, st.hero as never, st.gs as never, OFF, false)).toBeNull();
    const air = pricedSpot({ hole: '7c5d2h3s4c', board: 'KsQhJd', bet: 0, inPosition: true });
    expect(omahaPricedSitesFlopBet(bet, air.hero as never, air.gs as never, ON, false)).toBeNull();
    // eslint-disable-next-line no-console
    console.log(
      `[flop lead in the built spot] ${omahaHeroHasPreflopLead(st.hero as never, st.gs as never)}`
    );
  });
});

describe('the worker receipt admits the priced flop check in its public spot only (commit 06a03315112)', () => {
  // The audited replay found 14 in-position flop bet-to-checks of omahaFlopBetIsPriced refused
  // (policy_graph): no earlier rule checks a bare big pair in position. The receipt admits the check
  // where the option's public spot holds, and nowhere else.
  it('a priced check of a bare big pair is admitted; the same receipt with another hand is refused', () => {
    enableBrainTelemetry();
    let checkedSeen = 0;
    for (const hole of ['AdAhKdJd4h', 'KdKhAdJd4h', 'QdQhKdJd4h', 'AcAdKs4h2c'])
      for (const board of ['8s6c9s', '9h7s3d', 'Th4c2d'])
        for (const seed of [1, 7, 42]) {
          HorseMind.reset();
          const st = pricedSpot({ hole, board, bet: 0, inPosition: true });
          drainFires();
          seedFastRandom(seed);
          const d = HorseLogic.decide(st.hero as never, st.gs as never, LIVE.style, LIVE.mods, {
            telemetry: true,
            observeMind: false,
            decisionTimeMs: 1794938400000,
            ...LIVE_OPTIONS,
            omahaFlopBetIsPriced: true,
          } as never);
          if (!fires().includes('omaha_priced_site_flop_bet_checked')) continue;
          checkedSeen++;
          expect(d.action).toBe('check');
          expect(
            horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
              player: st.hero,
              gameState: st.gs,
            } as never),
            `${hole} ${board} seed ${seed}`
          ).toBeNull();
          // the admission is the option's public spot: with a hand outside it the same receipt is refused
          expect(
            horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
              player: { ...(st.hero as object), cards: cards('7c5d2h3s4c') },
              gameState: st.gs,
            } as never),
            `${hole} ${board} seed ${seed} with air`
          ).not.toBeNull();
        }
    expect(checkedSeen, 'the corpus reaches a priced in-position flop check').toBeGreaterThan(0);
  }, 300000);
});
