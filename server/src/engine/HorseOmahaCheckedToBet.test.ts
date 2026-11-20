/**
 * OMAHA CHECKED-TO BET IS PRICED (option omahaCheckedToBetIsPriced, default
 * OFF; WooWoo audit repair programme 2026-11-18, lane CHECKED-TO-BET).
 *
 * The spots are journaled PLO5 cash requests of the audit
 * (HorseOmahaCheckedToBet.fixture.json: seats only, no user or hand ids, no
 * names, the deciding Horse's own cards only): six river decisions heads-up
 * that the audit listed as checked back with air or a weak pair, four river
 * decisions with several opponents, four heads-up turn decisions. In every
 * one the opponents had checked and the Horse checked. Each runs with the
 * option states the engine recorded for that decision.
 *
 * The opponent's read is supplied by the test (the recorded read frame is
 * not in the fixture): a folder calls a river bet 21% of the time (the
 * audit's measured 140 folds of 177), a station 70%, each over 40
 * opportunities.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles } from './HorseComplaintReplay.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import type { SeatPlayer } from '../types.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import {
  omahaCheckedToBet,
  omahaCheckedToBetDecision,
  omahaCheckedToBetScope,
  omahaCheckedToContinueCalibrated,
  omahaCheckedToShowdownCalibrated,
  OMAHA_CHECKED_TO_SHOWDOWN_FIT,
  type OmahaCheckedToRead,
} from './HorseOmahaCheckedToBet.js';
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
const BET = 'omaha_checked_to_bet_priced_bet';
const KEPT = 'omaha_checked_to_bet_priced_check_kept';
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The read the comparison takes, for a player who calls a bet `call` of the time over `n` opportunities. */
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
        };
const FOLDER = 0.21;
const STATION = 0.7;
const verdict = (s: Spot, r: () => OmahaCheckedToRead | null, rake = 0) => {
  const scope = omahaCheckedToBetScope(s.hero, s.gs);
  return scope ? omahaCheckedToBet(s.hero, s.gs, scope, r, rake) : null;
};

/** The same read as the opponent memory answers it to HorseLogic. */
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
function play(s: Spot, call: number | null, option: unknown, change?: (s: Spot) => void): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { plays: [], bytes: [], fires: [] };
  for (const seed of SEEDS) {
    const c = copy(s);
    change?.(c);
    HorseMind.reset();
    drainFires();
    seedFastRandom(seed);
    // The public action time has its own stream: seeded, so that two runs can be compared byte for byte.
    seedHorseTimingRandom(seed);
    const spy = vi
      .spyOn(HorseMind, 'omahaReadConditionalOf')
      .mockImplementation(() => (call === null ? null : conditional(call)));
    const d = HorseLogic.decide(c.hero, c.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      ...recordedOptions(s),
      ...(option === undefined ? {} : { omahaCheckedToBetIsPriced: option }),
    } as never);
    spy.mockRestore();
    out.plays.push(d.action);
    out.bytes.push(JSON.stringify(withoutMeasurements(d)));
    out.fires.push(drainFires().map((f) => f.feature));
  }
  return out;
}
const fired = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('the spot: a river every opponent has checked (v2: the turn is out)', () => {
  it('the recorded spots are in it, except two where a player is all in or has not checked', () => {
    expect(RIVER_HU.map((s) => omahaCheckedToBetScope(s.hero, s.gs)?.opponents.length)).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
    // v2 (REDESIGN-PLAN section 2): the turn is priced as a whole line by the street plan; failing before: 'turn' x4.
    expect(TURN_HU.map((s) => omahaCheckedToBetScope(s.hero, s.gs)?.street ?? null)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(
      RIVER_MW.map((s) => omahaCheckedToBetScope(s.hero, s.gs)?.opponents.length ?? null)
    ).toEqual([null, null, 2, 2]);
  });
  it.each([
    ['PLO6', (s: Spot) => void (s.gs.gameVariant = 'plo6')],
    ['a tournament', (s: Spot) => void (s.gs.gameMode = 'tournament')],
    ['a bomb pot', (s: Spot) => void (s.gs.bombPot = true)],
    ['two boards', (s: Spot) => void (s.gs.boardCount = 2)],
    [
      'Lightning',
      (s: Spot) =>
        void ((s.gs as unknown as { publicMemoryDomain: { speed: string } }).publicMemoryDomain = {
          speed: 'lightning',
        }),
    ],
    [
      'hi-lo',
      (s: Spot) => void (s.gs.variantRules = { ...s.gs.variantRules!, splitLow8OrBetter: true }),
    ],
    ['a bet to call', (s: Spot) => void (s.gs.toCall = 10)],
    ['all-in-or-fold', (s: Spot) => void (s.gs.allInOrFold = true)],
    [
      'an opponent who has not checked',
      (s: Spot) =>
        void (s.gs.actionHistory = s.gs.actionHistory!.filter(
          (a) => !(String(a.stage) === 'river' && a.action === 'check')
        )),
    ],
    [
      'an opponent all in',
      (s: Spot) =>
        s.gs.players.forEach((p) => {
          if (p.seat !== s.hero.seat && !p.is_folded) p.is_all_in = true;
        }),
    ],
    [
      'the flop',
      (s: Spot) => {
        s.gs.stage = 'flop';
        s.gs.communityCards = s.gs.communityCards!.slice(0, 3);
      },
    ],
  ])('%s is outside it', (_name, change) => {
    const s = copy(RIVER_HU[1]);
    expect(omahaCheckedToBetScope(s.hero, s.gs)).not.toBeNull();
    change(s);
    expect(omahaCheckedToBetScope(s.hero, s.gs)).toBeNull();
    expect(
      omahaCheckedToBetDecision(
        { action: 'check', thinkTime: 0 } as never,
        s.hero,
        s.gs,
        read(FOLDER),
        0
      ).priced
    ).toBe(false);
  });
  it('the turn with two opponents is outside it', () => {
    const s = copy(RIVER_MW[2]);
    s.gs.stage = 'turn';
    s.gs.communityCards = s.gs.communityCards!.slice(0, 4);
    s.gs.actionHistory = s.gs.actionHistory!.map((a) =>
      String(a.stage) === 'river' ? { ...a, stage: 'turn' as never } : a
    );
    expect(omahaCheckedToBetScope(s.hero, s.gs)).toBeNull();
  });
  it('a decision that is not a check is returned as given', () => {
    const s = RIVER_HU[1];
    const bet = { action: 'bet', amount: 96, thinkTime: 0 } as never;
    expect(omahaCheckedToBetDecision(bet, s.hero, s.gs, read(FOLDER), 0)).toEqual({
      decision: bet,
      priced: false,
      changed: null,
      bluff: false,
    });
  });
});

describe('the comparison: the fold rate decides, not the hand class', () => {
  // RIVER_HU[1]: 290 in the pot, the hand wins 22% of showdowns against the checking range.
  const s = RIVER_HU[1];
  it('against a player who folds 79% the bluff is worth more than the check by more than its error', () => {
    const v = verdict(s, read(FOLDER))!;
    expect(v.action).toBe('bet');
    expect(v.best!.value).toBe(false);
    expect(v.best!.allFold).toBeGreaterThan(0.7);
    expect(v.best!.ev - v.evCheck).toBeGreaterThan(v.best!.error);
    // EV(check) is the showdown share of the pot.
    expect(v.evCheck).toBeCloseTo(v.showdown * s.gs.pot, -1);
  });
  it('against a calling station (70% calls) the same hand keeps the check: no bet clears its error', () => {
    const v = verdict(s, read(STATION))!;
    expect(v.action).toBe('check');
    for (const row of v.rows) expect(row.ev - v.evCheck).toBeLessThan(row.error);
  });
  it('the edge falls as his call rate rises; at a 50% call rate and with no read the check stands', () => {
    // v2: a called bluff wins 25% of the time in production (FIT-CE.md), so the break-even call rate is above v1's 0.42.
    const edge = (c: number) => {
      const v = verdict(s, read(c))!;
      return v.best!.ev - v.evCheck;
    };
    expect(edge(0.21)).toBeGreaterThan(edge(0.42));
    expect(edge(0.42)).toBeGreaterThan(edge(0.6));
    expect(verdict(s, read(0.5))!.action).toBe('check');
    const none = verdict(s, read(null))!;
    expect(none.action).toBe('check');
    expect(none.source).toBe('prior');
    // With no read he continues at the pot odds: a bet with no equity is worth nothing.
    for (const row of none.rows) expect(row.ev).toBeLessThan(none.evCheck);
  });
  it('no recorded spot bets a hand that is not a value bet into a station, on any street', () => {
    for (const spot of SPOTS) {
      const v = verdict(spot, read(STATION));
      if (v && v.action !== 'check') expect(v.best!.value).toBe(true);
    }
  });
  it('the margin is the error of the read: the same rate from 3 opportunities needs a larger gap than from 40 or 400', () => {
    const e = (n: number) => verdict(s, read(FOLDER, n))!.rows[0].error;
    expect(e(3)).toBeGreaterThan(e(40));
    expect(e(40)).toBeGreaterThan(e(400));
    // RIVER_HU[1] against the station: the best bet is worth a few chips more than the check, inside its error.
    const close = verdict(s, read(STATION))!;
    expect(close.action).toBe('check');
    expect(close.best!.ev).toBeGreaterThan(close.evCheck);
    expect(close.best!.ev - close.evCheck).toBeLessThan(close.best!.error);
  });
  it('the rake is taken from the check and from the bet', () => {
    const free = verdict(s, read(FOLDER), 0)!;
    const raked = verdict(s, read(FOLDER), 0.05)!;
    expect(raked.evCheck).toBeCloseTo(free.evCheck * 0.95, 0);
    expect(raked.rows[0].ev).toBeLessThan(free.rows[0].ev);
  });
  it('several opponents: everyone folds with the product of their fold rates; a station shrinks the edge and two keep the check', () => {
    const mw = RIVER_MW[3];
    const scope = omahaCheckedToBetScope(mw.hero, mw.gs)!;
    const [a, b] = scope.opponents.map((p) => p.seat);
    const both = omahaCheckedToBet(mw.hero, mw.gs, scope, read(FOLDER), 0)!;
    expect(both.action).toBe('bet');
    const one = (seat: number) => {
      const only = copy(mw);
      only.gs.players.forEach((p) => {
        if (p.seat !== mw.hero.seat && p.seat !== seat) p.is_folded = true;
      });
      const sc = omahaCheckedToBetScope(only.hero, only.gs)!;
      return omahaCheckedToBet(only.hero, only.gs, sc, read(FOLDER), 0)!.rows.find(
        (r) => r.amount === both.best!.amount
      )!.allFold;
    };
    expect(both.best!.allFold).toBeCloseTo(one(a) * one(b), 1);
    const mixed = omahaCheckedToBet(
      mw.hero,
      mw.gs,
      scope,
      (seat) => read(seat === a ? FOLDER : STATION)(),
      0
    )!;
    expect(mixed.best!.allFold).toBeLessThan(both.best!.allFold);
    expect(mixed.best!.ev - mixed.evCheck).toBeLessThan(both.best!.ev - both.evCheck);
    expect(omahaCheckedToBet(mw.hero, mw.gs, scope, read(STATION), 0)!.action).toBe('check');
  });
  it('v2: the heads-up turn is not priced (failing before: the folder was bet into)', () => {
    for (const t of TURN_HU) {
      expect(verdict(t, read(FOLDER))).toBeNull();
      expect(
        omahaCheckedToBetDecision(
          { action: 'check', thinkTime: 0 } as never,
          t.hero,
          t.gs,
          read(FOLDER),
          0
        ).priced
      ).toBe(false);
    }
  });
  it('the same cards and state give the same numbers', () => {
    expect(verdict(s, read(FOLDER))).toEqual(verdict(s, read(FOLDER)));
  });
});

describe('through HorseLogic.decide with the recorded option states', () => {
  it('the option unset, false or a truthy non-boolean: the decision is byte for byte the same and no receipt fires', () => {
    for (const s of SPOTS)
      for (const call of [FOLDER, STATION]) {
        const unset = play(s, call, undefined);
        for (const value of [false, 'on', 1]) {
          const other = play(s, call, value);
          expect(other.bytes).toEqual(unset.bytes);
          expect(fired(other, BET) + fired(other, KEPT)).toBe(0);
        }
        expect(fired(unset, BET) + fired(unset, KEPT)).toBe(0);
      }
  });
  it('river, heads-up, a folder: recorded checks with a hand that loses the showdown become bets (failing before: all check)', () => {
    // RIVER_HU[1] and [3]; the other four are bet by today's brain under this read, or the gap is inside the error.
    for (const s of [RIVER_HU[1], RIVER_HU[3]]) {
      expect(s.recorded).toBe('check');
      const off = play(s, FOLDER, undefined);
      const on = play(s, FOLDER, true);
      expect(off.plays).toEqual(['check', 'check', 'check']);
      expect(on.plays).toEqual(['bet', 'bet', 'bet']);
      expect(fired(on, BET)).toBe(3);
    }
    const close = play(RIVER_HU[1], STATION, true);
    expect(close.plays).toEqual(['check', 'check', 'check']);
    expect(fired(close, KEPT)).toBe(3);
  });
  it('river, several opponents, folders: the recorded checks become bets', () => {
    for (const s of [RIVER_MW[2], RIVER_MW[3]]) {
      expect(play(s, FOLDER, undefined).plays).toEqual(['check', 'check', 'check']);
      expect(play(s, FOLDER, true).plays).toEqual(['bet', 'bet', 'bet']);
    }
  });
  it('a station: every bet the option adds is a value bet (v2: a hand that wins against his calling range is bet into him)', () => {
    for (const s of SPOTS) {
      const off = play(s, STATION, undefined);
      const on = play(s, STATION, true);
      if (on.plays.join() === off.plays.join()) continue;
      const v = verdict(s, read(STATION))!;
      expect(v.action).not.toBe('check');
      expect(v.best!.value).toBe(true);
    }
    // the hand of the folder spot keeps its check against the station
    expect(play(RIVER_HU[1], STATION, true).plays).toEqual(['check', 'check', 'check']);
  });
  it('no read at all (the opponent memory off): the option adds no bet', () => {
    for (const s of SPOTS) {
      const off = play(s, null, undefined);
      const on = play(s, null, true);
      expect(on.plays).toEqual(off.plays);
    }
  });
  it('v2: the heads-up turn is byte for byte the option off and no receipt fires (failing before: the bet receipt fired)', () => {
    for (const s of TURN_HU) {
      const off = play(s, FOLDER, undefined);
      const on = play(s, FOLDER, true);
      expect(on.bytes).toEqual(off.bytes);
      expect(fired(on, BET) + fired(on, KEPT)).toBe(0);
    }
  });
  it.each([
    ['PLO6', (s: Spot) => void (s.gs.gameVariant = 'plo6')],
    ['a tournament', (s: Spot) => void (s.gs.gameMode = 'tournament')],
    ['a bomb pot', (s: Spot) => void (s.gs.bombPot = true)],
    [
      'Lightning',
      (s: Spot) =>
        void ((s.gs as unknown as { publicMemoryDomain: { speed: string } }).publicMemoryDomain = {
          speed: 'lightning',
        }),
    ],
  ])('%s: on is byte for byte the option off', (_name, change) => {
    for (const s of [RIVER_HU[1], RIVER_HU[3], RIVER_MW[3], TURN_HU[2]]) {
      const off = play(s, FOLDER, undefined, change);
      const on = play(s, FOLDER, true, change);
      expect(on.bytes).toEqual(off.bytes);
      expect(fired(on, BET) + fired(on, KEPT)).toBe(0);
    }
  });
});

describe('v2: the showdown share and the continue equity are the fitted calibrations, not the raw model', () => {
  it('the map is increasing, keeps the order of hands, and pulls the model toward the results it was fitted on', () => {
    const at = (m: number) => omahaCheckedToShowdownCalibrated(m, 'person', 400).share;
    expect(at(0.02)).toBeLessThan(at(0.5));
    expect(at(0.5)).toBeLessThan(at(0.98));
    // FIT-TABLE.md (persons): model 0.0-0.1 won 0.246 of 112 spots, 0.9-1.0 won 0.861 of 194.
    expect(at(0.023)).toBeGreaterThan(0.15);
    expect(at(0.023)).toBeLessThan(0.3);
    expect(at(0.984)).toBeGreaterThan(0.78);
    expect(at(0.984)).toBeLessThan(0.9);
    // called bets (FIT-CE.md): model 0.0-0.2 won 0.250 of 76, 0.8-1.0 won 0.833 of 54.
    const ce = (m: number) => omahaCheckedToContinueCalibrated(m, 400).share;
    expect(ce(0.004)).toBeGreaterThan(0.15);
    expect(ce(0.004)).toBeLessThan(0.3);
    expect(ce(0.977)).toBeGreaterThan(0.7);
  });
  it('the kind picks the fit; an unknown kind takes the pooled fit; the error shrinks with the sample', () => {
    expect(omahaCheckedToShowdownCalibrated(0.5, 'horse', 400).share).toBeLessThan(
      omahaCheckedToShowdownCalibrated(0.5, 'person', 400).share
    );
    const f = OMAHA_CHECKED_TO_SHOWDOWN_FIT.pooled;
    expect(omahaCheckedToShowdownCalibrated(0.5, null, 400).share).toBeCloseTo(
      1 / (1 + Math.exp(-f.a)),
      6
    );
    expect(omahaCheckedToShowdownCalibrated(0.3, 'person', 10).variance).toBeGreaterThan(
      omahaCheckedToShowdownCalibrated(0.3, 'person', 1000).variance
    );
  });
  it('EV(check) is the calibrated share of the pot (failing before: the raw model share)', () => {
    const s = RIVER_HU[1];
    const v = verdict(s, read(FOLDER))!;
    expect(v.evCheck).toBeCloseTo(v.showdown * s.gs.pot, -1);
    expect(v.showdown).toBeGreaterThan(0.15);
  });
});
