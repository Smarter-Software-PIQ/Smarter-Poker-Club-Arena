import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  horseRunItTwiceRuns,
  HORSE_RIT_LOPSIDED_LOW,
  HORSE_RIT_LOPSIDED_HIGH,
} from './HorseRunItTwice.js';
import {
  horseRunItTwiceAnswer,
  horseRunItTwicePricedReceipt,
  horseRunItTwiceRunsPriced,
  readRunItTwiceCurve,
  runItTwiceVarianceShare,
  RUN_IT_TWICE_EV_GAP_BB,
  RUN_IT_TWICE_PERSONA_LOGIT_BOUND,
  type RunItTwiceRole,
} from './HorseRunItTwicePriced.js';
import { RUN_IT_TWICE_PEOPLE_CURVE } from './HorseRunItTwicePeople.data.js';
import {
  compileRunItTwicePeopleCurve,
  renderRunItTwicePeopleCurveFile,
} from './compileRunItTwicePeopleCurve.js';
import * as HorseRunItTwiceSwitch from './HorseRunItTwiceSwitch.js';
import {
  horseRunItTwiceIsPricedOn,
  receiveHorseRunItTwiceSwitchMessage,
  resetHorseRunItTwiceSwitchForTest,
} from './HorseRunItTwiceSwitch.js';
import { OPTION_SWITCH_PLAIN_NAMES } from './HorseOptionSwitch.js';
import { STYLE_SWITCH_STALE_MS } from './HorseStyleSwitch.js';
import { disarmBrainTelemetryForTest, drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { ServerTableEngine } from './ServerTableEngine.js';
import { LiveHorseDecisionWorkerPool } from './horseDecision/lane.js';

const horses = Array.from(
  { length: 40 },
  (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
);
const equities = [
  null,
  0,
  0.02,
  0.1,
  0.25,
  0.2501,
  0.3,
  0.42,
  0.5,
  0.58,
  0.7,
  0.7499,
  0.75,
  0.9,
  1,
];
const pots = [0, 10, 39.9, 40, 100, 200, 800];
const roles: RunItTwiceRole[] = ['chooser', 'responder'];

describe('horseRunItTwiceIsPriced (default OFF)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    disarmBrainTelemetryForTest();
    drainFires();
    resetHorseRunItTwiceSwitchForTest();
  });

  it('main thread reads OFF with nothing delivered, re-reads immediately on delivery, and fails safe on unregistered, unreadable, malformed or stale messages', () => {
    let now = 1_000_000;
    let wall = 1_760_000_000_000;
    resetHorseRunItTwiceSwitchForTest(
      () => now,
      () => wall
    );
    expect(horseRunItTwiceIsPricedOn(now)).toBe(false);
    const validOn = {
      type: 'STYLE_SWITCH_STATE',
      seq: 1,
      status: 'ok',
      readAtEpochMs: wall,
      config: {
        version: 2,
        style: { version: 1, options: {} },
        options: { horseRunItTwiceIsPriced: 'on' },
      },
    };
    receiveHorseRunItTwiceSwitchMessage(validOn);
    // Zero poll lag: 1 ms later the holder parses the delivered message rather than waiting 60s.
    now += 1;
    expect(OPTION_SWITCH_PLAIN_NAMES.includes('horseRunItTwiceIsPriced')).toBe(false);
    expect(horseRunItTwiceIsPricedOn(now)).toBe(false);
    // Unreadable delivery fails safe to OFF without throwing.
    receiveHorseRunItTwiceSwitchMessage({
      type: 'STYLE_SWITCH_STATE',
      seq: 2,
      status: 'unreadable',
      readAtEpochMs: wall + 1,
      config: null,
    });
    expect(horseRunItTwiceIsPricedOn(now + 1)).toBe(false);
    // Stale wall-clock reading (aged past STYLE_SWITCH_STALE_MS) fails safe to OFF.
    receiveHorseRunItTwiceSwitchMessage({
      ...validOn,
      seq: 3,
      readAtEpochMs: wall - STYLE_SWITCH_STALE_MS - 1_000,
    });
    expect(horseRunItTwiceIsPricedOn(now + 2)).toBe(false);
    // Malformed payloads never throw and leave the switch OFF.
    receiveHorseRunItTwiceSwitchMessage({ junk: true });
    receiveHorseRunItTwiceSwitchMessage(null);
    expect(horseRunItTwiceIsPricedOn(now + STYLE_SWITCH_STALE_MS + 10_000)).toBe(false);
  });

  it('lane.broadcastStyleSwitch delivers STYLE_SWITCH_STATE to the main-thread RIT switch holder', () => {
    const postStyleSwitch = vi.fn();
    const receiveSpy = vi.spyOn(HorseRunItTwiceSwitch, 'receiveHorseRunItTwiceSwitchMessage');
    const poolStandIn = {
      lastStyleSwitch: null,
      clients: [{ postStyleSwitch }],
    };
    const msg = {
      type: 'STYLE_SWITCH_STATE' as const,
      seq: 7,
      status: 'ok' as const,
      readAtEpochMs: Date.now(),
      config: {
        version: 2,
        style: { version: 1, options: {} },
        options: { horseRunItTwiceIsPriced: 'on' },
      },
    };
    LiveHorseDecisionWorkerPool.prototype.broadcastStyleSwitch.call(poolStandIn as never, msg);
    expect(receiveSpy).toHaveBeenCalledTimes(1);
    expect(receiveSpy).toHaveBeenCalledWith(msg);
    expect(postStyleSwitch).toHaveBeenCalledWith(msg);
    expect(horseRunItTwiceIsPricedOn()).toBe(false);
  });

  it('ServerTableEngineRunout.horseRitRuns and horseRitVerdict: default OFF is byte-identical to horseRunItTwiceRuns with zero priced receipts', () => {
    enableBrainTelemetry();
    drainFires();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = ServerTableEngine.prototype as any;
    const makeEngine = (
      handCount: number,
      equityMap: Record<string, number>,
      potBB: number,
      maxRuns: 1 | 2 | 3
    ) => ({
      handCount,
      horseRitOfferEquity: new Map([[handCount, { equity: equityMap, potBB, maxRuns }]]),
      horseRitRuns: proto.horseRitRuns,
      horseRitVerdict: proto.horseRitVerdict,
    });

    for (const horseId of horses.slice(0, 10)) {
      for (const handNumber of [1, 2, 3, 7, 11]) {
        for (const equity of [0.1, 0.5, 0.9] as const) {
          for (const maxRuns of [1, 2, 3] as const) {
            const eng = makeEngine(
              handNumber,
              { [horseId]: equity, opponent: 1 - equity },
              120,
              maxRuns
            );
            const expected = horseRunItTwiceRuns({
              horseId,
              handNumber,
              potBB: 120,
              equity,
              maxRuns,
            });
            expect(eng.horseRitRuns(horseId, 'chooser')).toBe(expected);
            expect(eng.horseRitRuns(horseId, 'responder')).toBe(expected);
            expect(eng.horseRitVerdict(horseId)).toBe(expected === 1 ? 'once' : 'multi');
          }
        }
      }
    }
    const pricedFires = drainFires().filter((f) => f.feature.startsWith('horse_rit_priced_'));
    expect(pricedFires).toEqual([]);
  });

  it('ServerTableEngineRunout.horseRitRuns and horseRitVerdict: when ON, passes role and playersAllIn, returns horseRunItTwiceAnswer, and emits all five receipts', () => {
    enableBrainTelemetry();
    drainFires();
    vi.spyOn(HorseRunItTwiceSwitch, 'horseRunItTwiceIsPricedOn').mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = ServerTableEngine.prototype as any;
    const callRuns = (
      horseId: string,
      handCount: number,
      equityMap: Record<string, number> | null,
      potBB: number,
      maxRuns: 1 | 2 | 3,
      role: RunItTwiceRole
    ) => {
      const eng = {
        handCount,
        horseRitOfferEquity: equityMap
          ? new Map([[handCount, { equity: equityMap, potBB, maxRuns }]])
          : new Map(),
        horseRitRuns: proto.horseRitRuns,
        horseRitVerdict: proto.horseRitVerdict,
      };
      return {
        runs: eng.horseRitRuns(horseId, role) as 1 | 2 | 3,
        verdict: eng.horseRitVerdict(horseId) as 'once' | 'multi',
      };
    };

    // Unknown equity -> 1 run + horse_rit_priced_equity_unknown
    const unknown = callRuns(horses[0], 1, null, 120, 3, 'chooser');
    expect(unknown.runs).toBe(1);
    expect(unknown.verdict).toBe('once');

    // Lopsided equity -> 1 run + horse_rit_priced_owner_cut (owner order 2026-11-13)
    const lopsided = callRuns(
      horses[0],
      2,
      { [horses[0]]: 0.05, opponent: 0.95 },
      200,
      3,
      'chooser'
    );
    expect(lopsided.runs).toBe(1);
    expect(lopsided.verdict).toBe('once');

    // 3-way all-in inside the band: verify parity with horseRunItTwiceAnswer across roles and collect
    // measured_once, measured_multi, measured_three receipts.
    const seenReasons = new Set<string>();
    for (const horseId of horses.slice(0, 20)) {
      for (let handNumber = 1; handNumber <= 20; handNumber++) {
        const eqMap = { [horseId]: 0.34, opp1: 0.33, opp2: 0.33 };
        for (const role of roles) {
          const expected = horseRunItTwiceAnswer(
            {
              horseId,
              handNumber,
              potBB: 180,
              equity: 0.34,
              maxRuns: 3,
              role,
              playersAllIn: 3,
            },
            true
          );
          const actual = callRuns(horseId, handNumber, eqMap, 180, 3, role);
          expect(actual.runs).toBe(expected.runs);
          if (role === 'responder') {
            expect(actual.runs).not.toBe(3);
            expect(actual.verdict).toBe(expected.runs === 1 ? 'once' : 'multi');
          }
          if (expected.priced) seenReasons.add(horseRunItTwicePricedReceipt(expected.priced));
        }
      }
    }
    const firedFeatures = new Set(drainFires().map((f) => f.feature));
    for (const receipt of [
      'horse_rit_priced_equity_unknown',
      'horse_rit_priced_owner_cut',
      'horse_rit_priced_once',
      'horse_rit_priced_multi',
      'horse_rit_priced_three',
    ]) {
      expect(firedFeatures.has(receipt), receipt).toBe(true);
    }
    expect(seenReasons.has('horse_rit_priced_three')).toBe(true);
  });

  it('off: answers exactly as horseRunItTwiceRuns on every input of the grid', () => {
    let n = 0;
    for (const horseId of horses)
      for (let handNumber = 1; handNumber <= 12; handNumber++)
        for (const equity of equities)
          for (const potBB of pots)
            for (const maxRuns of [1, 2, 3] as const)
              for (const role of roles) {
                const base = horseRunItTwiceRuns({ horseId, handNumber, potBB, equity, maxRuns });
                const a = horseRunItTwiceAnswer(
                  { horseId, handNumber, potBB, equity, maxRuns, role, playersAllIn: 2 },
                  false
                );
                expect(a.runs).toBe(base);
                expect(a.priced).toBeNull();
                n++;
              }
    expect(n).toBeGreaterThan(100000);
  });

  it('chip EV of k runs equals one run: rake and BBJ are taken once (money test still asserts it)', () => {
    expect(RUN_IT_TWICE_EV_GAP_BB).toBe(0);
    const money = readFileSync(join(__dirname, 'RunItTwice.money.test.ts'), 'utf8');
    expect(money).toMatch(/rake and the BBJ fee are deducted exactly ONCE/);
  });

  it('on: never a multi-run at a lopsided equity (owner cut 2026-11-13), never 3 runs from a responder or at maxRuns 2', () => {
    for (const horseId of horses)
      for (let handNumber = 1; handNumber <= 200; handNumber++)
        for (const equity of [
          0,
          0.05,
          0.1,
          0.2,
          HORSE_RIT_LOPSIDED_LOW,
          HORSE_RIT_LOPSIDED_HIGH,
          0.8,
          0.95,
          1,
        ])
          for (const role of roles) {
            const a = horseRunItTwiceRunsPriced({
              horseId,
              handNumber,
              potBB: 300,
              equity,
              maxRuns: 3,
              role,
              playersAllIn: 2,
            });
            expect(a.runs).toBe(1);
            expect(a.reason).toBe('owner_cut_lopsided');
          }
    for (const horseId of horses)
      for (let handNumber = 1; handNumber <= 200; handNumber++) {
        expect(
          horseRunItTwiceRunsPriced({
            horseId,
            handNumber,
            potBB: 300,
            equity: 0.5,
            maxRuns: 3,
            role: 'responder',
            playersAllIn: 2,
          }).runs
        ).not.toBe(3);
        expect(
          horseRunItTwiceRunsPriced({
            horseId,
            handNumber,
            potBB: 300,
            equity: 0.5,
            maxRuns: 2,
            role: 'chooser',
            playersAllIn: 2,
          }).runs
        ).not.toBe(3);
      }
  });

  it('on: unknown equity and maxRuns 1 run once', () => {
    expect(
      horseRunItTwiceRunsPriced({
        horseId: horses[0],
        handNumber: 1,
        potBB: 100,
        equity: null,
        maxRuns: 3,
        role: 'chooser',
        playersAllIn: 2,
      }).reason
    ).toBe('equity_unknown');
    expect(
      horseRunItTwiceRunsPriced({
        horseId: horses[0],
        handNumber: 1,
        potBB: 100,
        equity: 0.5,
        maxRuns: 1,
        role: 'chooser',
        playersAllIn: 2,
      }).reason
    ).toBe('no_multi_allowed');
  });

  it('on: the multi-run share follows the measured curve within the declared persona bound, sometimes not always', () => {
    for (const role of roles) {
      let multi = 0;
      let n = 0;
      for (const horseId of horses)
        for (let handNumber = 1; handNumber <= 500; handNumber++) {
          const a = horseRunItTwiceRunsPriced({
            horseId,
            handNumber,
            potBB: 160,
            equity: 0.5,
            maxRuns: 3,
            role,
            playersAllIn: 2,
          });
          const measured = readRunItTwiceCurve(RUN_IT_TWICE_PEOPLE_CURVE, role, 1, 160, 'pMulti');
          const lo =
            1 /
            (1 +
              Math.exp(-(Math.log(measured / (1 - measured)) - RUN_IT_TWICE_PERSONA_LOGIT_BOUND)));
          const hi =
            1 /
            (1 +
              Math.exp(-(Math.log(measured / (1 - measured)) + RUN_IT_TWICE_PERSONA_LOGIT_BOUND)));
          expect(a.pMulti!).toBeGreaterThanOrEqual(lo - 1e-9);
          expect(a.pMulti!).toBeLessThanOrEqual(hi + 1e-9);
          n++;
          if (a.runs > 1) multi++;
        }
      expect(multi / n).toBeGreaterThan(0.05);
      expect(multi / n).toBeLessThan(0.95);
    }
  });

  it('on: deterministic (a replay answers the same)', () => {
    for (const horseId of horses.slice(0, 5))
      for (let handNumber = 1; handNumber <= 100; handNumber++) {
        const i = {
          horseId,
          handNumber,
          potBB: 120,
          equity: 0.47,
          maxRuns: 3 as const,
          role: 'chooser' as const,
          playersAllIn: 2,
        };
        expect(horseRunItTwiceRunsPriced(i)).toEqual(horseRunItTwiceRunsPriced(i));
      }
  });

  it('variance share is 1 at the fair share and falls toward the extremes, for 2 and 3 players all in', () => {
    expect(runItTwiceVarianceShare(0.5, 2)).toBeCloseTo(1);
    expect(runItTwiceVarianceShare(1 / 3, 3)).toBeCloseTo(1);
    expect(runItTwiceVarianceShare(0.1, 2)).toBeCloseTo(0.36);
  });

  it('the compiler is deterministic and reads no identity; the committed curve has the declared grid', () => {
    const rows = [
      { role: 'chooser' as const, runs: 2, equity: 0.5, potBB: 100, playersAllIn: 2 },
      { role: 'chooser' as const, runs: 1, equity: 0.6, potBB: 50, playersAllIn: 2 },
      { role: 'responder' as const, runs: 1, equity: 0.4, potBB: 200, playersAllIn: 2 },
    ];
    const a = renderRunItTwicePeopleCurveFile(
      compileRunItTwicePeopleCurve(rows, { source: 's', window: 'w' })
    );
    const b = renderRunItTwicePeopleCurveFile(
      compileRunItTwicePeopleCurve(rows, { source: 's', window: 'w' })
    );
    expect(a).toBe(b);
    expect(a).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    const c = RUN_IT_TWICE_PEOPLE_CURVE;
    expect(c.varianceGrid.length).toBe(21);
    expect(c.lnPotGrid.length).toBe(7);
    expect(c.roles.chooser.n).toBe(376);
    expect(c.roles.responder.n).toBe(413);
    expect(JSON.stringify(c)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});
