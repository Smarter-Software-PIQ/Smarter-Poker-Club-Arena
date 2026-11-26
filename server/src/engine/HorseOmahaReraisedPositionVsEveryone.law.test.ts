/**
 * LAW: THE PRICED CALL OF A RE-RAISE HOLDS POSITION AGAINST EVERY PLAYER STILL TO SEE THE FLOP
 * (option omahaReraisedPositionVsEveryoneToAct, default OFF; PLO lead-7 lane plo-preflop, 2026-11-26).
 *
 * The defect (HAND-AUDIT-PLO, PLO4/PLO5 cash): of the 27 audited out-of-position multiway calls of a 3-bet whose best
 * answer was the fold, 13 were priced IN POSITION (receipt omaha_reraised_call_priced_in_position).
 * omahaReraisedCallPricingOf read the realization's position as ipVsRaiser, hero acts after the re-raiser and nothing
 * else, so a big blind behind a small-blind 3-bet with the opener still to act was given the in-position realization
 * although the opener acts after him on every later street.
 *
 * With the option on, in a PLO4/PLO5 cash table hand, hero is in position only when he acts after the re-raiser AND
 * after every other live player not all in. Off (absent, false, any non-boolean) the pricing is exactly main's;
 * Lightning and tournaments keep their own reading with the option on; heads-up nothing changes. On the generated
 * big-blind-behind-the-small-blind-3-bet spot the option only ever removes calls (never adds one). Cost: one pass over
 * the seats, measured relative to the decision it sits in (theServerSuiteAssertsNoTightWallClockBound).
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import {
  omahaReraisedCallPricingOf,
  type HorseDecideOpts,
  type HorseGameStateV2,
} from './HorseLogic.js';
import { omahaReraisedCallEv, omahaReraisedPendingContinue } from './HorseOmahaOopReraisedPot.js';
import { stateAt } from './HorseComplaintReplay.js';
import { HorseMind } from './HorseMind.js';
import {
  buildFixture,
  cards,
  decideAt,
  type Spot,
  type Table,
} from './HorseVpipFloorLimpOnly.test-support.js';
import { BASE, asLightning, asTable } from './HorseLightningParity.test-support.js';
import { measureRelativeCost } from '../testing/relativeCost.js';

const OPTION = 'omahaReraisedPositionVsEveryoneToAct';
const ON: HorseDecideOpts = { ...BASE, [OPTION]: true } as HorseDecideOpts;
const RATIO_DECISION = 1.5;

/** The audited shape: CO opens, SB 3-bets, the big blind decides with the opener still to act behind him. */
const BB_VS_SB_SQUEEZE_OPENER_BEHIND: Spot = {
  hero: 6,
  prior: [
    [1, 'fold'],
    [2, 'fold'],
    [3, 'raise', 7],
    [4, 'fold'],
    [5, 'raise', 24],
  ],
};
/** Control: HJ opens, CO 3-bets, the button decides; only the blinds (who act before him) are still to act. */
const BTN_VS_CO_THREE_BET: Spot = {
  hero: 4,
  prior: [
    [1, 'fold'],
    [2, 'raise', 7],
    [3, 'raise', 25],
  ],
};

function dealer(seed: number, n: number, size: number, dead: readonly Card[]): Card[][] {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const R = '23456789TJQKA';
  const S = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
  const deadKeys = new Set(dead.map((c) => c.rank + c.suit));
  const deck: Card[] = [];
  for (const s of S)
    for (const r of R) if (!deadKeys.has(r + s)) deck.push({ rank: r, suit: s } as Card);
  const out: Card[][] = [];
  while (out.length < n) {
    const picked = new Set<number>();
    while (picked.size < size) picked.add(Math.floor(rnd() * deck.length));
    out.push([...picked].map((i) => deck[i]!));
  }
  return out;
}

function pricing(
  spot: Spot,
  table: Table,
  hole: Card[],
  opts: HorseDecideOpts,
  shape: (gs: Record<string, unknown>) => void,
  raiserSeat: number
) {
  HorseMind.reset();
  const fx = buildFixture(spot, table, hole);
  const st = stateAt(fx, fx.actions[fx.actions.length - 1]);
  shape(st.gs as unknown as Record<string, unknown>);
  const gs = st.gs as HorseGameStateV2;
  const raiser = gs.players.find((p) => p.seat === raiserSeat)!;
  return omahaReraisedCallPricingOf(
    st.hero,
    gs,
    { mind: false, ...opts },
    raiser,
    st.pn.toCall,
    st.hero.stack,
    st.hero.bet
  )!;
}

const PLO5: Table = { variant: 'plo5', floor: 0 };
const PLO4: Table = { variant: 'plo4', floor: 0 };
const HOLE5 = cards('AsKdQs9h8d');
/** what a decision is, without its wall-clock fields: action, amount and the next draw of the brain's stream */
const core = (d: ReturnType<typeof decideAt>) => ({
  action: d.decision.action,
  amount: d.decision.amount,
  next: d.next,
});
const HOLE4 = cards('AsKdQs9h');

describe('the position the priced call of a re-raise is computed with', () => {
  it('off (absent, false, non-boolean): main reading, the big blind is "in position" behind the 3-bettor', () => {
    for (const [table, hole] of [
      [PLO5, HOLE5],
      [PLO4, HOLE4],
    ] as const)
      for (const opts of [
        BASE,
        { ...BASE, [OPTION]: false },
        { ...BASE, [OPTION]: 'on' as unknown as boolean },
        { ...BASE, [OPTION]: 1 as unknown as boolean },
      ] as HorseDecideOpts[]) {
        const p = pricing(BB_VS_SB_SQUEEZE_OPENER_BEHIND, table, hole, opts, asTable(), 5);
        expect(p.position?.ipVsRaiser).toBe(true);
        expect(p.position?.raisersPendingBehind).toBe(1);
        expect(p.inPosition).toBe(true);
        expect(p.oopWeight).toBeUndefined();
      }
  });

  it('on: the opener still to act after him weights the realization by his chance to continue (prior, no read)', () => {
    for (const [table, hole, cont] of [
      [PLO5, HOLE5, 0.52],
      [PLO4, HOLE4, 0.5],
    ] as const) {
      const off = pricing(BB_VS_SB_SQUEEZE_OPENER_BEHIND, table, hole, BASE, asTable(), 5);
      const on = pricing(BB_VS_SB_SQUEEZE_OPENER_BEHIND, table, hole, ON, asTable(), 5);
      expect(on.oopWeight).toBeCloseTo(cont, 10);
      // only the weight is added: every other input is the same
      const { oopWeight: _w, ...rest } = on;
      expect(rest).toEqual(off);
      expect(off.oopWeight).toBeUndefined();
    }
  });

  it('the weighted realization lies between the in-position and out-of-position realizations', () => {
    const on = pricing(BB_VS_SB_SQUEEZE_OPENER_BEHIND, PLO5, HOLE5, ON, asTable(), 5);
    const w = on.oopWeight!;
    const ip = omahaReraisedCallEv(0.4, 0.1, 22, 50, 380, {
      ...on,
      oopWeight: undefined,
      inPosition: true,
    });
    const oop = omahaReraisedCallEv(0.4, 0.1, 22, 50, 380, {
      ...on,
      oopWeight: undefined,
      inPosition: false,
    });
    const mid = omahaReraisedCallEv(0.4, 0.1, 22, 50, 380, on);
    expect(mid.realization).toBeCloseTo(w * oop.realization + (1 - w) * ip.realization, 12);
    expect(mid.realization).toBeLessThan(ip.realization);
    expect(mid.realization).toBeGreaterThan(oop.realization);
  });

  it('a player still to act whose own record shows he never folds a re-raise makes the weight his record', () => {
    expect(omahaReraisedPendingContinue('plo5', true, null)).toBe(0.52);
    expect(omahaReraisedPendingContinue('plo4', false, null)).toBe(0.2);
    // 40 opportunities, never folded: (1 x 40 + 0.52 x 8) / 48
    expect(omahaReraisedPendingContinue('plo5', true, { fold: 0, opportunities: 40 })).toBeCloseTo(
      (40 + 0.52 * 8) / 48,
      12
    );
  });

  it('on: a hero who acts after everyone still to see the flop stays in position (button against a CO 3-bet)', () => {
    const off = pricing(BTN_VS_CO_THREE_BET, PLO5, HOLE5, BASE, asTable(), 3);
    const on = pricing(BTN_VS_CO_THREE_BET, PLO5, HOLE5, ON, asTable(), 3);
    expect(off.inPosition).toBe(true);
    expect(on).toEqual(off);
    expect(on.oopWeight).toBeUndefined();
  });

  it('on: Lightning and tournaments keep their own reading (byte-identical pricing)', () => {
    const lightOff = pricing(BB_VS_SB_SQUEEZE_OPENER_BEHIND, PLO5, HOLE5, BASE, asLightning(), 5);
    const lightOn = pricing(BB_VS_SB_SQUEEZE_OPENER_BEHIND, PLO5, HOLE5, ON, asLightning(), 5);
    expect(lightOn).toEqual(lightOff);
    const tourney = (gs: Record<string, unknown>) => {
      asTable()(gs);
      gs.gameMode = 'tournament';
    };
    const tOff = pricing(BB_VS_SB_SQUEEZE_OPENER_BEHIND, PLO5, HOLE5, BASE, tourney, 5);
    const tOn = pricing(BB_VS_SB_SQUEEZE_OPENER_BEHIND, PLO5, HOLE5, ON, tourney, 5);
    expect(tOn).toEqual(tOff);
  });
});

describe('decisions on the audited shape', () => {
  it('off: every decision is the decision without the option (absent / false / non-boolean)', () => {
    for (const [i, hole] of dealer(20261126, 40, 5, []).entries()) {
      const base = decideAt(BB_VS_SB_SQUEEZE_OPENER_BEHIND, PLO5, hole, BASE, 900 + i, asTable());
      for (const v of [false, 'on', 0]) {
        const d = decideAt(
          BB_VS_SB_SQUEEZE_OPENER_BEHIND,
          PLO5,
          hole,
          { ...BASE, [OPTION]: v } as HorseDecideOpts,
          900 + i,
          asTable()
        );
        expect(core(d)).toEqual(core(base));
      }
    }
  });

  it('on: calls only ever become folds (PLO4 and PLO5), and some do', () => {
    let removed = 0;
    for (const [table, size] of [
      [PLO5, 5],
      [PLO4, 4],
    ] as const)
      for (const [i, hole] of dealer(20261127 + size, 300, size, []).entries()) {
        const off = decideAt(
          BB_VS_SB_SQUEEZE_OPENER_BEHIND,
          table,
          hole,
          BASE,
          1000 + i,
          asTable()
        );
        const on = decideAt(BB_VS_SB_SQUEEZE_OPENER_BEHIND, table, hole, ON, 1000 + i, asTable());
        if (on.decision.action === off.decision.action) continue;
        expect([off.decision.action, on.decision.action]).toEqual(['call', 'fold']);
        removed++;
      }
    expect(removed).toBeGreaterThan(0);
  });

  it('on: the button control spot (in position against everyone) decides exactly as off', () => {
    for (const [i, hole] of dealer(20261128, 60, 5, []).entries()) {
      const off = decideAt(BTN_VS_CO_THREE_BET, PLO5, hole, BASE, 2000 + i, asTable());
      const on = decideAt(BTN_VS_CO_THREE_BET, PLO5, hole, ON, 2000 + i, asTable());
      expect(core(on)).toEqual(core(off));
    }
  });
});

describe('cost', () => {
  it('a decision with the option on costs about what it costs off (relative, fastest round)', () => {
    const hands = dealer(20261129, 30, 5, []);
    const run = (opts: HorseDecideOpts) => () => {
      for (const [i, hole] of hands.entries())
        decideAt(BB_VS_SB_SQUEEZE_OPENER_BEHIND, PLO5, hole, opts, 3000 + i, asTable());
    };
    const cost = measureRelativeCost(run(ON), run(BASE), { rounds: 5, warmupRounds: 1 });
    expect(cost.ratio).toBeLessThan(RATIO_DECISION);
  });
});
