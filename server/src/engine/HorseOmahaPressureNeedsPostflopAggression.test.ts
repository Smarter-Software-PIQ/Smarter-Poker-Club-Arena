/**
 * OMAHA: THE PRESSURE PLAY NEEDS POSTFLOP AGGRESSION (lane owner 2026-11-15,
 * hand 59526261; option omahaPressureNeedsPostflopAggression, default OFF).
 *
 * The recorded hand, anonymised to seat numbers: a Horse with top set bets
 * the 2-A-5 flop five-way, calls a raise, checks the 3 on the turn (any four
 * makes a straight) and check-raises the pot into the made straight. The
 * raise is the V53 pressure play: the bettor is read as aggressive (wide
 * before the flop, or presumed), so the value-raise bar drops by 0.10 and the
 * raise frequency rises to 0.90.
 *
 *  - unset, false and a truthy non-boolean decide byte-identically;
 *  - on, a bettor whose postflop betting is not measured high (a measured
 *    value leader, an unmeasured or presumed read) gets no pressure play: the
 *    recorded turn raise is a call at every seed, and the flop raise over his
 *    raise goes back to today's no-read decision;
 *  - on, against a measured postflop aggressor the pressure play still fires
 *    (the flop decision is today's, byte for byte);
 *  - on, the turn value raise with a hand a possible straight already beats
 *    is a call whatever the read; a nut-class hand still raises.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import { omahaBeatenByBoard } from './HorseOmahaMadeHandDefense.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  recordedPathMatches,
  replayProfiles,
  stateAt,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import FIXTURE from './horseComplaints/plo5-top-set-check-raises-pot-on-the-four-straight-turn.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));

const FLOP_FACING_RAISE = 17;
const TURN_FACING_BET = 20;
const HERO = 6;
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [...FX.seeds, 101, 102, 103, 104, 105, 106];
const ON: HorseDecideOpts = { omahaPressureNeedsPostflopAggression: true };

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

type Node = ReturnType<typeof stateAt>;
function nodeAt(ord: number, hole?: string): Node {
  const f = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
  if (hole) f.hole[String(HERO)] = cards(hole);
  return stateAt(f, f.actions.find((a) => a.ord === ord)!);
}
const decisionBytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));
interface Outcome {
  bytes: string[];
  actions: string[];
  fires: string[][];
  next: number[];
}
type Reads = (userId: string) => OmahaReadConditional | null;
/**
 * The mind is on with an empty memory, so the bettor's ordinary read is the
 * PLO presumption (aggressive before the flop); `reads` supplies his
 * postflop read-conditional read.
 */
function play(build: () => Node, opts: HorseDecideOpts, reads?: Reads): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [], next: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    if (reads) vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(reads as never);
    drainFires();
    seedFastRandom(s);
    const st = build();
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      ...opts,
    } as never);
    out.next.push(fastRandom());
    out.bytes.push(decisionBytes(d));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
    vi.restoreAllMocks();
  }
  return out;
}
const base = { measured: true, tightReRaiser: false } as OmahaReadConditional;
/** wide before the flop, value-heavy after it */
const valueLeader = {
  ...base,
  valueLeader: true,
  postflopAggressor: false,
} as OmahaReadConditional;
/** his own postflop betting measured high */
const postflopAggressor = {
  ...base,
  valueLeader: false,
  postflopAggressor: true,
} as OmahaReadConditional;
const unmeasured = {
  ...base,
  measured: false,
  valueLeader: false,
  postflopAggressor: false,
} as OmahaReadConditional;
const RAISES = ['raise', 'all_in'];
const raises = (o: Outcome) => o.actions.filter((a) => RAISES.includes(a)).length;
const hasFire = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
const only = (o: Outcome) => [...new Set(o.actions)].sort();

describe('hand 59526261, the recorded hand', () => {
  it('the fixture is the recorded hand, and today the turn raise is the V53 pressure play', () => {
    expect(FX.handId).toBe('84bc4697-7e0e-41ad-b1e1-fe8633b91721');
    expect(recordedPathMatches(FX)).toBe(true);
    expect(JSON.stringify(FX)).not.toMatch(/userId|username/);
    const st = nodeAt(TURN_FACING_BET);
    expect(omahaBeatenByBoard(st.hero.cards, st.gs.communityCards ?? [])).toBe(true);
    const off = play(
      () => nodeAt(TURN_FACING_BET),
      {},
      () => valueLeader
    );
    expect(raises(off)).toBeGreaterThan(8);
    expect(hasFire(off, 'v53_pressure_value_raise')).toBe(raises(off));
  });
});

describe('omahaPressureNeedsPostflopAggression', () => {
  it('off: unset, false and a truthy non-boolean decide byte-identically', () => {
    for (const ord of [FLOP_FACING_RAISE, TURN_FACING_BET]) {
      const unset = play(
        () => nodeAt(ord),
        {},
        () => valueLeader
      );
      for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean])
        expect(
          play(
            () => nodeAt(ord),
            { omahaPressureNeedsPostflopAggression: v },
            () => valueLeader
          ).bytes
        ).toEqual(unset.bytes);
    }
  });

  it('on, the recorded turn: against a preflop-wide, postflop value-heavy bettor the raise is a call at every seed', () => {
    for (const reads of [() => valueLeader, () => unmeasured, () => null]) {
      const on = play(() => nodeAt(TURN_FACING_BET), ON, reads as Reads);
      expect(only(on)).toEqual(['call']);
      expect(hasFire(on, 'omaha_pressure_withheld_value_leader')).toBe(SEEDS.length);
      expect(hasFire(on, 'v53_pressure_value_raise')).toBe(0);
    }
  });

  it('on, the flop raise over his raise: no pressure play against the value leader, today’s play against a measured postflop aggressor', () => {
    const build = () => nodeAt(FLOP_FACING_RAISE);
    const off = play(build, {}, () => postflopAggressor);
    expect(hasFire(off, 'v53_pressure_value_raise')).toBeGreaterThan(8);
    // measured postflop aggression: the pressure play still fires, byte for byte
    const aggro = play(build, ON, () => postflopAggressor);
    expect(aggro.bytes).toEqual(off.bytes);
    expect(hasFire(aggro, 'omaha_pressure_withheld_value_leader')).toBe(0);
    // value leader: withheld
    const value = play(build, ON, () => valueLeader);
    expect(hasFire(value, 'omaha_pressure_withheld_value_leader')).toBe(SEEDS.length);
    expect(hasFire(value, 'v53_pressure_value_raise')).toBe(0);
    expect(raises(value)).toBeLessThan(raises(off));
    expect(value.actions.filter((a) => a === 'fold')).toEqual([]);
  });

  it('on, the turn: a hand a possible straight already beats does not value-raise even against a postflop aggressor; the nut straight still raises', () => {
    const beaten = play(
      () => nodeAt(TURN_FACING_BET),
      ON,
      () => postflopAggressor
    );
    expect(only(beaten)).toEqual(['call']);
    expect(hasFire(beaten, 'omaha_value_raise_beaten_by_board_flatted')).toBeGreaterThan(8);
    expect(hasFire(beaten, 'omaha_pressure_withheld_value_leader')).toBe(0);
    // 4-6 is the nut straight on A-2-3-5
    const nuts = () => nodeAt(TURN_FACING_BET, 'Ac4d6cKc7s');
    const st = nuts();
    expect(omahaBeatenByBoard(st.hero.cards, st.gs.communityCards ?? [])).toBe(false);
    const off = play(nuts, {}, () => postflopAggressor);
    expect(raises(off)).toBeGreaterThan(0);
    const on = play(nuts, ON, () => postflopAggressor);
    expect(on.bytes).toEqual(off.bytes);
    expect(raises(play(nuts, ON, () => valueLeader))).toBeGreaterThan(0);
  });

  it('on: the mind off, PLO6 and a tournament are today’s play', () => {
    const build = () => nodeAt(TURN_FACING_BET);
    expect(play(build, { ...ON, mind: false }).bytes).toEqual(play(build, { mind: false }).bytes);
    for (const over of [{ gameMode: 'tournament' }]) {
      const b = () => {
        const st = build();
        Object.assign(st.gs, over);
        return st;
      };
      expect(
        hasFire(
          play(b, ON, () => valueLeader),
          'omaha_pressure_withheld_value_leader'
        )
      ).toBe(0);
      expect(
        hasFire(
          play(b, ON, () => valueLeader),
          'omaha_value_raise_beaten_by_board_flatted'
        )
      ).toBe(0);
    }
  });

  it('the call is admitted by the worker receipt validator', () => {
    for (const s of SEEDS) {
      HorseMind.reset();
      vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(
        (() => valueLeader) as never
      );
      seedFastRandom(s);
      const st = nodeAt(TURN_FACING_BET);
      const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, ON));
      vi.restoreAllMocks();
      expect(d.action).toBe('call');
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
    }
  });
});
