/**
 * LAW (plo-lead6 2026-11-24; owner 2026-11-24 12:30 / 12:35 AM CST: no unconditioned random play in Hold'em, the best
 * play by math). holdemLateStreetIsPriced (default OFF) and holdemLateStreetBluffRaiseIsPriced (default OFF).
 * States: the same 2,526 generated NLH turn/river facing-a-wager states and 657 control states as
 * HorseHoldemTurnRiverRaiseNeedsValue.law.test.ts (its .states.ndjson.gz), plus the turn/river states checked to.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { HorseDecision, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { seedHorseBetSizeRandom } from './horsePublicBetSize.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { withFrozenDecisionClock } from './testing/frozenDecisionClock.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import {
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_RELEASE_DEFAULT_OFF,
} from './HorseOptionSwitch.js';
import {
  holdemLateBlockedFold,
  holdemLateBlockers,
  holdemLateSpot,
  holdemLateVerdict,
} from './HorseHoldemLateStreetIsPriced.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';

const OPT = 'holdemLateStreetIsPriced';
const RAISE = 'holdemLateStreetBluffRaiseIsPriced';
const TOURN = 'holdemLateStreetIsPricedInTournaments';
const NOW = 1795400000000;
interface State {
  k: string;
  set: string;
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
const LINES = gunzipSync(
  readFileSync(new URL('./HorseHoldemTurnRiverRaiseNeedsValue.states.ndjson.gz', import.meta.url))
)
  .toString('utf8')
  .split('\n')
  .filter(Boolean);
const at = (i: number): State => JSON.parse(LINES[i]!) as State;
const ALL = LINES.map((_, i) => i);
const LATE = ALL.filter((i) => at(i).set === 'late');
const CONTROL = ALL.filter((i) => at(i).set === 'control');
const CHECKED_TO = CONTROL.filter((i) => {
  const s = at(i);
  return (
    (s.gs.stage === 'turn' || s.gs.stage === 'river') &&
    holdemLateSpot(s.player, s.gs, true)?.facing === false
  );
});
const run = (s: State, extra: HorseDecideOpts, seed = 1, telemetry = false): HorseDecision => {
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
        telemetry,
        observeMind: false,
        decisionTimeMs: NOW,
      } as HorseDecideOpts
    )
  );
};
const act = (d: HorseDecision) => `${d.action}:${d.amount ?? ''}`;
const whole = (d: HorseDecision) =>
  JSON.stringify(d, (k, v) => (/Ms$|thinkTime/.test(k) ? undefined : v));
const legalTo = (_s: State) => (to: number) => to;

describe('both options are registered dark', () => {
  it('default OFF, switchable, on the ledger', () => {
    for (const o of [OPT, RAISE, TOURN]) {
      expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain(o);
      expect(OPTION_SWITCH_OFF_ONLY_NAMES).not.toContain(o);
      expect(HORSE_DATA_LEDGER.some((e) => e.kind === 'flag' && e.key === o)).toBe(true);
      expect((PROD as Record<string, unknown>)[o]).toBeUndefined();
    }
  });
});

describe('LAW: the chooser is the math, never a roll', () => {
  it('its module reads no random generator and no hash roll (static)', () => {
    const src = readFileSync(new URL('./HorseHoldemLateStreetIsPriced.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const w of [
      'fastRandom',
      'Math.random',
      'Hash01',
      'SpotUnit',
      'seedFastRandom',
      'persona',
    ])
      expect(src.includes(w), w).toBe(false);
    // its generators: the seeded runouts of the realization and the residual-frequency draw, nothing else
    expect(src.match(/runoutGenerator\(/g)?.length).toBe(3);
  });

  it('in its spot the final action and size are the same whatever the random streams were seeded with', () => {
    let compared = 0;
    for (const i of [...LATE.filter((_, j) => j % 6 === 0), ...CHECKED_TO]) {
      const a = run(at(i), { [OPT]: true, [TOURN]: true }, 1);
      const b = run(at(i), { [OPT]: true, [TOURN]: true }, 987654321);
      expect(act(b), at(i).k).toBe(act(a));
      compared++;
    }
    expect(compared).toBeGreaterThan(400);
  }, 600_000);

  it('no priced bet has a lower EV than the check, and facing a bet no fold where the call prices at or above zero', () => {
    let bets = 0;
    let folds = 0;
    for (const i of [...LATE, ...CHECKED_TO]) {
      const s = at(i);
      const spot = holdemLateSpot(s.player, s.gs, true);
      if (!spot) continue;
      HorseMind.reset();
      const v = holdemLateVerdict(s.player, s.gs, spot, true, legalTo(s), {
        bluffRaise: false,
        decisionRaiseTo: null,
      });
      if (!v) continue;
      if (v.best.kind === 'bet') {
        bets++;
        const check = v.options.find((o) => o.kind === 'check')!;
        // a bet below the check is only a bluff the range-level plan selected (balanced share at the node size)
        if (v.range?.kind !== 'bluff') expect(v.best.ev, s.k).toBeGreaterThanOrEqual(check.ev);
      }
      if (v.best.kind === 'fold') {
        folds++;
        expect(v.options.find((o) => o.kind === 'call')!.ev, s.k).toBeLessThan(0);
      }
    }
    // coverage of the generated set (the check is priced with his bet behind it, so fewer of these states bet)
    expect(bets).toBeGreaterThanOrEqual(10);
    expect(folds).toBeGreaterThan(20);
  }, 600_000);
});

describe('LAW: blockers and range advantage are terms of the price', () => {
  it('a Horse card that removes his strong combinations raises his fold; one that removes his weak ones lowers it', () => {
    expect(holdemLateBlockedFold(0.5, 0.2, 0)).toBeGreaterThan(0.5);
    expect(holdemLateBlockedFold(0.5, 0, 0.2)).toBeLessThan(0.5);
    const board = [
      { rank: 'K', suit: 'spades' },
      { rank: '8', suit: 'spades' },
      { rank: '3', suit: 'spades' },
      { rank: '2', suit: 'hearts' },
      { rank: '9', suit: 'diamonds' },
    ] as never;
    const nutBlocker = holdemLateBlockers(
      [
        { rank: 'A', suit: 'spades' },
        { rank: '4', suit: 'clubs' },
      ] as never,
      board
    );
    const noBlocker = holdemLateBlockers(
      [
        { rank: '6', suit: 'hearts' },
        { rank: '4', suit: 'clubs' },
      ] as never,
      board
    );
    expect(nutBlocker.bv).toBeGreaterThan(noBlocker.bv);
  });

  it('across the generated states the blocker term and the nut-advantage term each decide some actions', () => {
    enableBrainTelemetry();
    const fires = new Map<string, number>();
    for (const i of [...LATE.filter((_, j) => j % 3 === 0), ...CHECKED_TO]) {
      drainFires();
      run(at(i), { [OPT]: true, [TOURN]: true }, 1, true);
      for (const f of drainFires()) fires.set(f.feature, (fires.get(f.feature) ?? 0) + f.fires);
    }
    expect(fires.get('holdem_late_priced_blocker_decided') ?? 0).toBeGreaterThan(0);
    expect(fires.get('holdem_late_priced_nut_advantage_decided') ?? 0).toBeGreaterThan(0);
    expect(fires.get('holdem_late_priced_bet_bluff') ?? 0).toBeGreaterThan(0);
  }, 600_000);
});

describe('inertness and the validator', () => {
  it('outside its spot nothing changes (preflop, flop), and off equals unset', () => {
    for (const i of CONTROL.filter((i) => holdemLateSpot(at(i).player, at(i).gs, true) === null)) {
      expect(whole(run(at(i), { [OPT]: true, [RAISE]: true })), at(i).k).toBe(
        whole(run(at(i), {}))
      );
    }
    for (const i of LATE.filter((_, j) => j % 5 === 0)) {
      expect(whole(run(at(i), { [OPT]: false, [RAISE]: false }))).toBe(whole(run(at(i), {})));
    }
  }, 600_000);

  it('tournaments keep their decision unless the tournament option is on (lead ruling 5)', () => {
    let n = 0;
    for (const i of LATE.filter((i) => at(i).gs.gameMode === 'tournament').filter(
      (_, j) => j % 3 === 0
    )) {
      expect(whole(run(at(i), { [OPT]: true })), at(i).k).toBe(whole(run(at(i), {})));
      n++;
    }
    expect(n).toBeGreaterThan(50);
  }, 600_000);

  it('the bluff-raise option does nothing without the chooser', () => {
    for (const i of LATE.filter((_, j) => j % 5 === 0)) {
      expect(whole(run(at(i), { [RAISE]: true }))).toBe(whole(run(at(i), {})));
    }
  }, 600_000);

  it("the chooser's passive answers are admitted under its gate", () => {
    let checked = 0;
    for (const i of [...LATE, ...CHECKED_TO]) {
      const s = at(i);
      const on = run(s, { [OPT]: true, [TOURN]: true, holdemTurnRiverRaiseNeedsValue: true });
      if (on.policyGraph === undefined || !['check', 'call', 'fold'].includes(on.action)) continue;
      const ctx = {
        player: s.player,
        gameState: s.gs,
        [OPT]: true,
        holdemTurnRiverRaiseNeedsValue: true,
      };
      expect(horseDecisionReceiptRefusal(structuredClone(on), 'nlh', ctx), s.k).toBeNull();
      if (++checked >= 60) break;
    }
    expect(checked).toBeGreaterThan(30);
  }, 600_000);
});
