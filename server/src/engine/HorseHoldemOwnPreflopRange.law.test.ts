/**
 * LAW (plo-lead6 2026-11-24, BUILD-II round 5 step 1): with holdemLateStreetIsPriced or holdemFlopIsPriced on
 * (default OFF), the priced chooser's own range starts from the Horse's REAL preflop policy, never from the band its
 * opponents read for it; the asks of that policy change nothing of the decision being made; off, nothing is asked.
 * And (step 2) the opponent's own record reaches the chooser's reads for each scripted archetype of the exploit
 * probes (synthetic records): an always-bettor's bets are read as wide, a station's folds as rare, a nit's folds as
 * frequent and his bets as narrow.
 * States: HorseHoldemLateStreetIsPriced.flop.states.ndjson.gz (league self-play, production rows of 2026-11-24).
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HorseDecision, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { saveFastRandom, seedFastRandom } from './HorseEval.js';
import { seedHorseBetSizeRandom } from './horsePublicBetSize.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import { withFrozenDecisionClock } from './testing/frozenDecisionClock.js';
import {
  holdemOwnPreflopCurrent,
  holdemOwnPreflopFrames,
  holdemOwnPreflopReset,
  holdemPreflopClassOf,
} from './HorseHoldemOwnPreflopRange.js';
import { holdemLateBetShareOf, holdemLateFoldOf } from './HorseHoldemLateStreetIsPriced.js';

const NOW = 1795400000000;
interface State {
  k: string;
  set: 'flop_facing' | 'flop_open' | 'flop_multiway';
  player: SeatPlayer;
  gs: HorseGameStateV2;
  style: string;
  mods: Record<string, unknown>;
}
const fixture = JSON.parse(
  readFileSync(
    new URL('./HorseHoldemTurnRiverRaiseNeedsValue.fixture.json', import.meta.url),
    'utf8'
  )
) as { productionOpts: HorseDecideOpts };
const PROD = { ...fixture.productionOpts, holdemValueAndCallsArePriced: false } as HorseDecideOpts;
const ON = { holdemLateStreetIsPriced: true, holdemFlopIsPriced: true } as HorseDecideOpts;
const LINES = gunzipSync(
  readFileSync(new URL('./HorseHoldemLateStreetIsPriced.flop.states.ndjson.gz', import.meta.url))
)
  .toString('utf8')
  .split('\n')
  .filter(Boolean);
const at = (i: number): State => JSON.parse(LINES[i]!) as State;
const HU = LINES.map((_, i) => i).filter((i) => at(i).set !== 'flop_multiway');
const run = (s: State, extra: HorseDecideOpts, seed = 1): HorseDecision => {
  HorseMind.reset();
  seedFastRandom(seed);
  seedHorseBetSizeRandom(seed ^ 0x5bd1e995);
  seedHorseTimingRandom(seed ^ 0x9e3779b9);
  return withFrozenDecisionClock(() =>
    HorseLogic.decide(
      s.player,
      s.gs,
      s.style as never,
      s.mods as never,
      {
        ...PROD,
        ...extra,
        telemetry: false,
        observeMind: false,
        decisionTimeMs: NOW,
      } as HorseDecideOpts
    )
  );
};
const whole = (d: HorseDecision) =>
  JSON.stringify(d, (k, v) => (/Ms$|thinkTime/.test(k) ? undefined : v));

afterEach(() => {
  holdemOwnPreflopReset();
  HorseMind.reset();
  vi.restoreAllMocks();
});

describe("the Horse's own preflop range is its own preflop policy", () => {
  it('off: nothing is asked and nothing is primed', () => {
    const spy = vi.spyOn(HorseLogic, 'decide');
    for (const i of HU.slice(0, 20)) {
      holdemOwnPreflopReset();
      spy.mockClear();
      const s = at(i);
      run(s, {});
      expect(spy).toHaveBeenCalledTimes(1);
      expect(holdemOwnPreflopCurrent(s.player, s.gs)).toBeNull();
    }
  });

  it('on: a heads-up flop decision primes a range from the policy (weights in [0, 1], a real cut, its own class held)', () => {
    let primed = 0;
    let n = 0;
    for (const i of HU.slice(0, 60)) {
      holdemOwnPreflopReset();
      const s = at(i);
      run(s, ON);
      n++;
      const r = holdemOwnPreflopCurrent(s.player, s.gs);
      if (!r) continue;
      primed++;
      const w = Array.from(r.weight);
      expect(w.every((x) => x >= 0 && x <= 1)).toBe(true);
      // a policy that plays every hand or none is not a preflop policy (a mixed one, such as the small blind's
      // completing frequency, may keep no class at 1)
      expect(
        w.some((x) => x === 0),
        s.k
      ).toBe(true);
      expect(Math.max(...w), s.k).toBeGreaterThanOrEqual(0.5);
      // the Horse holds its own class, so its range holds it
      expect(w[holdemPreflopClassOf(s.player.cards[0]!, s.player.cards[1]!)]!).toBeGreaterThan(0);
    }
    expect(primed).toBeGreaterThanOrEqual(Math.floor(0.8 * n));
  });

  it('the frames rebuild the record: each frame keeps every seat at its own start stack', () => {
    let frames = 0;
    for (const i of HU) {
      const s = at(i);
      const fr = holdemOwnPreflopFrames(s.player, s.gs);
      if (!fr) continue;
      for (const f of fr) {
        frames++;
        for (const p of f.gs.players) {
          const real = s.gs.players.find((q) => q.seat === p.seat)!;
          const start =
            Number(real.stack) +
            Number((real as { totalInvested?: number }).totalInvested ?? 0) -
            Number((real as { individualAnteInvested?: number }).individualAnteInvested ?? 0) -
            Number((real as { deadInvested?: number }).deadInvested ?? 0);
          expect(Number(p.stack) + Number(p.bet)).toBeCloseTo(start, 6);
          // no other seat's hole cards are ever in a frame
          if (p.seat !== s.player.seat) expect(p.cards ?? []).toEqual([]);
        }
        expect(f.gs.stage).toBe('preflop');
        expect(f.gs.communityCards).toEqual([]);
      }
    }
    expect(frames).toBeGreaterThan(100);
  });

  it('the asks are invisible: the same decision and the same strategy-stream position as a decision whose range was already primed', () => {
    for (const i of HU.slice(0, 25)) {
      const s = at(i);
      holdemOwnPreflopReset();
      const cold = run(s, ON, 7);
      const coldRng = saveFastRandom();
      // warm: the policy key is cached, nothing is asked this time
      const warm = run(s, ON, 7);
      const warmRng = saveFastRandom();
      expect(whole(warm)).toBe(whole(cold));
      expect(warmRng).toBe(coldRng);
    }
  });

  it("deterministic and identity-free: renaming every other seat and flipping who is a Horse gives the same weights (the deciding Horse's own id seeds its own persona, as its preflop play always has)", () => {
    for (const i of HU.slice(0, 20)) {
      const s = at(i);
      holdemOwnPreflopReset();
      run(s, ON);
      const a = holdemOwnPreflopCurrent(s.player, s.gs);
      const me = s.player.user_id;
      const ren = (id: string | undefined) =>
        id === undefined || id === me ? id : `renamed-${id}`;
      const players = s.gs.players.map((p) => ({
        ...p,
        user_id: ren(p.user_id)!,
        is_horse: p.user_id === me ? p.is_horse : !(p as { is_horse?: boolean }).is_horse,
      }));
      const gs = {
        ...s.gs,
        players,
        humanUserIds: [],
        actionHistory: (s.gs.actionHistory ?? []).map((x) => ({ ...x, userId: ren(x.userId) })),
      } as HorseGameStateV2;
      holdemOwnPreflopReset();
      run({ ...s, gs }, ON);
      const b = holdemOwnPreflopCurrent(s.player, gs);
      expect(b === null, s.k).toBe(a === null);
      if (a && b) expect(Array.from(b.weight), s.k).toEqual(Array.from(a.weight));
      // and the same frame twice gives the same weights
      holdemOwnPreflopReset();
      run(s, ON);
      const c = holdemOwnPreflopCurrent(s.player, s.gs);
      if (a && c) expect(Array.from(c.weight), s.k).toEqual(Array.from(a.weight));
    }
  });

  it("a throwaway ask's mind writes never land: discardDecisionEffects keeps an outer capture untouched", () => {
    const captured = HorseMind.captureDecisionEffects(() =>
      HorseMind.discardDecisionEffects(() => {
        HorseMind.noteRaisePlan('hand-x', 'horse-x', 'flop', {} as never);
        return 1;
      })
    );
    expect(captured.value).toBe(1);
    expect(captured.effects).toEqual([]);
  });
});

describe("the opponent's own record reaches the chooser (synthetic records, one per exploit-probe archetype)", () => {
  const SCOPE = readScopeOf('nlh', 2);
  const HERO = 'record-horse';
  const VIL = 'record-opponent';
  type A = {
    userId: string;
    stage: string;
    action: string;
    amount?: number;
    isFullRaise?: boolean;
  };
  /** A heads-up hand: blinds, an open and a call, then each street the scripted player's line. */
  const hand = (line: (street: string) => A[]): A[] => {
    const a: A[] = [
      { userId: VIL, stage: 'preflop', action: 'sb', amount: 1 },
      { userId: HERO, stage: 'preflop', action: 'bb', amount: 2 },
      { userId: VIL, stage: 'preflop', action: 'call', amount: 1 },
      { userId: HERO, stage: 'preflop', action: 'check', amount: 0 },
    ];
    for (const st of ['flop', 'turn', 'river']) a.push(...line(st));
    return a;
  };
  let handNo = 0;
  const learn = (n: number, line: (street: string) => A[]) => {
    for (let h = 0; h < n; h++)
      HorseMind.observeHandComplete(`rec-${handNo++}`, hand(line) as never, 2, null, SCOPE);
  };
  const villain = { seat: 2, user_id: VIL, stack: 100, bet: 0, cards: [] } as unknown as SeatPlayer;
  const foldAt = () => {
    HorseMind.setDecisionScope(SCOPE);
    try {
      return holdemLateFoldOf(villain, 'turn', 'barrel', 0.66, true);
    } finally {
      HorseMind.setDecisionScope(null);
    }
  };
  const betShare = () => {
    const gs = {
      players: [{ seat: 1, user_id: HERO, stack: 100, bet: 0, cards: [] }, { ...villain }],
      dealerSeat: 2,
      actionHistory: [
        { userId: VIL, seat: 2, stage: 'preflop', action: 'raise', amount: 6 },
        { userId: HERO, seat: 1, stage: 'preflop', action: 'call', amount: 4 },
        { userId: HERO, seat: 1, stage: 'flop', action: 'check', amount: 0 },
        { userId: VIL, seat: 2, stage: 'flop', action: 'bet', amount: 6 },
      ],
    } as unknown as HorseGameStateV2;
    HorseMind.setDecisionScope(SCOPE);
    try {
      return holdemLateBetShareOf(gs, true)('flop', 3);
    } finally {
      HorseMind.setDecisionScope(null);
    }
  };
  const prior = () => {
    HorseMind.reset();
    return { f: foldAt(), b: betShare() };
  };

  it('(a)/(b) the always-bettor: bets every street checked to, never folds; his bet share is read wide, his fold rare', () => {
    const p = prior();
    HorseMind.reset();
    learn(60, (st) => [
      { userId: HERO, stage: st, action: 'check', amount: 0 },
      { userId: VIL, stage: st, action: 'bet', amount: 4, isFullRaise: true },
      { userId: HERO, stage: st, action: 'call', amount: 4 },
    ]);
    const b = betShare();
    expect(b).not.toBeNull();
    expect(b!).toBeGreaterThan(p.b! + 0.1);
    // he is never bet into here (he bets first): his fold read stays the prior
    expect(foldAt().f).toBeCloseTo(p.f.f, 6);
  });

  it('(e) the station: called every bet; his fold to a bet is read rare (fewer bluffs into him)', () => {
    const p = prior();
    HorseMind.reset();
    learn(60, (st) => [
      { userId: HERO, stage: st, action: 'bet', amount: 4, isFullRaise: true },
      { userId: VIL, stage: st, action: 'call', amount: 4 },
    ]);
    const r = foldAt();
    expect(r.recordWeight).toBeGreaterThan(0.5);
    expect(r.f).toBeLessThan(p.f.f - 0.1);
  });

  it('(d) the nit: folds to bets, checks behind; his fold is read frequent and his bets narrow', () => {
    const p = prior();
    HorseMind.reset();
    learn(60, (st) =>
      st === 'flop'
        ? [
            { userId: HERO, stage: st, action: 'bet', amount: 4, isFullRaise: true },
            { userId: VIL, stage: st, action: 'fold', amount: 0 },
          ]
        : []
    );
    learn(60, (st) => [
      { userId: HERO, stage: st, action: 'check', amount: 0 },
      { userId: VIL, stage: st, action: 'check', amount: 0 },
    ]);
    const r = foldAt();
    expect(r.recordWeight).toBeGreaterThan(0.5);
    expect(r.f).toBeGreaterThan(p.f.f + 0.1);
    expect(betShare()!).toBeLessThan(p.b! - 0.1);
  });
});
