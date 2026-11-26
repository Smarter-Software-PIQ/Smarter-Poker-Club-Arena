/**
 * LAW (PLO lead-6 2026-11-24): omahaReraisedPotCallIsPriced and omahaReraisedPotReraiseIsPriced. Facing a 3-bet or
 * more preflop in PLO4/PLO5 cash, a call stands only where its priced EV is not negative (beyond the deadband) and a
 * re-raise only where it is priced at or above the call and the fold, at the actual depth, position against the whole
 * field and number of players. Synthetic cards and synthetic players only.
 *
 *  1. Out of position and multiway (the big blind behind a small-blind 3-bet with the opener and a caller still to
 *     act: the spot the old guard read as "in position"), a hand whose priced EV(call) is below minus the deadband
 *     never calls. On main the same hands are called (the control below), so this law fails on main.
 *  2. Strong hands still continue there (suited and double-suited aces, PLO4 and PLO5).
 *  3. Aces facing a 3-bet heads-up, in or out of position, are never folded: they call or re-raise, as priced.
 *  4. A habitual 3-bettor's own record loosens the defence: the same hands are priced higher and called more.
 *  5. With both options off (absent or false) every decision is the one of main; PLO6, tournaments and Hold'em are
 *     outside the spot.
 *  6. The receipt validator's admissions: the exact call, the largest legal raise-to, nothing else.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { HorseDecideOpts } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { enableBrainTelemetry } from './BrainTelemetry.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import {
  omahaReraisedPotPricedAdmitsCall,
  omahaReraisedPotPricedAdmitsRaise,
  reraisedPotPricedSpot,
} from './HorseOmahaReraisedPotPricedRule.js';
import { reraisedPotVerdict } from './HorseOmahaReraisedPotPriced.js';
import {
  RR_LIVE_OPTS,
  RR_ON,
  rrDecide,
  rrHands,
  rrSetRead,
  rrSpot,
  type RrSpotKind,
} from './HorseOmahaReraisedPotPriced.test-support.js';

enableBrainTelemetry();
afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const ON: HorseDecideOpts = { ...RR_LIVE_OPTS, ...RR_ON };
const OFF: HorseDecideOpts = { ...RR_LIVE_OPTS };

function priced(
  hole: string,
  kind: RrSpotKind,
  read: [number, number] = [0, 0],
  variant: 'plo4' | 'plo5' = 'plo5'
) {
  const { hero, gs } = rrSpot(hole, kind, { variant });
  rrSetRead(variant, read[0], read[1]);
  HorseMind.setDecisionScope(readScopeOf(variant, 6), variant, 'cash');
  try {
    const found = reraisedPotPricedSpot(hero, gs, true);
    if (!found) return null;
    const v = reraisedPotVerdict(found.spot, hero.cards ?? [], [], null);
    return v ? { v, found } : null;
  } finally {
    HorseMind.setDecisionScope(null);
  }
}

describe('omahaReraisedPotCallIsPriced: out of position and multiway, a negative priced call never calls', () => {
  const kind: RrSpotKind = 'bbVsSbSqueezeMw';
  const hands = rrHands(160, 5, 20261124);
  const negative = hands.filter((h) => {
    const p = priced(h, kind);
    return p !== null && p.v.evCall < -p.v.deadband;
  });

  it('the position is read against the whole field: out of position against the players still to act', () => {
    const p = priced('AsAhKsQh9d', kind)!;
    expect(p.found.spot.opponents.filter((o) => o.role === 'behind')).toHaveLength(2);
    expect(p.v.outOfPositionShare).toBeGreaterThan(0.5);
  });

  it('with the option on no such hand is called', () => {
    expect(negative.length).toBeGreaterThan(100);
    const called = negative.filter((h) => rrDecide(h, kind, ON).d.action === 'call');
    expect(called).toEqual([]);
  });

  it('control: main calls hands whose priced call is negative here (the law fails on main)', () => {
    const extra = [
      'JhTh9s8s7c',
      'KdAsTc2sQd',
      'Qs5c7sAs6c',
      'KhAhJc2dKd',
      '6dAc3sAh3d',
      'TcQhKd8cAh',
    ];
    const neg = [...extra, ...negative].filter((h) => {
      const p = priced(h, kind);
      return p !== null && p.v.evCall < -p.v.deadband;
    });
    const calledOnMain = neg.filter((h) => rrDecide(h, kind, OFF).d.action === 'call');
    expect(calledOnMain.length).toBeGreaterThan(0);
  });
});

describe('strong hands still continue', () => {
  it('suited aces are never folded out of position multiway', () => {
    for (const h of ['AsKsAhQh2c', 'AdAcJdTc5s', 'AsAhKhQs']) {
      const variant = h.length === 8 ? 'plo4' : 'plo5';
      const d = rrDecide(h, 'bbVsSbSqueezeMw', ON, 7, { variant }).d;
      expect(d.action, h).not.toBe('fold');
    }
  });

  it('aces facing a 3-bet heads-up are called or re-raised as priced, in and out of position', () => {
    for (const kind of ['oopHu', 'ipHu'] as const)
      for (const h of ['AsAhKsQh9d', 'AdAcJdTc5s', 'AsAhKhQs']) {
        const variant = h.length === 8 ? 'plo4' : 'plo5';
        const d = rrDecide(h, kind, ON, 7, { variant }).d;
        expect(['call', 'raise', 'all_in'], `${kind} ${h}`).toContain(d.action);
      }
  });
});

describe("a habitual 3-bettor's own record loosens the defence", () => {
  it('the same hands are priced higher against his record than against no record, and fewer are folded', () => {
    const hands = rrHands(60, 5, 7);
    let higher = 0;
    for (const h of hands) {
      const a = priced(h, 'oopHu')!;
      const b = priced(h, 'oopHu', [54, 60])!;
      if (b.v.evCall > a.v.evCall) higher++;
    }
    expect(higher).toBeGreaterThan(50);
    const foldsUnread = hands.filter((h) => rrDecide(h, 'oopHu', ON).d.action === 'fold').length;
    const foldsWide = hands.filter(
      (h) => rrDecide(h, 'oopHu', ON, 7, {}, [54, 60]).d.action === 'fold'
    ).length;
    expect(foldsWide).toBeLessThan(foldsUnread);
  });
});

describe('inert with both options off, and only in its own spot', () => {
  const strip = (d: unknown) =>
    JSON.stringify(withoutMeasurements(d), (k, v) => (k === 'thinkTime' ? 0 : v));
  it('absent and false are byte-identical', () => {
    for (const kind of ['bbVsSbSqueezeMw', 'oopHu', 'ipHu', 'oopHuFiveBet'] as const)
      for (const h of rrHands(6, 5, 3)) {
        const a = rrDecide(h, kind, OFF);
        const b = rrDecide(h, kind, {
          ...OFF,
          omahaReraisedPotCallIsPriced: false,
          omahaReraisedPotReraiseIsPriced: false,
        } as HorseDecideOpts);
        expect(strip(b.d)).toBe(strip(a.d));
        expect(b.fires.sort()).toEqual(a.fires.sort());
      }
  });

  it('a tournament is outside the spot', () => {
    const { hero, gs } = rrSpot('KdAsTc2sQd', 'bbVsSbSqueezeMw', { tournament: true });
    expect(reraisedPotPricedSpot(hero, gs, false)).toBeNull();
  });
});

describe('receipt admissions', () => {
  it('admit the exact call and the largest legal raise-to only', () => {
    const { hero, gs } = rrSpot('KdAsTc2sQd', 'bbVsSbSqueezeMw');
    expect(omahaReraisedPotPricedAdmitsCall(hero, gs, gs.toCall)).toBe(true);
    expect(omahaReraisedPotPricedAdmitsCall(hero, gs, (gs.toCall ?? 0) + 1)).toBe(false);
    expect(omahaReraisedPotPricedAdmitsRaise(hero, gs, gs.maxRaiseTo)).toBe(true);
    expect(omahaReraisedPotPricedAdmitsRaise(hero, gs, (gs.maxRaiseTo ?? 0) - 1)).toBe(false);
  });
});
