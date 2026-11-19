/**
 * THE RE-RAISED-POT PRICING OF A TABLE REACHES A LIGHTNING HAND (option
 * omahaReraisedPositionInLightning, default OFF).
 *
 * #11287 (finding F-02 and the realization measurement) priced a PLO4/PLO5
 * cash call of a re-raise by seat order against the re-raiser and stopped
 * charging a raiser or caller still to act; a Lightning hand kept the old
 * reading (omahaReraisedLaneUntouched). The lines are recorded production
 * Lightning PLO5 1/2 hands of 2026-11-18 (HorseLightningParity.test-support):
 * in each the deciding Horse faces an open and a re-raise with the opener
 * still to act, the spot the old reading charges 0.35 for (817 of the 1,506
 * Horse decisions facing a re-raise in that pool that day).
 */
import { describe, expect, it } from 'vitest';
import {
  omahaReraisedCallPricingOf,
  type HorseDecideOpts,
  type HorseGameStateV2,
} from './HorseLogic.js';
import { stateAt } from './HorseComplaintReplay.js';
import { HorseMind } from './HorseMind.js';
import { buildFixture, cards, decideAt, type Spot } from './HorseVpipFloorLimpOnly.test-support.js';
import {
  BASE,
  RECORDED_LINES,
  asLightning,
  asTable,
  core,
  deals,
  decideLightning,
} from './HorseLightningParity.test-support.js';

const ON: HorseDecideOpts = { ...BASE, omahaReraisedPositionInLightning: true };
const TABLE = { variant: 'plo5' as const, floor: 0 };
/** Recorded line E: UTG folds, HJ opens to 8, the cutoff re-raises to 29, the button decides in
 *  position with the opener still to act (recorded: a fast fold, so no recorded cards). */
const LINE_E: Spot = {
  hero: 4,
  prior: [
    [1, 'fold'],
    [2, 'raise', 8],
    [3, 'raise', 29],
  ],
};
const HANDS = deals(20261119, 40);

function pricing(
  spot: Spot,
  hole: string,
  opts: HorseDecideOpts,
  shape: (gs: Record<string, unknown>) => void,
  raiserSeat: number
) {
  HorseMind.reset();
  const fx = buildFixture(spot, TABLE, cards(hole));
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
  );
}

describe('omahaReraisedCallPricingOf in a Lightning hand', () => {
  it('off: the reading Lightning had (the opener still to act is charged, no seat-order position)', () => {
    for (const opts of [
      BASE,
      { ...BASE, omahaReraisedPositionInLightning: false },
      { ...BASE, omahaReraisedPositionInLightning: 'on' as unknown as boolean },
    ]) {
      const a = pricing(RECORDED_LINES.A.spot, RECORDED_LINES.A.hole, opts, asLightning(), 4)!;
      expect(a.position).toBeUndefined();
      expect(a.othersIn).toBe(1);
      expect(a.headsUpDiluted).toBe(1);
      expect(a.inPosition).toBe(false);
    }
  });

  it('on: priced as the same hand at a table is', () => {
    for (const [line, raiserSeat] of [
      [RECORDED_LINES.A, 4],
      [RECORDED_LINES.B, 4],
      [RECORDED_LINES.C, 3],
      [RECORDED_LINES.D, 3],
    ] as const) {
      const pool = pricing(line.spot, line.hole, ON, asLightning(), raiserSeat)!;
      const table = pricing(line.spot, line.hole, BASE, asTable(), raiserSeat)!;
      expect(pool).toEqual(table);
      expect(pool.position).toBeDefined();
      expect(pool.othersIn).toBe(0);
      expect(pool.headsUpDiluted).toBeUndefined();
    }
    // the button behind the re-raiser: in position either way; only the charge goes
    const off = pricing(LINE_E, 'AsKsQhJh9d', BASE, asLightning(), 3)!;
    const on = pricing(LINE_E, 'AsKsQhJh9d', ON, asLightning(), 3)!;
    expect(off.inPosition).toBe(true);
    expect(on.inPosition).toBe(true);
    expect(off.othersIn).toBe(1);
    expect(on.othersIn).toBe(0);
  });

  it('a table hand is priced the same with the option on or off', () => {
    const off = pricing(RECORDED_LINES.A.spot, RECORDED_LINES.A.hole, BASE, asTable(), 4);
    const on = pricing(RECORDED_LINES.A.spot, RECORDED_LINES.A.hole, ON, asTable(), 4);
    expect(on).toEqual(off);
  });
});

describe('decisions', () => {
  const lines: Array<{ spot: Spot; hole?: string }> = [
    RECORDED_LINES.A,
    RECORDED_LINES.B,
    RECORDED_LINES.C,
    RECORDED_LINES.D,
    { spot: LINE_E },
  ];

  it('the recorded Horse hands: what each decides, off and on', () => {
    const out: Record<string, { off: string; on: string }> = {};
    for (const [name, line] of Object.entries(RECORDED_LINES)) {
      const off = decideLightning(line.spot, line.hole, BASE, 4100);
      const on = decideLightning(line.spot, line.hole, ON, 4100);
      out[name] = { off: off.decision.action, on: on.decision.action };
      // the repair may only turn a fold into a call
      if (on.decision.action !== off.decision.action)
        expect([off.decision.action, on.decision.action]).toEqual(['fold', 'call']);
    }
    expect(out).toMatchInlineSnapshot(`
      {
        "A": {
          "off": "fold",
          "on": "fold",
        },
        "B": {
          "off": "fold",
          "on": "fold",
        },
        "C": {
          "off": "fold",
          "on": "fold",
        },
        "D": {
          "off": "fold",
          "on": "fold",
        },
      }
    `);
  });

  it('on: every changed decision is a fold that became a call; a table decision never changes', () => {
    let changed = 0;
    let compared = 0;
    for (const line of lines) {
      for (const [i, hole] of HANDS.entries()) {
        const seed = 4200 + i;
        const off = decideLightning(line.spot, hole, BASE, seed);
        const on = decideLightning(line.spot, hole, ON, seed);
        compared++;
        if (
          on.decision.action !== off.decision.action ||
          on.decision.amount !== off.decision.amount
        ) {
          expect(off.decision.action).toBe('fold');
          expect(on.decision.action).toBe('call');
          changed++;
        }
        if (i < 6) {
          const tOff = decideAt(line.spot, TABLE, hole, BASE, seed, asTable());
          const tOn = decideAt(line.spot, TABLE, hole, ON, seed, asTable());
          expect(core(tOn)).toEqual(core(tOff));
          expect(tOn.next).toBe(tOff.next);
        }
      }
    }
    expect(compared).toBe(lines.length * HANDS.length);
    expect({ changed }).toMatchInlineSnapshot(`
      {
        "changed": 1,
      }
    `);
  });

  it('off (absent, false, non-boolean): the decision and every draw are the base', () => {
    for (const line of lines) {
      for (const [i, hole] of HANDS.slice(0, 10).entries()) {
        const seed = 4300 + i;
        const base = decideLightning(line.spot, hole, BASE, seed);
        for (const opts of [
          { ...BASE, omahaReraisedPositionInLightning: false },
          { ...BASE, omahaReraisedPositionInLightning: 'on' as unknown as boolean },
        ]) {
          const got = decideLightning(line.spot, hole, opts, seed);
          expect(core(got)).toEqual(core(base));
          expect(got.next).toBe(base.next);
        }
      }
    }
  });
});
