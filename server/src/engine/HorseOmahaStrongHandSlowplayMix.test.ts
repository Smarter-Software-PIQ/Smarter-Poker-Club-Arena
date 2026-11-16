/**
 * OMAHA STRONG HAND SLOWPLAY MIX (owner 2026-11-15 14:13; option
 * omahaStrongHandSlowplayMix, default OFF). "ITS OK FOR HORSES TO JUST CALL
 * WITH THE NUTS, OR JUST CALL WITH TOP FULL HOUSE. THEY SHOULDN'T ALWAYS
 * RAISE 100% OF THE TIME, AND THEY SHOULD CHECK SOMETIMES WITH A SET ON SUPER
 * DRY BOARDS."
 *
 * Classes, many seeds, through HorseLogic.decide on top of the day's release
 * set: in the intended spots the call and the check happen at a frequency
 * strictly between 0 and 1; the frequency is monotone in how hard the hand is
 * to outdraw and in the opponent's aggression; the hand is never folded; a
 * vulnerable nut hand mostly raises; a wet board, a hand that is not nut
 * class, an owner-ruled check and every other game are untouched; unset and
 * false are byte-identical and the strategy stream ends where it ended
 * without the option; every action is legal and passes the receipt validator.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { saveFastRandom } from './HorseEval.js';
import type { HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import {
  OMAHA_SLOWPLAY_CALL_CAP,
  OMAHA_SLOWPLAY_CALL_SALT,
  OMAHA_SLOWPLAY_CHECK_CAP,
  OMAHA_SLOWPLAY_CHECK_SALT,
  OMAHA_SLOWPLAY_IP_MAX_HURT,
  OMAHA_SLOWPLAY_KEEP_FLOOR,
  OMAHA_SLOWPLAY_THREE_WAY_SCALE,
  OMAHA_SLOWPLAY_VULNERABLE_CAP,
  omahaSlowplayAdmitsCall,
  omahaSlowplayAdmitsCheck,
  omahaSlowplayAdmitsCheckWithRequest,
  omahaSlowplayCallDecision,
  omahaSlowplayCallFrequency,
  omahaSlowplayCallScope,
  omahaSlowplayCheckDecision,
  omahaSlowplayCheckFrequency,
  omahaSlowplayCheckScope,
  omahaSlowplayHurtShare,
  omahaSlowplayKeepShare,
  omahaSlowplayReadOf,
  omahaSlowplayUnit,
  omahaVeryDryFlop,
  type OmahaSlowplayRead,
} from './HorseOmahaStrongHandSlowplayMix.js';
import {
  SLOWPLAY_READS,
  SLOWPLAY_RELEASE_SET,
  slowplayDecide,
  slowplayState,
  type SlowplaySpot,
  type SlowplayState,
} from './HorseOmahaStrongHandSlowplayMix.test-support.js';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';

const RELEASE = SLOWPLAY_RELEASE_SET;
const MIX: HorseDecideOpts = { ...RELEASE, omahaStrongHandSlowplayMix: true };
const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + 7919 * i);
const NONE: OmahaSlowplayRead = { aggression: 0, station: 0, passive: 0 };
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const readAs = (name: keyof typeof SLOWPLAY_READS) =>
  vi
    .spyOn(HorseMind, 'omahaReadConditionalOf')
    .mockImplementation((() => SLOWPLAY_READS[name]) as never);

const legal = (st: SlowplayState, d: HorseDecision) => {
  expect(st.gs.legalActions).toContain(d.action);
  if (d.action === 'call') expect(d.amount).toBeCloseTo(st.gs.toCall as number, 9);
  expect(
    horseDecisionReceiptRefusal(structuredClone(d), String(st.gs.gameVariant), {
      player: st.hero,
      gameState: st.gs,
    })
  ).toBeNull();
};

interface Tally {
  n: number;
  actions: Record<string, number>;
  /** decisions the mix changed (its receipt fired) */
  mixed: number;
  /** decisions whose release-set answer was the wager the mix reads */
  wagers: number;
}
/** Every hole of the class at every seed: the release answer, then the mix's on the same seed. */
function tally(
  spots: SlowplaySpot[],
  receipt: 'omaha_strong_hand_slowplay_call' | 'omaha_strong_hand_slowplay_check',
  from: readonly string[],
  to: string
): Tally {
  const t: Tally = { n: 0, actions: {}, mixed: 0, wagers: 0 };
  enableBrainTelemetry();
  for (const spot of spots) {
    const st = slowplayState(spot);
    for (const seed of SEEDS) {
      const before = slowplayDecide(st, RELEASE, seed);
      drainFires();
      const d = slowplayDecide(st, { ...MIX, telemetry: true }, seed);
      const fired = drainFires().some((f) => f.feature === receipt && f.fires > 0);
      t.n++;
      t.actions[d.action] = (t.actions[d.action] ?? 0) + 1;
      if (from.includes(before.action)) t.wagers++;
      legal(st, d);
      // Never a fold of its own: a fold is the release answer or it is not made.
      expect(d.action === 'fold').toBe(before.action === 'fold');
      if (fired) {
        t.mixed++;
        // The mix only ever turns the wager it reads into the call or the check.
        expect(from).toContain(before.action);
        expect(d.action).toBe(to);
      } else {
        expect(d.action).toBe(before.action);
        expect(d.amount ?? null).toBe(before.amount ?? null);
      }
    }
  }
  return t;
}
const share = (t: Tally) => (t.wagers > 0 ? t.mixed / t.wagers : 0);

const facing = (hole: string, board: string, more: Partial<SlowplaySpot> = {}): SlowplaySpot => ({
  hole,
  board,
  opponents: [1],
  position: 'ip',
  bettor: 1,
  betFrac: 1,
  ...more,
});
const lead = (hole: string, board: string, more: Partial<SlowplaySpot> = {}): SlowplaySpot => ({
  hole,
  board,
  opponents: [1],
  position: 'oop',
  ...more,
});

const TOP_SET_DRY = ['KsKdQc9s5h', 'KsKcJd6s4h', 'KdKcTs7h2c'];
const NUT_FLUSH = ['AhQhJc9s5d', 'AhTh7c6s2d', 'Ah4hQsJd9c'];
const NUT_STRAIGHT = ['JsTdAc4s2h', 'JcTsKd3h2s', 'JdTcQs5c4d'];
const RAISE = ['raise', 'all_in'] as const;
const CALL_RECEIPT = 'omaha_strong_hand_slowplay_call' as const;
const CHECK_RECEIPT = 'omaha_strong_hand_slowplay_check' as const;

describe('the definitions', () => {
  it('a very dry flop is three suits, three ranks, every two at least five apart, the ace high and low', () => {
    expect(omahaVeryDryFlop(cards('Kh8c3d'))).toBe(true);
    expect(omahaVeryDryFlop(cards('Qh7c2d'))).toBe(true);
    expect(omahaVeryDryFlop(cards('Kh7c2d'))).toBe(true);
    expect(omahaVeryDryFlop(cards('Ah9c4d'))).toBe(false); // the ace and the four
    expect(omahaVeryDryFlop(cards('Kh8h3d'))).toBe(false); // two of a suit
    expect(omahaVeryDryFlop(cards('Kh8c8d'))).toBe(false); // paired
    expect(omahaVeryDryFlop(cards('Kh9c3d'))).toBe(false); // king and nine, four apart
    expect(omahaVeryDryFlop(cards('9h8c6d'))).toBe(false);
    expect(omahaVeryDryFlop(cards('Kh8c3d2s'))).toBe(false);
  });

  it('HURT rises from the top set to the bottom set, and no turn card completes a straight or flush', () => {
    const hurt = (hole: string) => {
      const st = slowplayState(lead(hole, 'Kh8c3d'));
      return omahaSlowplayHurtShare(st.hero, st.gs);
    };
    const top = hurt('KsKdQc9s5h');
    const middle = hurt('8s8dQc9s5h');
    const bottom = hurt('3s3cQc9s5h');
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(middle);
    expect(middle).toBeLessThan(bottom);
    expect(top).toBeLessThanOrEqual(OMAHA_SLOWPLAY_IP_MAX_HURT);
    expect(bottom).toBeGreaterThan(OMAHA_SLOWPLAY_IP_MAX_HURT);
    expect(bottom).toBeLessThan(1);
    // eslint-disable-next-line no-console
    console.log(
      `[hurt K83r] top=${top.toFixed(3)} middle=${middle.toFixed(3)} bottom=${bottom.toFixed(3)}`
    );
  });

  it('KEEP: top set on a dry flop is hard to outdraw, the nut straight on 9-8-7 is not; the river is 1', () => {
    const keep = (hole: string, board: string) => {
      const st = slowplayState(facing(hole, board));
      expect(omahaNutClassNow(st.hero, st.gs)).toBe(true);
      return omahaSlowplayKeepShare(st.hero, st.gs);
    };
    const set = keep('KsKdQc9s5h', 'Kh8c3d');
    const flush = keep('AhQhJc9s5d', 'Kh8h3h');
    const straight = keep('JsTdAc4s2h', '9h8c7d');
    expect(set).toBeGreaterThan(flush);
    expect(flush).toBeGreaterThan(OMAHA_SLOWPLAY_KEEP_FLOOR);
    expect(straight).toBeLessThan(OMAHA_SLOWPLAY_KEEP_FLOOR);
    expect(keep('KsKdJc9s7h', 'Kh8c3d2sQc')).toBe(1);
    // eslint-disable-next-line no-console
    console.log(
      `[keep] top set K83r=${set.toFixed(3)} nut flush K83 monotone=${flush.toFixed(3)} nut straight 987r=${straight.toFixed(3)}`
    );
  });

  it('the reads: nothing measured is neutral; an aggressor, a station and a passive player are told apart', () => {
    expect(omahaSlowplayReadOf(null)).toEqual(NONE);
    const a = omahaSlowplayReadOf(SLOWPLAY_READS.aggressor);
    const s = omahaSlowplayReadOf(SLOWPLAY_READS.station);
    const p = omahaSlowplayReadOf(SLOWPLAY_READS.passive);
    expect(a).toEqual({ aggression: 1, station: 0, passive: 0 });
    expect(s.station).toBe(1);
    expect(s.aggression).toBe(0);
    expect(p.passive).toBe(1);
    expect(p.aggression).toBe(0);
  });

  it('the derived draw is uniform in [0, 1), a function of the stream position, the spot and the salt', () => {
    let sum = 0;
    const seen = new Set<number>();
    for (let i = 1; i <= 4000; i++) {
      const u = omahaSlowplayUnit(
        i * 2654435761,
        'p6:flop:1050:KsKd:Kh8c3d',
        OMAHA_SLOWPLAY_CALL_SALT
      );
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      sum += u;
      seen.add(u);
    }
    expect(sum / 4000).toBeGreaterThan(0.47);
    expect(sum / 4000).toBeLessThan(0.53);
    expect(seen.size).toBeGreaterThan(3900);
    const a = omahaSlowplayUnit(7, 'k', OMAHA_SLOWPLAY_CALL_SALT);
    expect(omahaSlowplayUnit(7, 'k', OMAHA_SLOWPLAY_CALL_SALT)).toBe(a);
    expect(omahaSlowplayUnit(7, 'k', OMAHA_SLOWPLAY_CHECK_SALT)).not.toBe(a);
    expect(omahaSlowplayUnit(8, 'k', OMAHA_SLOWPLAY_CALL_SALT)).not.toBe(a);
    expect(omahaSlowplayUnit(7, 'j', OMAHA_SLOWPLAY_CALL_SALT)).not.toBe(a);
  });
});

describe('the frequencies are monotone and strictly between 0 and 1 in the intended spots', () => {
  const st = slowplayState(facing('KsKdQc9s5h', 'Kh8c3d'));
  const scope = omahaSlowplayCallScope(st.hero, st.gs)!;

  it('the call: rises with KEEP and with the aggression of the bettor, falls with a station', () => {
    expect(scope).not.toBeNull();
    let last = -1;
    for (let keep = 0; keep <= 1.0001; keep += 0.05) {
      const f = omahaSlowplayCallFrequency({ scope, keep, read: NONE });
      expect(f).toBeGreaterThanOrEqual(last);
      expect(f).toBeLessThanOrEqual(OMAHA_SLOWPLAY_CALL_CAP);
      if (keep < OMAHA_SLOWPLAY_KEEP_FLOOR - 1e-9)
        expect(f).toBeLessThanOrEqual(OMAHA_SLOWPLAY_VULNERABLE_CAP);
      last = f;
    }
    expect(last).toBeGreaterThan(0.3);
    expect(last).toBeLessThan(1);
    let lastA = -1;
    for (let a = 0; a <= 1.0001; a += 0.1) {
      const f = omahaSlowplayCallFrequency({
        scope,
        keep: 0.93,
        read: { aggression: a, station: 0, passive: 0 },
      });
      expect(f).toBeGreaterThanOrEqual(lastA);
      lastA = f;
    }
    const plain = omahaSlowplayCallFrequency({ scope, keep: 0.93, read: NONE });
    expect(lastA).toBeGreaterThan(plain);
    expect(lastA).toBeLessThan(1);
    const station = omahaSlowplayCallFrequency({
      scope,
      keep: 0.93,
      read: { aggression: 0, station: 1, passive: 0 },
    });
    expect(station).toBeLessThan(plain);
    expect(station).toBeGreaterThan(0);
    // out of position, three-way and a short stack behind each lower it
    expect(
      omahaSlowplayCallFrequency({ scope: { ...scope, inPosition: false }, keep: 0.93, read: NONE })
    ).toBeLessThan(plain);
    expect(
      omahaSlowplayCallFrequency({ scope: { ...scope, opponents: 2 }, keep: 0.93, read: NONE })
    ).toBeCloseTo(plain * OMAHA_SLOWPLAY_THREE_WAY_SCALE, 3);
    expect(
      omahaSlowplayCallFrequency({ scope: { ...scope, sprAfterCall: 0.5 }, keep: 0.93, read: NONE })
    ).toBeLessThan(plain);
  });

  it('the river call: falls as more of his range calls a raise and loses; rises against an aggressor; a station is raised', () => {
    const river = { ...scope, street: 'river' as const };
    let last = 2;
    for (let c = 0; c <= 1.0001; c += 0.1) {
      const f = omahaSlowplayCallFrequency({
        scope: river,
        keep: 1,
        read: NONE,
        riverRaise: { continues: c, win: 1 },
      });
      expect(f).toBeLessThanOrEqual(last);
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThan(0.5);
      last = f;
    }
    const mid = { continues: 0.4, win: 1 };
    const plain = omahaSlowplayCallFrequency({
      scope: river,
      keep: 1,
      read: NONE,
      riverRaise: mid,
    });
    expect(
      omahaSlowplayCallFrequency({
        scope: river,
        keep: 1,
        read: { aggression: 1, station: 0, passive: 0 },
        riverRaise: mid,
      })
    ).toBeGreaterThan(plain);
    expect(
      omahaSlowplayCallFrequency({
        scope: river,
        keep: 1,
        read: { aggression: 0, station: 1, passive: 0 },
        riverRaise: mid,
      })
    ).toBeLessThan(plain);
  });

  it('the check: falls with HURT, rises with aggression, is zero against a passive player and in position when HURT is high', () => {
    const cs = omahaSlowplayCheckScope(
      ...(() => {
        const s = slowplayState(lead('KsKdQc9s5h', 'Kh8c3d'));
        return [s.hero, s.gs] as const;
      })()
    )!;
    expect(cs).not.toBeNull();
    expect(cs.inPosition).toBe(false);
    let last = 2;
    for (let h = 0; h <= 1.0001; h += 0.05) {
      const f = omahaSlowplayCheckFrequency(cs, h, NONE);
      expect(f).toBeLessThanOrEqual(last);
      expect(f).toBeLessThanOrEqual(OMAHA_SLOWPLAY_CHECK_CAP);
      last = f;
    }
    let lastA = -1;
    for (let a = 0; a <= 1.0001; a += 0.1) {
      const f = omahaSlowplayCheckFrequency(cs, 0.22, { aggression: a, station: 0, passive: 0 });
      expect(f).toBeGreaterThanOrEqual(lastA);
      lastA = f;
    }
    const plain = omahaSlowplayCheckFrequency(cs, 0.22, NONE);
    expect(plain).toBeGreaterThan(0);
    expect(lastA).toBeGreaterThan(plain);
    expect(lastA).toBeLessThan(1);
    expect(omahaSlowplayCheckFrequency(cs, 0.22, { aggression: 0, station: 0, passive: 1 })).toBe(
      0
    );
    expect(omahaSlowplayCheckFrequency(cs, 0.22, { aggression: 0, station: 1, passive: 0 })).toBe(
      0
    );
    expect(omahaSlowplayCheckFrequency({ ...cs, inPosition: true }, 0.4, NONE)).toBe(0);
    expect(omahaSlowplayCheckFrequency({ ...cs, inPosition: true }, 0.22, NONE)).toBe(plain);
    expect(omahaSlowplayCheckFrequency({ ...cs, opponents: 2 }, 0.22, NONE)).toBeCloseTo(
      plain * OMAHA_SLOWPLAY_THREE_WAY_SCALE,
      3
    );
    // the pot already large beside the stacks
    expect(omahaSlowplayCheckFrequency({ ...cs, spr: 1 }, 0.22, NONE)).toBeLessThan(plain);
  });

  it('the draw decides: under the frequency the raise is the exact call and the bet a check; over it nothing changes', () => {
    const raise: HorseDecision = {
      action: 'raise',
      amount: st.gs.maxRaiseTo as number,
      thinkTime: 1,
    };
    const called = omahaSlowplayCallDecision(raise, st.hero, st.gs, { unit: 0, read: NONE });
    expect(called.changed).toBe('slowplay_call');
    expect(called.decision).toMatchObject({ action: 'call', amount: st.gs.toCall });
    expect(called.frequency).toBeGreaterThan(0);
    expect(called.frequency).toBeLessThan(1);
    const kept = omahaSlowplayCallDecision(raise, st.hero, st.gs, { unit: 0.999, read: NONE });
    expect(kept.changed).toBeNull();
    expect(kept.decision).toBe(raise);
    for (const action of ['call', 'fold', 'check', 'bet'] as const) {
      const d: HorseDecision = { action, thinkTime: 1 };
      expect(omahaSlowplayCallDecision(d, st.hero, st.gs, { unit: 0, read: NONE }).decision).toBe(
        d
      );
    }
    const ls = slowplayState(lead('KsKdQc9s5h', 'Kh8c3d'));
    const bet: HorseDecision = { action: 'bet', amount: 10, thinkTime: 1 };
    const checked = omahaSlowplayCheckDecision(bet, ls.hero, ls.gs, { unit: 0, read: () => NONE });
    expect(checked.changed).toBe('slowplay_check');
    expect(checked.decision.action).toBe('check');
    expect(checked.decision.amount).toBeUndefined();
    expect(
      omahaSlowplayCheckDecision(bet, ls.hero, ls.gs, { unit: 0.999, read: () => NONE }).decision
    ).toBe(bet);
    // an owner-ruled check, a call and a fold are never the check mix's to change
    for (const action of ['check', 'call', 'fold', 'raise', 'all_in'] as const) {
      const d: HorseDecision = { action, thinkTime: 1 };
      expect(
        omahaSlowplayCheckDecision(d, ls.hero, ls.gs, { unit: 0, read: () => NONE }).decision
      ).toBe(d);
    }
  });
});

describe('(a) facing a bet with a nut-class hand, many seeds', () => {
  it('top set on a dry flop, heads-up in position: calls sometimes, raises sometimes, never folds; more against an aggressor, less against a station', () => {
    const spots = TOP_SET_DRY.map((h) => facing(h, 'Kh8c3d'));
    const unknown = tally(spots, CALL_RECEIPT, RAISE, 'call');
    readAs('aggressor');
    const aggressor = tally(spots, CALL_RECEIPT, RAISE, 'call');
    readAs('station');
    const station = tally(spots, CALL_RECEIPT, RAISE, 'call');
    for (const t of [unknown, aggressor]) {
      expect(t.wagers).toBeGreaterThan(t.n * 0.8);
      expect(share(t)).toBeGreaterThan(0.1);
      expect(share(t)).toBeLessThan(0.9);
    }
    expect(share(aggressor)).toBeGreaterThan(share(unknown));
    expect(share(station)).toBeLessThan(share(unknown));
    // eslint-disable-next-line no-console
    console.log(
      `[a flop top set K83r HU ip] call share of raises: unknown=${share(unknown).toFixed(2)} aggressor=${share(aggressor).toFixed(2)} station=${share(station).toFixed(2)} (n=${unknown.n} each)`
    );
  });

  it('out of position and three-way it still mixes, less often', () => {
    const ip = tally(
      TOP_SET_DRY.map((h) => facing(h, 'Kh8c3d')),
      CALL_RECEIPT,
      RAISE,
      'call'
    );
    const three = tally(
      TOP_SET_DRY.map((h) => facing(h, 'Kh8c3d', { opponents: [1, 3], position: 'oop' })),
      CALL_RECEIPT,
      RAISE,
      'call'
    );
    expect(share(three)).toBeGreaterThan(0);
    expect(share(three)).toBeLessThan(share(ip));
    // eslint-disable-next-line no-console
    console.log(
      `[a flop top set K83r] HU ip=${share(ip).toFixed(2)} three-way oop=${share(three).toFixed(2)}`
    );
  });

  it('monotone in vulnerability: top set on the dry flop calls more than the nut flush, and the vulnerable nut straight mostly raises', () => {
    const set = tally(
      TOP_SET_DRY.map((h) => facing(h, 'Kh8c3d')),
      CALL_RECEIPT,
      RAISE,
      'call'
    );
    const flush = tally(
      NUT_FLUSH.map((h) => facing(h, 'Kh8h3h')),
      CALL_RECEIPT,
      RAISE,
      'call'
    );
    const straight = tally(
      NUT_STRAIGHT.map((h) => facing(h, '9h8c7d')),
      CALL_RECEIPT,
      RAISE,
      'call'
    );
    expect(share(set)).toBeGreaterThan(share(flush));
    expect(share(set)).toBeGreaterThan(share(straight));
    expect(share(flush)).toBeGreaterThan(0);
    // the vulnerable nut hand mostly raises
    expect(share(straight)).toBeLessThan(0.3);
    expect(straight.actions.raise ?? 0).toBeGreaterThan(straight.n / 2);
    // eslint-disable-next-line no-console
    console.log(
      `[a flop HU ip, call share of raises] top set dry=${share(set).toFixed(2)} nut flush=${share(flush).toFixed(2)} nut straight 987r=${share(straight).toFixed(2)}`
    );
  });

  it('the turn (top full house) and the river (nut flush, top full house): mixed, never folded, the river less than half', () => {
    const turn = tally(
      ['KsKdQc9s5h', 'KsKcJd6s4h', 'KdKcTs7h2c'].map((h) => facing(h, 'Kh8c8d3s')),
      CALL_RECEIPT,
      RAISE,
      'call'
    );
    const riverFlush = tally(
      ['AhQhJc7s5d', 'AhTh7c6s4d', 'Ah4hQsJd6c'].map((h) => facing(h, 'Kh8c3h2h9s')),
      CALL_RECEIPT,
      RAISE,
      'call'
    );
    const riverBoat = tally(
      ['KsKdQc9s5h', 'KsKcJd6s4h', 'KdKcTs7h9c'].map((h) => facing(h, 'Kh8c8d3s2c')),
      CALL_RECEIPT,
      RAISE,
      'call'
    );
    for (const t of [turn, riverFlush, riverBoat]) {
      expect(share(t)).toBeGreaterThan(0);
      expect(share(t)).toBeLessThan(0.9);
    }
    expect(share(riverFlush)).toBeLessThan(0.5);
    expect(share(riverBoat)).toBeLessThan(0.5);
    // eslint-disable-next-line no-console
    console.log(
      `[a HU ip, call share of raises] turn top full house=${share(turn).toFixed(2)} river nut flush=${share(riverFlush).toFixed(2)} river top full house=${share(riverBoat).toFixed(2)}`
    );
  });

  it('a hand that is not nut class is never touched (middle set facing a flop bet, two pair on the turn)', () => {
    for (const spot of [
      facing('8s8dQc9s5h', 'Kh8c3d'),
      facing('Kd8dQc9s5h', 'Kh8c3d2s'),
      facing('Qc7c2s3s4c', '9dQdJh7h'),
    ]) {
      const t = tally([spot], CALL_RECEIPT, RAISE, 'call');
      expect(t.mixed).toBe(0);
    }
  });
});

describe('(b) a set on a very dry flop, nothing to call, many seeds', () => {
  const TOP = TOP_SET_DRY;
  const BOTTOM = ['3s3cQc9s5h', '3s3hJd6s4h', '3c3hTs7h2c'];
  const BET = ['bet'] as const;

  it('out of position heads-up: checks sometimes, bets mostly; more against an aggressor; never against a passive player or a station', () => {
    const spots = TOP.map((h) => lead(h, 'Kh8c3d'));
    const unknown = tally(spots, CHECK_RECEIPT, BET, 'check');
    readAs('aggressor');
    const aggressor = tally(spots, CHECK_RECEIPT, BET, 'check');
    readAs('station');
    const station = tally(spots, CHECK_RECEIPT, BET, 'check');
    readAs('passive');
    const passive = tally(spots, CHECK_RECEIPT, BET, 'check');
    expect(share(unknown)).toBeGreaterThan(0.05);
    expect(share(unknown)).toBeLessThan(0.5);
    expect(share(aggressor)).toBeGreaterThan(share(unknown));
    expect(share(aggressor)).toBeLessThan(0.7);
    expect(station.mixed).toBe(0);
    expect(passive.mixed).toBe(0);
    // eslint-disable-next-line no-console
    console.log(
      `[b top set K83r HU oop] check share of bets: unknown=${share(unknown).toFixed(2)} aggressor=${share(aggressor).toFixed(2)} station=${share(station).toFixed(2)} passive=${share(passive).toFixed(2)}; final actions unknown=${JSON.stringify(unknown.actions)}`
    );
  });

  it('monotone in vulnerability: the top set checks more than the bottom set; in position the bottom set never gives the free card', () => {
    readAs('aggressor');
    const top = tally(
      TOP.map((h) => lead(h, 'Kh8c3d')),
      CHECK_RECEIPT,
      BET,
      'check'
    );
    const bottom = tally(
      BOTTOM.map((h) => lead(h, 'Kh8c3d')),
      CHECK_RECEIPT,
      BET,
      'check'
    );
    const bottomIp = tally(
      BOTTOM.map((h) => lead(h, 'Kh8c3d', { position: 'ip' })),
      CHECK_RECEIPT,
      BET,
      'check'
    );
    const topIp = tally(
      TOP.map((h) => lead(h, 'Kh8c3d', { position: 'ip' })),
      CHECK_RECEIPT,
      BET,
      'check'
    );
    expect(share(top)).toBeGreaterThan(share(bottom));
    expect(share(bottom)).toBeGreaterThan(0);
    expect(bottomIp.mixed).toBe(0);
    expect(share(topIp)).toBeGreaterThan(0);
    expect(share(topIp)).toBeLessThan(1);
    // eslint-disable-next-line no-console
    console.log(
      `[b K83r vs aggressor, check share of bets] top oop=${share(top).toFixed(2)} bottom oop=${share(bottom).toFixed(2)} top ip=${share(topIp).toFixed(2)} bottom ip=${share(bottomIp).toFixed(2)}`
    );
  });

  it('three-way it mixes less; four-way never', () => {
    readAs('aggressor');
    const hu = tally(
      TOP.map((h) => lead(h, 'Kh8c3d')),
      CHECK_RECEIPT,
      BET,
      'check'
    );
    const three = tally(
      TOP.map((h) => lead(h, 'Kh8c3d', { opponents: [1, 3] })),
      CHECK_RECEIPT,
      BET,
      'check'
    );
    const four = tally(
      TOP.map((h) => lead(h, 'Kh8c3d', { opponents: [1, 2, 3] })),
      CHECK_RECEIPT,
      BET,
      'check'
    );
    expect(share(three)).toBeGreaterThan(0);
    expect(share(three)).toBeLessThan(share(hu));
    expect(four.mixed).toBe(0);
  });

  it('never on a wet, two-suited, connected or paired flop: every decision is the release decision', () => {
    readAs('aggressor');
    for (const [hole, board] of [
      ['9s9dQc3s2h', '9h8h6c'],
      ['KsKdQc9s5h', 'Kh8h3d'],
      ['KsKdQc7s5h', 'Kh9c3d'],
      ['KsKdQc9s5h', 'KhTc9d'],
      ['AsAdQc9s5h', 'Ah9c4d'],
    ] as const) {
      const st = slowplayState(lead(hole, board));
      expect(omahaSlowplayCheckScope(st.hero, st.gs)).toBeNull();
      expect(omahaSlowplayAdmitsCheck(st.hero, st.gs)).toBe(false);
      const t = tally([lead(hole, board)], CHECK_RECEIPT, BET, 'check');
      expect(t.mixed).toBe(0);
    }
  });
});

describe('scope, precedence and identity', () => {
  it('PLO6, a tournament, a hand below a set and the turn are outside the check mix; the whole-stack call is outside the call mix', () => {
    const t = slowplayState(lead('KsKdQc9s5h', 'Kh8c3d', { mode: 'tournament' }));
    expect(omahaSlowplayCheckScope(t.hero, t.gs)).toBeNull();
    const six = slowplayState(lead('KsKdQc9s5h', 'Kh8c3d'));
    expect(
      omahaSlowplayCheckScope(six.hero, { ...six.gs, gameVariant: 'plo6' } as never)
    ).toBeNull();
    const pair = slowplayState(lead('KsQdQc9s5h', 'Kh8c3d'));
    expect(omahaSlowplayCheckScope(pair.hero, pair.gs)).toBeNull();
    const turn = slowplayState(lead('KsKdQc9s5h', 'Kh8c3d2s'));
    expect(omahaSlowplayCheckScope(turn.hero, turn.gs)).toBeNull();
    const short = slowplayState(facing('KsKdQc9s5h', 'Kh8c3d', { stackBb: 12, open: 8 }));
    expect(short.hero.stack).toBeLessThanOrEqual((short.gs.toCall as number) + 0.005);
    expect(omahaSlowplayCallScope(short.hero, short.gs)).toBeNull();
    const tf = slowplayState(facing('KsKdQc9s5h', 'Kh8c3d', { mode: 'tournament' }));
    expect(omahaSlowplayCallScope(tf.hero, tf.gs)).toBeNull();
  });

  it('the validator admits the call only in the spot with a nut-class hand and the exact chips, and the check only in its spot', () => {
    const st = slowplayState(facing('KsKdQc9s5h', 'Kh8c3d'));
    expect(omahaSlowplayAdmitsCall(st.hero, st.gs, st.gs.toCall as number)).toBe(true);
    expect(omahaSlowplayAdmitsCall(st.hero, st.gs, (st.gs.toCall as number) + 1)).toBe(false);
    const mid = slowplayState(facing('8s8dQc9s5h', 'Kh8c3d'));
    expect(omahaSlowplayAdmitsCall(mid.hero, mid.gs, mid.gs.toCall as number)).toBe(false);
    const ls = slowplayState(lead('KsKdQc9s5h', 'Kh8c3d'));
    expect(omahaSlowplayAdmitsCheck(ls.hero, ls.gs)).toBe(true);
  });

  it('the bet that became a check is admitted by the mix only with the request it came with', () => {
    const ls = slowplayState(lead('KsKdQc9s5h', 'Kh8c3d'));
    const request = { player: ls.hero, gameState: ls.gs };
    const game = String(ls.gs.gameVariant).toLowerCase();
    expect(omahaSlowplayAdmitsCheckWithRequest(game, request)).toBe(true);
    // no request: nothing is admitted on the mix's account
    expect(omahaSlowplayAdmitsCheckWithRequest(game, undefined)).toBe(false);
    // a request of another game, and a request outside the mix's spot
    expect(omahaSlowplayAdmitsCheckWithRequest(game === 'plo5' ? 'plo4' : 'plo5', request)).toBe(
      false
    );
    const wet = slowplayState(lead('9s9dQc3s2h', '9h8h6c'));
    expect(omahaSlowplayAdmitsCheckWithRequest(game, { player: wet.hero, gameState: wet.gs })).toBe(
      false
    );
  });

  it('it stands aside when omahaNutClassValueSize is on', () => {
    const on: HorseDecideOpts = { ...MIX, omahaNutClassValueSize: true };
    const off: HorseDecideOpts = { ...RELEASE, omahaNutClassValueSize: true };
    for (const spot of [facing('KsKdQc9s5h', 'Kh8c3d'), lead('KsKdQc9s5h', 'Kh8c3d')]) {
      const st = slowplayState(spot);
      for (const seed of SEEDS) {
        const a = slowplayDecide(st, on, seed);
        const b = slowplayDecide(st, off, seed);
        expect([a.action, a.amount ?? null]).toEqual([b.action, b.amount ?? null]);
      }
    }
  });

  it('unset, false and a non-boolean are byte-identical to the base, alone and on the release set, and the strategy stream ends where it ended', () => {
    const spots = [
      facing('KsKdQc9s5h', 'Kh8c3d'),
      facing('AhQhJc9s5d', 'Kh8h3h', { position: 'oop' }),
      facing('KsKdQc9s5h', 'Kh8c8d3s'),
      facing('AhQhJc7s5d', 'Kh8c3h2h9s'),
      lead('KsKdQc9s5h', 'Kh8c3d'),
      lead('3s3cQc9s5h', 'Kh8c3d', { position: 'ip' }),
      lead('9s9dQc3s2h', '9h8h6c'),
      { ...facing('KsKdQc9', 'Kh8c3d'), variant: 'plo4' as const },
      { ...lead('KsKdQc9', 'Kh8c3d'), variant: 'plo4' as const },
    ].map(slowplayState);
    const digest = (opts: HorseDecideOpts) => {
      const h = createHash('sha256');
      for (const st of spots)
        for (const seed of SEEDS.slice(0, 16)) {
          const d = slowplayDecide(st, opts, seed);
          h.update(JSON.stringify([d.action, d.amount ?? null, saveFastRandom()]));
        }
      return h.digest('hex');
    };
    const base = digest({});
    expect(digest({ omahaStrongHandSlowplayMix: false })).toBe(base);
    expect(digest({ omahaStrongHandSlowplayMix: 1 as unknown as boolean })).toBe(base);
    const release = digest(RELEASE);
    expect(digest({ ...RELEASE, omahaStrongHandSlowplayMix: false })).toBe(release);
    // On: the answers differ, the stream position after every decision does not.
    let changed = 0;
    for (const st of spots)
      for (const seed of SEEDS.slice(0, 16)) {
        const off = slowplayDecide(st, RELEASE, seed);
        const offStream = saveFastRandom();
        const on = slowplayDecide(st, MIX, seed);
        expect(saveFastRandom()).toBe(offStream);
        if (on.action !== off.action) changed++;
        legal(st, on);
      }
    expect(changed).toBeGreaterThan(0);
  });

  it('PLO4: the same two mixes', () => {
    readAs('aggressor');
    const a = tally(
      ['KsKdQc9s', 'KsKcJd6s', 'KdKcTs7h'].map((h) => ({
        ...facing(h, 'Kh8c3d'),
        variant: 'plo4' as const,
      })),
      CALL_RECEIPT,
      RAISE,
      'call'
    );
    const b = tally(
      ['KsKdQc9s', 'KsKcJd6s', 'KdKcTs7h'].map((h) => ({
        ...lead(h, 'Kh8c3d'),
        variant: 'plo4' as const,
      })),
      CHECK_RECEIPT,
      ['bet'],
      'check'
    );
    for (const t of [a, b]) {
      expect(share(t)).toBeGreaterThan(0);
      expect(share(t)).toBeLessThan(1);
    }
    // eslint-disable-next-line no-console
    console.log(
      `[plo4 vs aggressor] call share=${share(a).toFixed(2)} check share=${share(b).toFixed(2)}`
    );
  });
});
