/**
 * A MEASURED MANIAC'S RE-RAISE IS READ AT HIS RE-RAISE RATE (2026-11-15;
 * option omahaManiacReRaiseWidthMeasured, default OFF).
 *
 * Full sweep of 4,573 human PLO4/PLO5 cash hands: against the biggest winner
 * (raises 55-82% of hands, re-raises 33%) the Horses 4-bet without aces 21
 * times for -1,441 bb and called his re-raises. On the recorded hand 58764659
 * (PLO4, anonymised to seats) a Horse opened a queen-ten-seven-three, was
 * re-raised, 4-bet (decision 10) and called the 5-bet (decision 12), 497 big
 * blinds deep. Both are the maniac price arithmetic, and the range it prices
 * against comes from HorseMind.bandFor, which reads a maniac's re-raise as
 * wide as his opens.
 *
 *  - the read: off, a maniac's 3-bet is his whole raising width; on, his own
 *    re-raise rate once it rests on 12 decayed opportunities, never wider;
 *    a presumed read, a maniac with few counted re-raises and a non-maniac
 *    are read as today;
 *  - the decision: unset and false byte-identical; on, the recorded 4-bet is
 *    not made and the receipt fires; a strong hand still 4-bets; the mind
 *    off, and a player with no memory, are today's play.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind, OMAHA_MANIAC_RERAISE_MIN_OPPS, readScopeOf } from './HorseMind.js';
import {
  freshExploitCounters,
  maniacRaiseWidth,
  opponentExploitRead,
  reRaiseLineWidth,
  type ExploitCounters,
} from './HorseOpponentExploit.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import type { ActionRecord, Card, CardRank, CardSuit } from '../types.js';
import RECORDED from './HorseOmahaManiacReRaiseWidth.fixture.json';

const FX = RECORDED as unknown as ComplaintFixture;
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = Array.from({ length: 12 }, (_, i) => 7000 + i);
const RECEIPT = 'omaha_maniac_reraise_width_measured';
const ON: HorseDecideOpts = { omahaManiacReRaiseWidthMeasured: true };
/** The person in the recorded hand (seat 2), as the replay names seats. */
const PERSON = 'p2';
const SCOPE = readScopeOf('plo4', 6);

interface Rates {
  hands: number;
  vpip: number;
  pfr: number;
  rfi: [number, number];
  threeBet: [number, number];
}
/** Decayed counters at the given rates: [opportunities, rate]. */
function counters(r: Rates): ExploitCounters {
  const c = freshExploitCounters();
  c.hands = r.hands;
  c.vpip = r.vpip * r.hands;
  c.pfr = r.pfr * r.hands;
  c.rfiOpp = r.rfi[0];
  c.rfi = r.rfi[0] * r.rfi[1];
  c.threeBetOpp = r.threeBet[0];
  c.threeBet = r.threeBet[0] * r.threeBet[1];
  return c;
}
/** Lane owner 2026-11-15: the production winner's decayed counters. */
const WINNER: Rates = { hands: 40, vpip: 0.88, pfr: 0.55, rfi: [20, 0.82], threeBet: [15, 0.33] };
const memory = HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> };
const remember = (r: Rates | null): void => {
  if (r) memory.exploitCounters.set(`${SCOPE}|${PERSON}`, counters(r));
};

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

// ─── the read ───────────────────────────────────────────────────────────────

const rec = (seat: number, action: string, amount: number): ActionRecord =>
  ({
    stage: 'preflop',
    seat,
    userId: `p${seat}`,
    action,
    amount,
    isFullRaise: action === 'raise',
    timestamp: seat,
  }) as unknown as ActionRecord;
/** Seat 5 opens, the person in seat 2 re-raises; then seat 5 4-bets and he 5-bets. */
const THREE_BET = [rec(5, 'raise', 2.25), rec(2, 'raise', 7.5)];
const FIVE_BET = [...THREE_BET, rec(5, 'raise', 23.25), rec(2, 'raise', 70.5)];

function band(history: ActionRecord[], r: Rates | null, on: boolean): [number, number] | null {
  HorseMind.reset();
  remember(r);
  HorseMind.setDecisionScope(SCOPE, 'plo4');
  HorseMind.setDecisionReadOptions(on ? { omahaManiacReRaiseMeasured: true } : {});
  const b = HorseMind.bandFor(PERSON, history, 0.5);
  HorseMind.setDecisionScope(null);
  return b;
}
/** The share of hands a band's low edge leaves in (Omaha: 1 - lo). */
const share = (b: [number, number] | null): number => 1 - b![0];

describe('the read (HorseMind.bandFor)', () => {
  it('the winner is a measured maniac whose re-raises are counted', () => {
    const read = opponentExploitRead(counters(WINNER), SCOPE, 'plo4')!;
    expect(read.presumed).not.toBe(true);
    expect(maniacRaiseWidth(read)).toBeGreaterThan(0.6);
    expect(read.stats.threeBet.n).toBeGreaterThanOrEqual(OMAHA_MANIAC_RERAISE_MIN_OPPS);
    // 33% over 15 decayed opportunities, shrunk toward the population: about a quarter
    expect(read.stats.threeBet.mean).toBeGreaterThan(0.2);
    expect(read.stats.threeBet.mean).toBeLessThan(0.4);
  });

  it('off: his 3-bet is read at his whole raising width; on: at his own re-raise rate', () => {
    const read = opponentExploitRead(counters(WINNER), SCOPE, 'plo4')!;
    const whole = maniacRaiseWidth(read)!;
    const own = read.stats.threeBet.mean;
    expect(share(band(THREE_BET, WINNER, false))).toBeCloseTo(whole, 2);
    expect(share(band(THREE_BET, WINNER, true))).toBeCloseTo(own, 2);
    // his 5-bet: the same line rule (reRaiseLineWidth) on the narrower width
    expect(share(band(FIVE_BET, WINNER, false))).toBeCloseTo(reRaiseLineWidth(whole, 3), 2);
    expect(share(band(FIVE_BET, WINNER, true))).toBeCloseTo(reRaiseLineWidth(own, 3), 2);
    expect(share(band(FIVE_BET, WINNER, true))).toBeLessThan(0.3);
  });

  it('never wider than today, and unchanged without counted re-raises, for a non-maniac and for an unknown player', () => {
    // a maniac who re-raises nearly every time: the read is not widened
    const jammer: Rates = { ...WINNER, threeBet: [15, 0.95] };
    expect(share(band(THREE_BET, jammer, true))).toBeLessThanOrEqual(
      share(band(THREE_BET, jammer, false)) + 1e-9
    );
    // too few counted re-raise opportunities: today's read
    const few: Rates = { ...WINNER, threeBet: [OMAHA_MANIAC_RERAISE_MIN_OPPS - 4, 0.33] };
    expect(band(THREE_BET, few, true)).toEqual(band(THREE_BET, few, false));
    // a Horse-like raiser, and nobody known: today's read
    const quiet: Rates = { hands: 40, vpip: 0.3, pfr: 0.17, rfi: [20, 0.2], threeBet: [15, 0.05] };
    expect(band(THREE_BET, quiet, true)).toEqual(band(THREE_BET, quiet, false));
    expect(band(THREE_BET, null, true)).toEqual(band(THREE_BET, null, false));
    // his open is not a re-raising line
    expect(band([rec(2, 'raise', 2.25)], WINNER, true)).toEqual(
      band([rec(2, 'raise', 2.25)], WINNER, false)
    );
  });
});

// ─── the recorded decisions ─────────────────────────────────────────────────

interface Outcome {
  bytes: string[];
  actions: string[];
  fires: string[][];
}
function playMany(
  ord: number,
  opts: HorseDecideOpts,
  v: { hole?: string; memory?: Rates | null } = {}
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    remember(v.memory === undefined ? WINNER : v.memory);
    drainFires();
    seedFastRandom(s);
    const fx = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
    const node = fx.actions.find((a) => a.ord === ord)!;
    if (v.hole) fx.hole[String(node.seat)] = cards(v.hole);
    const st = stateAt(fx, node);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      ...opts,
    });
    out.bytes.push(
      createHash('sha256')
        .update(
          JSON.stringify(d, (k, x) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : x))
        )
        .digest('hex')
        .slice(0, 16)
    );
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
  }
  return out;
}
const count = (o: Outcome, a: string) => o.actions.filter((x) => x === a).length;
const hasFire = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;

describe('the recorded 4-bet (decision 10) against the measured winner', () => {
  it('today: the weak hand 4-bets in some seeds, through the pressure 4-bet', () => {
    const off = playMany(10, {});
    expect(count(off, 'raise')).toBeGreaterThan(0);
    expect(hasFire(off, 'v53_pressure_four_bet')).toBe(count(off, 'raise'));
    expect(hasFire(off, RECEIPT)).toBe(0);
  });

  it('off: unset, false and a truthy non-boolean decide byte-identically', () => {
    const unset = playMany(10, {});
    for (const opts of [
      { omahaManiacReRaiseWidthMeasured: false },
      { omahaManiacReRaiseWidthMeasured: 1 as unknown as boolean },
    ])
      expect(playMany(10, opts).bytes).toEqual(unset.bytes);
  });

  it('on: the weak hand does not 4-bet, and the receipt fires', () => {
    const on = playMany(10, ON);
    expect(count(on, 'raise')).toBe(0);
    expect(count(on, 'all_in')).toBe(0);
    expect(hasFire(on, RECEIPT)).toBe(SEEDS.length);
  });

  it('audit item 10: the receipt obeys the telemetry gate and fires once per decision', () => {
    enableBrainTelemetry();
    for (const telemetry of [true, false]) {
      for (const s of SEEDS) {
        HorseMind.reset();
        remember(WINNER);
        drainFires();
        seedFastRandom(s);
        const fx = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
        const st = stateAt(fx, fx.actions.find((a) => a.ord === 10)!);
        HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, { ...ON, telemetry });
        const fires = drainFires().find((f) => f.feature === RECEIPT)?.fires ?? 0;
        expect([telemetry, fires]).toEqual([telemetry, telemetry ? 1 : 0]);
      }
    }
  });

  it('a strong hand still 4-bets him with the option on', () => {
    const strong = { hole: 'JhQcQh9c' };
    expect(count(playMany(10, {}, strong), 'raise')).toBe(SEEDS.length);
    expect(count(playMany(10, ON, strong), 'raise')).toBe(SEEDS.length);
  });

  it('the mind off, a player with no memory and one with few counted re-raises: today’s play', () => {
    expect(playMany(10, { ...ON, mind: false }).bytes).toEqual(playMany(10, { mind: false }).bytes);
    expect(playMany(10, ON, { memory: null }).bytes).toEqual(
      playMany(10, {}, { memory: null }).bytes
    );
    const few: Rates = { ...WINNER, threeBet: [OMAHA_MANIAC_RERAISE_MIN_OPPS - 4, 0.33] };
    expect(playMany(10, ON, { memory: few }).bytes).toEqual(
      playMany(10, {}, { memory: few }).bytes
    );
  });
});

describe('the recorded call of the 5-bet (decision 12)', () => {
  it('today calls every seed; on, the weak hand folds in some and never raises; the strong hand still calls', () => {
    const off = playMany(12, {});
    expect(count(off, 'call')).toBe(SEEDS.length);
    const on = playMany(12, ON);
    expect(count(on, 'fold')).toBeGreaterThan(0);
    expect(count(on, 'call') + count(on, 'fold')).toBe(SEEDS.length);
    expect(hasFire(on, RECEIPT)).toBe(SEEDS.length);
    expect(count(playMany(12, ON, { hole: 'JhQcQh9c' }), 'call')).toBe(SEEDS.length);
  });

  it('off: unset and false decide byte-identically', () => {
    expect(playMany(12, { omahaManiacReRaiseWidthMeasured: false }).bytes).toEqual(
      playMany(12, {}).bytes
    );
  });
});
