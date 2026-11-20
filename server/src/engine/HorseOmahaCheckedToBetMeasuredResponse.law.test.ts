/**
 * omahaCheckedToBetResponseIsMeasured (default OFF; EMERG lane OPEN-ITEMS-3,
 * 2026-11-20). Law: inside omahaCheckedToBetIsPriced, heads-up on the river
 * after the one opponent has checked, the share of his range that continues
 * against each bet size is the measured answer to a river bet (his kind's
 * curve, moved in log-odds by how far his own measured rate sits from the
 * population mean of the same statistic) in place of the pot odds scaled by
 * his all-street rate. Without the parent option it
 * does nothing; several opponents, the turn and PLO6 are priced and played
 * exactly as before; a station still keeps the check with a hand that cannot
 * win when called.
 *
 * The spots are the journaled PLO5 cash requests of
 * HorseOmahaCheckedToBet.fixture.json (seats only, the deciding Horse's own
 * cards only; no user or hand ids).
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles } from './HorseComplaintReplay.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import type { Card, SeatPlayer } from '../types.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import type { OmahaCardImpactRead } from './HorseOmahaCardImpact.js';
import {
  omahaCheckedToBet,
  omahaCheckedToBetScope,
  omahaCheckedToMeasuredResponse,
  omahaCheckedToPooledRiverPoints,
  type OmahaCheckedToRead,
} from './HorseOmahaCheckedToBet.js';
import { OMAHA_SMALL_BET_RESPONSE } from './HorseOmahaSmallBetConstants.js';
import RECORDED from './HorseOmahaCheckedToBet.fixture.json';

interface Spot {
  set: string;
  hero: SeatPlayer;
  gs: HorseGameStateV2;
  options: Record<string, string>;
  recorded: string;
}
const SPOTS = (RECORDED as unknown as { spots: Spot[] }).spots;
const RIVER_HU = SPOTS.filter((s) => s.set === 'river_hu_checkback_air_weak');
const RIVER_MW = SPOTS.filter((s) => s.set === 'river_mw_checkback_last');
const TURN_HU = SPOTS.filter((s) => s.set === 'turn_hu_checkback');
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2, 3];
const MEASURED = 'omaha_checked_to_bet_measured_response';
const BET = 'omaha_checked_to_bet_priced_bet';
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const read =
  (call: number | null, n = 40) =>
  (): OmahaCheckedToRead | null =>
    call === null
      ? null
      : {
          read: {
            source: 'pooled',
            foldToBet: 1 - call,
            betCheckedTo: 0.4,
            betRatio: null,
            riverCall: call,
            foldToRaise: null,
            opportunities: n,
          },
          riverOpportunities: n,
          // the population means his own rates are read beside
          population: POPULATION,
        };
const POPULATION = { continueRate: 0.5, riverCall: 0.35 };
const STATION = 0.7;
const verdict = (s: Spot, r: () => OmahaCheckedToRead | null, measured: boolean) => {
  const scope = omahaCheckedToBetScope(s.hero, s.gs);
  return scope ? omahaCheckedToBet(s.hero, s.gs, scope, r, 0, measured) : null;
};
const stat = (mean: number, n: number) => ({ mean, n, engaged: null, excess: 0 });
const conditional = (call: number, n = 40): OmahaReadConditional =>
  ({
    hands: 80,
    measured: true,
    tightReRaiser: false,
    wideReRaiser: false,
    valueLeader: false,
    postflopAggressor: false,
    threeBet: stat(0.07, 40),
    betCheckedTo: stat(0.4, 60),
    foldToBet: stat(1 - call, n),
    riverCall: stat(call, n),
  }) as OmahaReadConditional;
const recordedOptions = (s: Spot): HorseDecideOpts => {
  const o: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(s.options)) if (v === 'on' || v === 'off') o[k] = v === 'on';
  return o as HorseDecideOpts;
};
interface Outcome {
  plays: string[];
  bytes: string[];
  fires: string[][];
}
function play(
  s: Spot,
  call: number | null,
  options: Record<string, unknown>,
  change?: (s: Spot) => void
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { plays: [], bytes: [], fires: [] };
  for (const seed of SEEDS) {
    const c = copy(s);
    change?.(c);
    HorseMind.reset();
    drainFires();
    seedFastRandom(seed);
    seedHorseTimingRandom(seed);
    const spy = vi
      .spyOn(HorseMind, 'omahaReadConditionalOf')
      .mockImplementation(() => (call === null ? null : conditional(call)));
    const d = HorseLogic.decide(c.hero, c.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      ...recordedOptions(s),
      ...options,
    } as never);
    spy.mockRestore();
    out.plays.push(d.action);
    out.bytes.push(JSON.stringify(withoutMeasurements(d)));
    out.fires.push(drainFires().map((f) => f.feature));
  }
  return out;
}
const fired = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
const PARENT = { omahaCheckedToBetIsPriced: true };
const BOTH = { omahaCheckedToBetIsPriced: true, omahaCheckedToBetResponseIsMeasured: true };
const NO_READ: OmahaCardImpactRead = {
  measured: false,
  continueRate: null,
  riverCallRate: null,
  betCheckedTo: 0.45,
  bluffShare: 0.3,
};

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('the measured answer to a river bet (omahaCheckedToMeasuredResponse)', () => {
  it('no personal read: ONE measured curve for every opponent (person and Horse cells pooled by their counts)', () => {
    for (const variant of ['plo4', 'plo5']) {
      const person = OMAHA_SMALL_BET_RESPONSE[`${variant}|river|person`];
      const horse = OMAHA_SMALL_BET_RESPONSE[`${variant}|river|horse`];
      const points = omahaCheckedToPooledRiverPoints(variant)!;
      const m = omahaCheckedToMeasuredResponse(variant, NO_READ)!;
      expect(m.personal).toBe(false);
      // every hand continues against a bet of nothing; then the pooled points, unchanged
      expect(m.curve[0]).toMatchObject({ share: 0, cont: 1 });
      expect(m.curve.slice(1).map((p) => p.share)).toEqual(points.map((p) => p.share));
      m.curve.slice(1).forEach((p, i) => {
        expect(p.cont).toBeCloseTo(points[i].cont, 12);
        expect(p.raise).toBeCloseTo(points[i].raise, 12);
      });
      // each pooled point lies between the two measured cells of its size and carries both counts
      for (const p of points) {
        const cells = [...person, ...horse].filter((c) => c.share === p.share);
        expect(cells.length).toBeGreaterThan(0);
        expect(p.n).toBe(cells.reduce((sum, c) => sum + c.n, 0));
        expect(p.cont).toBeGreaterThanOrEqual(Math.min(...cells.map((c) => c.cont)) - 1e-12);
        expect(p.cont).toBeLessThanOrEqual(Math.max(...cells.map((c) => c.cont)) + 1e-12);
      }
      const last = points[points.length - 1];
      expect(m.at(last.share).n).toBe(last.n);
      expect(m.at(last.share).cont).toBeCloseTo(last.cont, 12);
      // a bigger bet is continued less often
      expect(m.at(1).cont).toBeLessThan(m.at(0.3).cont);
    }
    // PLO5 pot-sized bet: (142 x 0.1501 + 78 x 0.2152) / 220
    const pot = omahaCheckedToMeasuredResponse('plo5', NO_READ)!.at(1);
    expect(pot.n).toBe(220);
    expect(pot.cont).toBeCloseTo((142 * 0.1501 + 78 * 0.2152) / 220, 12);
  });
  it('the answer does not depend on who the opponent is: the function takes no opponent kind', () => {
    expect(omahaCheckedToMeasuredResponse.length).toBeLessThanOrEqual(3);
    const src = readFileSync(new URL('./HorseOmahaCheckedToBet.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export function omahaCheckedToMeasuredResponse('));
    expect(body.slice(0, body.indexOf('\ninterface Leg'))).not.toMatch(
      /is_horse|opponentIsHorse|KindOf/
    );
  });
  it('his own evidence moves the pooled curve by its distance from the population, at every size alike', () => {
    const kind = omahaCheckedToMeasuredResponse('plo5', NO_READ)!;
    const withRate = (riverCallRate: number | null, continueRate: number | null = 0.5) =>
      omahaCheckedToMeasuredResponse(
        'plo5',
        { ...NO_READ, measured: true, continueRate, riverCallRate },
        POPULATION
      )!;
    // a rate equal to the population's: exactly the pooled curve
    const average = withRate(POPULATION.riverCall);
    expect(average.personal).toBe(false);
    for (const share of [0.3, 0.5, 0.66, 1])
      expect(average.at(share).cont).toBeCloseTo(kind.at(share).cont, 9);
    // a station continues more and a folder less, at every size
    const station = withRate(0.7);
    const folder = withRate(0.15);
    expect(station.personal).toBe(true);
    expect(station.own).toBe(0.7);
    for (const share of [0.3, 0.5, 0.66, 1]) {
      expect(station.at(share).cont).toBeGreaterThan(kind.at(share).cont + 0.05);
      expect(folder.at(share).cont).toBeLessThan(kind.at(share).cont);
      // the raise share stays the measured share of the hands that continue
      const k = kind.curve[kind.curve.length - 1];
      const top = station.curve[station.curve.length - 1];
      expect(top.raise / top.cont).toBeCloseTo(k.raise / k.cont, 9);
    }
    // the shift is the same in log-odds at every size
    const lo = (p: number) => Math.log(p / (1 - p));
    const d = (share: number) => lo(station.at(share).cont) - lo(kind.at(share).cont);
    expect(d(1)).toBeCloseTo(d(0.42), 6);
    expect(d(1)).toBeCloseTo(lo(0.7) - lo(POPULATION.riverCall), 6);
    // no river rate: his continue rate beside the population's continue rate
    const byFold = withRate(null, 0.7);
    expect(d(1)).not.toBeCloseTo(lo(byFold.at(1).cont) - lo(kind.at(1).cont), 3);
    expect(lo(byFold.at(1).cont) - lo(kind.at(1).cont)).toBeCloseTo(
      lo(0.7) - lo(POPULATION.continueRate),
      6
    );
  });
  it('evidence with no population figure to read it beside: no measured answer (the model prices him as before)', () => {
    const own: OmahaCardImpactRead = {
      ...NO_READ,
      measured: true,
      continueRate: 0.4,
      riverCallRate: 0.3,
    };
    expect(omahaCheckedToMeasuredResponse('plo5', own)).toBeNull();
    expect(omahaCheckedToMeasuredResponse('plo5', own, null)).toBeNull();
    expect(
      omahaCheckedToMeasuredResponse('plo5', own, { continueRate: null, riverCall: null })
    ).toBeNull();
  });
  it('PLO6 and every variant without a measured curve: no answer (the comparison is the model as before)', () => {
    for (const variant of ['plo6', 'plo8', 'nlh', ''])
      expect(omahaCheckedToMeasuredResponse(variant, NO_READ)).toBeNull();
  });
});

describe('the comparison heads-up on the river', () => {
  it('no personal read: without the option no recorded check-back clears its error; with it the bet is priced on the measured answer and is worth more than the check by more than its error', () => {
    expect(RIVER_HU.length).toBe(6);
    for (const s of RIVER_HU) {
      const off = verdict(s, read(null), false)!;
      expect(off.action).toBe('check');
      expect(off.measured).toBeUndefined();
      const on = verdict(s, read(null), true)!;
      expect(on.measured).toBe('kind');
      expect(on.action).not.toBe('check');
      expect(on.best!.ev - on.evCheck).toBeGreaterThan(on.best!.error);
      // the check is priced exactly as before: only the answer to a bet changed
      expect(on.evCheck).toBe(off.evCheck);
      expect(on.showdown).toBe(off.showdown);
      // the error of a measured cell is smaller than the error of a rate nobody measured
      expect(on.best!.error).toBeLessThan(off.best!.error);
    }
  });
  it('a measured station keeps the check with the hand that cannot win when called; a measured folder is bet into', () => {
    // RIVER_HU[1]: the hand wins 22% of showdowns against the checking range.
    const v = verdict(RIVER_HU[1], read(STATION), true)!;
    expect(v.measured).toBe('personal');
    expect(v.action).toBe('check');
    for (const row of v.rows) expect(row.ev - v.evCheck).toBeLessThan(row.error);
    const f = verdict(RIVER_HU[1], read(0.21), true)!;
    expect(f.measured).toBe('personal');
    expect(f.action).not.toBe('check');
    expect(f.best!.value).toBe(false);
  });
  it('the default (the flag absent or false) is the comparison as it was', () => {
    for (const s of [...RIVER_HU, ...RIVER_MW])
      for (const call of [null, 0.21, STATION]) {
        const scope = omahaCheckedToBetScope(s.hero, s.gs);
        if (!scope) continue;
        const before = omahaCheckedToBet(s.hero, s.gs, scope, read(call), 0);
        expect(omahaCheckedToBet(s.hero, s.gs, scope, read(call), 0, false)).toEqual(before);
      }
  });
  it('several opponents are priced exactly as before', () => {
    let priced = 0;
    for (const s of RIVER_MW)
      for (const call of [null, 0.21, STATION]) {
        const off = verdict(s, read(call), false);
        const on = verdict(s, read(call), true);
        expect(on).toEqual(off);
        if (on) priced++;
      }
    expect(priced).toBeGreaterThan(0);
  });
});

describe('through HorseLogic.decide', () => {
  it('without omahaCheckedToBetIsPriced the option does nothing: byte for byte the same, no receipt', () => {
    for (const s of SPOTS)
      for (const call of [null, STATION]) {
        const unset = play(s, call, {});
        const alone = play(s, call, { omahaCheckedToBetResponseIsMeasured: true });
        expect(alone.bytes).toEqual(unset.bytes);
        expect(fired(alone, MEASURED)).toBe(0);
      }
  });
  it('the option unset, false or a truthy non-boolean is the parent alone, byte for byte', () => {
    for (const s of SPOTS)
      for (const call of [null, STATION]) {
        const parent = play(s, call, PARENT);
        for (const value of [false, 'on', 1]) {
          const other = play(s, call, { ...PARENT, omahaCheckedToBetResponseIsMeasured: value });
          expect(other.bytes).toEqual(parent.bytes);
          expect(fired(other, MEASURED)).toBe(0);
        }
      }
  });
  it('heads-up river, no read at all: the parent alone adds no bet; with the option recorded check-backs become bets and the receipt names the measured answer', () => {
    let became = 0;
    for (const s of RIVER_HU) {
      const base = play(s, null, {});
      const parent = play(s, null, PARENT);
      expect(parent.plays).toEqual(base.plays);
      const both = play(s, null, BOTH);
      expect(fired(both, MEASURED)).toBe(
        both.fires.filter(
          (f) => f.includes(BET) || f.includes('omaha_checked_to_bet_priced_check_kept')
        ).length
      );
      for (let i = 0; i < SEEDS.length; i++)
        if (base.plays[i] === 'check' && both.plays[i] !== 'check') {
          expect(both.fires[i]).toContain(BET);
          expect(both.fires[i]).toContain(MEASURED);
          became++;
        }
    }
    // at least one recorded spot on every seed (the others are already bet by the brain under no read, or a later
    // owner of the wager node still judges the bet)
    expect(became).toBeGreaterThanOrEqual(3);
  });
  it('several opponents and the heads-up turn: byte for byte the parent alone', () => {
    for (const s of [...RIVER_MW, ...TURN_HU])
      for (const call of [null, 0.21, STATION]) {
        const parent = play(s, call, PARENT);
        const both = play(s, call, BOTH);
        expect(both.bytes).toEqual(parent.bytes);
        expect(fired(both, MEASURED)).toBe(0);
      }
  });
  it('PLO6 is byte-identical with the option on (owner 2026-11-19 8:27 PM Chicago: PLO6 is not touched)', () => {
    const sixth = (s: Spot): void => {
      const used = new Set(
        [...s.hero.cards, ...(s.gs.communityCards ?? [])].map((c) => `${c.rank}${c.suit}`)
      );
      const extra = (['2', '3', '4', '5', '6', '7'] as const)
        .flatMap((rank) => (['clubs', 'diamonds'] as const).map((suit) => ({ rank, suit }) as Card))
        .find((c) => !used.has(`${c.rank}${c.suit}`))!;
      s.hero.cards = [...s.hero.cards, extra];
      for (const p of s.gs.players ?? []) if (p.seat === s.hero.seat) p.cards = s.hero.cards;
      s.gs.gameVariant = 'plo6';
    };
    for (const s of RIVER_HU)
      for (const call of [null, 0.21]) {
        const off = play(s, call, {}, sixth);
        const parent = play(s, call, PARENT, sixth);
        const both = play(s, call, BOTH, sixth);
        expect(off.plays.every((a) => typeof a === 'string' && a.length > 0)).toBe(true);
        expect(parent.bytes).toEqual(off.bytes);
        expect(both.bytes).toEqual(off.bytes);
        expect(fired(both, MEASURED)).toBe(0);
      }
  });
});

describe('the read of the option in source', () => {
  it('HorseLogic reads it opt-in (`=== true`) and hands it only to the checked-to rule', () => {
    const src = readFileSync('src/engine/HorseLogic.ts', 'utf8');
    const reads = src.match(/opts\??\.omahaCheckedToBetResponseIsMeasured[^\n;,)]*/g) ?? [];
    expect(reads).toEqual(['opts.omahaCheckedToBetResponseIsMeasured === true']);
  });
});
