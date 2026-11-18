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

describe('the spot: a river or a heads-up turn every opponent has checked', () => {
  it('the recorded spots are in it, except two where a player is all in or has not checked', () => {
    expect(RIVER_HU.map((s) => omahaCheckedToBetScope(s.hero, s.gs)?.opponents.length)).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
    expect(TURN_HU.map((s) => omahaCheckedToBetScope(s.hero, s.gs)?.street)).toEqual([
      'turn',
      'turn',
      'turn',
      'turn',
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
  it('against a calling station (70% calls) the same hand keeps the check: every bet is worth less than the check', () => {
    const v = verdict(s, read(STATION))!;
    expect(v.action).toBe('check');
    for (const row of v.rows) expect(row.ev).toBeLessThan(v.evCheck);
  });
  it('against a player at the break-even call rate and one with no read the check stands', () => {
    expect(verdict(s, read(0.42))!.action).toBe('check');
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
    // RIVER_HU[2]: the bluff is worth 24 more than the check and the error is 74: the check stands.
    const close = verdict(RIVER_HU[2], read(FOLDER))!;
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
  it('several opponents: everyone folds with the product of their fold rates, and one station keeps the check', () => {
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
    expect(mixed.action).toBe('check');
  });
  it('the heads-up turn: the check is worth what the hand realizes when he may bet the river, and the fold rate decides', () => {
    const t = TURN_HU[2];
    expect(verdict(t, read(FOLDER))!.action).toBe('bet');
    expect(verdict(t, read(STATION))!.action).toBe('check');
    expect(verdict(t, read(null))!.action).toBe('check');
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
    const close = play(RIVER_HU[2], FOLDER, true);
    expect(close.plays).toEqual(['check', 'check', 'check']);
    expect(fired(close, KEPT)).toBe(3);
  });
  it('river, several opponents, folders: the recorded checks become bets', () => {
    for (const s of [RIVER_MW[2], RIVER_MW[3]]) {
      expect(play(s, FOLDER, undefined).plays).toEqual(['check', 'check', 'check']);
      expect(play(s, FOLDER, true).plays).toEqual(['bet', 'bet', 'bet']);
    }
  });
  it('a station: the option adds no bet anywhere (what it decides is what the option off decides)', () => {
    for (const s of SPOTS) {
      const off = play(s, STATION, undefined);
      const on = play(s, STATION, true);
      expect(on.plays).toEqual(off.plays);
      expect(fired(on, BET)).toBe(0);
    }
  });
  it('no read at all (the opponent memory off): the option adds no bet', () => {
    for (const s of SPOTS) {
      const off = play(s, null, undefined);
      const on = play(s, null, true);
      expect(on.plays).toEqual(off.plays);
    }
  });
  it('the heads-up turn: the bet is proposed and the rules that outrank the pricing rules still check it', () => {
    for (const s of TURN_HU) {
      const on = play(s, FOLDER, true);
      expect(fired(on, BET)).toBe(3);
      expect(fired(on, 'omaha_owner_ruled_check_kept')).toBe(3);
      expect(on.plays).toEqual(['check', 'check', 'check']);
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
