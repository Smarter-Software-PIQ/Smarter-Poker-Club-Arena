/**
 * LAW: THE FIXED-LIMIT PROBE SWITCH IS LIVE (2026-11-15, Fixed-Limit lane; owner standing rule 11:26, every
 * option built in and switchable ON and OFF live with no cutover per activation).
 *
 * FIXED-LIMIT BETS ARE NEVER PROBES (AFixedLimitBetIsNeverAProbe.law.test.ts) is a PROCESS switch: HorseMind.observe
 * reads HorseMind.fixedLimitBetsAreNeverProbes wherever it counts, inside a decision or not, so it cannot be a
 * decision option. It is registered in the option switch registry as fixedLimitBetsAreNeverProbes (release default
 * on), and the decision worker applies the registry state to the process switch before every job:
 *   - an off row: the next fixed-limit hand the worker observes counts its checked-to bets as probes again
 *     (main before 2026-11-14);
 *   - an on row, no row, an unreadable read and a stale read: the source default, which counts them whole;
 *   - no-limit and pot-limit counting is identical in every state;
 *   - every production caller of HorseMind.observe runs in the decision worker, behind that apply.
 */
import { performance } from 'node:perf_hooks';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HORSE_DATA_LEDGER } from '../HorseDataLedger.js';
import { FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT, HorseMind } from '../HorseMind.js';
import {
  OPTION_SWITCH_PLAIN_REGISTRY,
  OPTION_SWITCH_RELEASE_DEFAULT_ON,
  OptionSwitchHolder,
  optionSwitchDecisionOpts,
} from '../HorseOptionSwitch.js';
import { STYLE_SWITCH_POLL_MS, STYLE_SWITCH_STALE_MS } from '../HorseStyleSwitch.js';
import { createStyleSwitchWorkerInbox } from './styleSwitchDelivery.js';
import { workerHarness } from '../../testing/horseRegression/plan/fixture.js';
import type { ObserveCompletedHandRequest } from './protocol.js';
import type { ActionRecord } from '../../types.js';

const NAME = 'fixedLimitBetsAreNeverProbes';
const SRC = fileURLToPath(new URL('../../', import.meta.url));
const BB = 2;
const HERO = '10000000-0000-4000-8000-000000000001';
const OPP = '10000000-0000-4000-8000-000000000002';
const TABLE = '20000000-0000-4000-8000-000000000013';
const WALL_EPOCH = 1_700_000_000_000;
let ts = 5_000_000;

/** Heads-up: OPP raises, HERO calls and checks every street, OPP bets one bet (fixed limit: 2/4/4) or one big blind
 *  (no limit, pot limit) into every street and HERO calls. Fixed limit: three checked-to bets, two of them small
 *  enough to read as probes when the switch is off (AFixedLimitBetIsNeverAProbe: 300 and 200 per 100 hands). */
function hand(fixedLimit: boolean): ActionRecord[] {
  const out: ActionRecord[] = [];
  const push = (userId: string, action: string, amount: number, stage: string) =>
    out.push({
      seat: userId === HERO ? 1 : 2,
      userId,
      action,
      amount,
      timestamp: ts++,
      stage,
    } as ActionRecord);
  push(OPP, 'raise', fixedLimit ? 4 : 5, 'preflop');
  push(HERO, 'call', fixedLimit ? 2 : 3, 'preflop');
  for (const [stage, bet] of [
    ['flop', fixedLimit ? 2 : BB],
    ['turn', fixedLimit ? 4 : BB],
    ['river', fixedLimit ? 4 : BB],
  ] as const) {
    push(HERO, 'check', 0, stage);
    push(OPP, 'bet', bet, stage);
    push(HERO, 'call', bet, stage);
  }
  return out;
}

let requestId = 0;
function completed(variant: string): ObserveCompletedHandRequest {
  const n = 1_000_000 + ++requestId;
  return {
    type: 'OBSERVE_COMPLETED_HAND',
    requestId,
    generation: n,
    fence: `${TABLE}:${n}:9:observe`,
    handKey: `${TABLE}:${n}`,
    committedHandId: `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    bigBlind: BB,
    actions: hand(variant === 'flh' || variant === 'flo8'),
    showdown: null,
    riverCallContext: { variant, boardCount: 1 },
    scope: variant === 'flh' || variant === 'nlh' ? 'holdem:hu' : 'omaha:hu',
  } as ObserveCompletedHandRequest;
}

/** A real decision worker with the production switch wiring (the inbox both holders read). */
function worker() {
  let t = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => t);
  HorseMind.reset();
  const features: string[] = [];
  const note = (feature: string) => void features.push(feature);
  const inbox = createStyleSwitchWorkerInbox(
    () => t,
    () => WALL_EPOCH + t
  );
  const h = workerHarness({
    now: () => t,
    noteFeature: note,
    optionSwitch: new OptionSwitchHolder(inbox.optionSource, note),
  });
  let seq = 0;
  return {
    features,
    advance(ms: number) {
      t += ms;
    },
    deliver(options: Record<string, string> | null, status: 'ok' | 'unreadable' = 'ok') {
      inbox.receive({
        type: 'STYLE_SWITCH_STATE',
        seq: ++seq,
        status,
        readAtEpochMs: WALL_EPOCH + t,
        config:
          options === null ? null : { version: 2, style: { version: 1, options: {} }, options },
      });
    },
    /** One completed hand through the worker's job lane; the opponent's tallies it added. */
    async observe(variant: string) {
      const before = HorseMind.getStats(OPP);
      const was = [
        before?.ctBets ?? 0,
        before?.ctProbes ?? 0,
        before?.postAggr ?? 0,
        before?.aggr ?? 0,
      ];
      h.runtime.receive(structuredClone(completed(variant)));
      await h.runtime.drain();
      const s = HorseMind.getStats(OPP)!;
      return {
        ctBets: (s.ctBets ?? 0) - was[0]!,
        ctProbes: (s.ctProbes ?? 0) - was[1]!,
        postAggr: (s.postAggr ?? 0) - was[2]!,
        aggr: (s.aggr ?? 0) - was[3]!,
      };
    },
    close: () => h.close(),
  };
}
const open: Array<ReturnType<typeof worker>> = [];
function opened() {
  const w = worker();
  open.push(w);
  return w;
}
afterEach(async () => {
  for (const w of open.splice(0)) await w.close();
  vi.restoreAllMocks();
  HorseMind.setFixedLimitBetsAreNeverProbes(FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT);
  HorseMind.reset();
});

const WHOLE = { ctBets: 0, ctProbes: 0 };
const PROBED = { ctBets: 3, ctProbes: 2 };

describe('the fixed-limit probe switch is registered like every other option', () => {
  it('is a ledger option with an on/off switch, release default on, owned by the Fixed-Limit lane', () => {
    expect(HORSE_DATA_LEDGER.filter((e) => e.kind === 'flag' && e.key === NAME)).toHaveLength(1);
    const entry = OPTION_SWITCH_PLAIN_REGISTRY.find((e) => e.name === NAME);
    expect(entry).toBeDefined();
    expect([...entry!.states]).toEqual(['off', 'on']);
    expect(entry!.releaseDefault).toBe('on');
    expect(entry!.owner).toBe('Fixed-Limit');
    expect(entry!.offOnly).toBeUndefined();
    expect(OPTION_SWITCH_RELEASE_DEFAULT_ON).toContain(NAME);
    // the release default the registry states is the source default the counter starts with
    expect(FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT).toBe(true);
  });

  it('maps off to off, on to on, and anything else to the source default (never the last value)', () => {
    HorseMind.applyFixedLimitBetsAreNeverProbesOption(optionSwitchDecisionOpts({ [NAME]: 'off' }));
    expect(HorseMind.fixedLimitBetsAreNeverProbesOn()).toBe(false);
    HorseMind.applyFixedLimitBetsAreNeverProbesOption(optionSwitchDecisionOpts({}));
    expect(HorseMind.fixedLimitBetsAreNeverProbesOn()).toBe(
      FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT
    );
    HorseMind.applyFixedLimitBetsAreNeverProbesOption(optionSwitchDecisionOpts({ [NAME]: 'off' }));
    HorseMind.applyFixedLimitBetsAreNeverProbesOption(optionSwitchDecisionOpts(null));
    expect(HorseMind.fixedLimitBetsAreNeverProbesOn()).toBe(
      FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT
    );
    HorseMind.applyFixedLimitBetsAreNeverProbesOption(optionSwitchDecisionOpts({ [NAME]: 'on' }));
    expect(HorseMind.fixedLimitBetsAreNeverProbesOn()).toBe(true);
  });
});

describe('through a real decision worker', () => {
  it('no row counts fixed-limit bets whole; an off row makes the next hand probe-counted; clearing it returns', async () => {
    const w = opened();
    w.deliver({});
    expect(await w.observe('flh')).toMatchObject(WHOLE);
    w.advance(STYLE_SWITCH_POLL_MS);
    w.deliver({ [NAME]: 'off' });
    expect(await w.observe('flh')).toMatchObject(PROBED);
    expect(await w.observe('flo8')).toMatchObject(PROBED);
    expect(HorseMind.fixedLimitBetsAreNeverProbesOn()).toBe(false);
    expect(w.features).toContain(`option_switch_${NAME}_off_seen`);
    w.advance(STYLE_SWITCH_POLL_MS);
    w.deliver({});
    expect(await w.observe('flh')).toMatchObject(WHOLE);
    expect(w.features).toContain(`option_switch_${NAME}_default_seen`);
  });

  it('an on row counts them whole, and so does the release after it', async () => {
    const w = opened();
    w.deliver({ [NAME]: 'off' });
    expect(await w.observe('flh')).toMatchObject(PROBED);
    w.advance(STYLE_SWITCH_POLL_MS);
    w.deliver({ [NAME]: 'on' });
    expect(await w.observe('flh')).toMatchObject(WHOLE);
    expect(await w.observe('flo8')).toMatchObject(WHOLE);
    expect(w.features).toContain(`option_switch_${NAME}_on_seen`);
  });

  it('a stale read (deliveries stopped) and an unreadable read put back the source default, not the off row', async () => {
    const w = opened();
    w.deliver({ [NAME]: 'off' });
    expect(await w.observe('flh')).toMatchObject(PROBED);
    // no delivery for longer than the stale window: the next job counts with the default
    w.advance(STYLE_SWITCH_STALE_MS + STYLE_SWITCH_POLL_MS);
    expect(await w.observe('flh')).toMatchObject(WHOLE);
    expect(w.features).toContain('option_switch_config_stale_seen');
    w.advance(STYLE_SWITCH_POLL_MS);
    w.deliver({ [NAME]: 'off' });
    expect(await w.observe('flh')).toMatchObject(PROBED);
    w.advance(STYLE_SWITCH_POLL_MS);
    w.deliver(null, 'unreadable');
    expect(await w.observe('flh')).toMatchObject(WHOLE);
  });

  it('no-limit and pot-limit counting is identical with no row, an off row and an on row', async () => {
    const tallies: Array<Record<string, number>> = [];
    const rows: Array<Record<string, string>> = [{}, { [NAME]: 'off' }, { [NAME]: 'on' }];
    for (const row of rows) {
      const w = opened();
      w.deliver(row);
      tallies.push({ ...(await w.observe('nlh')), ...prefixed(await w.observe('plo'), 'plo') });
      await open.splice(0)[0]!.close();
      vi.restoreAllMocks();
    }
    expect(tallies[0]!.ctBets).toBe(3);
    expect(tallies[0]!.ctProbes).toBe(3);
    expect(tallies[0]!.ploctBets).toBe(3);
    expect(tallies[1]).toEqual(tallies[0]);
    expect(tallies[2]).toEqual(tallies[0]);
  });
});

function prefixed(o: Record<string, number>, p: string): Record<string, number> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [p + k, v]));
}

describe('every process that counts applies the same value', () => {
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const strip = (text: string) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s\/\/.*$/gm, '');
  const files = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(join(SRC, dir))) {
      const rel = join(dir, name);
      if (statSync(join(SRC, rel)).isDirectory()) {
        if (name !== 'node_modules' && name !== 'dist') files(rel, out);
      } else if (rel.endsWith('.ts') && !/\.test\.ts$|\.test-support\.ts$|\.d\.ts$/.test(rel))
        out.push(rel);
    }
    return out;
  };

  it('the production callers of HorseMind.observe are the decision worker paths and nothing else', () => {
    const callers = files('.')
      .filter((rel) => !/^(scripts|benchmark|testing)\//.test(rel))
      .filter((rel) => /\bHorseMind\.observe\(/.test(strip(read(rel))))
      .sort();
    expect(callers).toEqual([
      'engine/HorseLogic.ts',
      'engine/horseDecision/observerReads.ts',
      'engine/horseDecision/workerRuntime.ts',
      'services/HorseMindHydrator.ts',
    ]);
    // the in-decision observation counts only with the mind on (a main-thread or offline decide passes mind: false)
    expect(strip(read('engine/HorseLogic.ts'))).toMatch(
      /if \(opts\.mind !== false && opts\.observeMind !== false\) \{\s*try \{\s*HorseMind\.observe\(/
    );
    // the boot replay is started by the decision worker's services only
    const hydrators = files('.')
      .filter((rel) => /\bhydrateHorseMind\(/.test(strip(read(rel))))
      .filter((rel) => rel !== 'services/HorseMindHydrator.ts');
    expect(hydrators.filter((rel) => !/^(scripts|benchmark|testing)\//.test(rel))).toEqual([
      'engine/horseDecision/workerRuntime.ts',
    ]);
  });

  it('the worker applies the switch before it dispatches every job, and at the fast decision own read', () => {
    const runtime = strip(read('engine/horseDecision/workerRuntime.ts'));
    expect(runtime).toMatch(
      // 2026-11-21: the second process switch (styleShiftReleaseIsNoiseAware) is applied from the same read
      /private applyProcessSwitches\(\): void \{\s*const states = this\.optionSwitch\.refresh\(performance\.now\(\)\);\s*const opts = optionSwitchDecisionOpts\(states\);\s*HorseMind\.applyFixedLimitBetsAreNeverProbesOption\(opts\);\s*HorseMind\.applyStyleShiftReleaseIsNoiseAwareOption\(opts\);\s*\}/
    );
    const execute = runtime.slice(runtime.indexOf('private async execute('));
    const applied = execute.indexOf('this.applyProcessSwitches();');
    expect(applied).toBeGreaterThan(0);
    for (const dispatch of [
      "if (request.type === 'DECIDE_FAST')",
      "request.type === 'DECIDE_DEEP'",
      "request.type === 'OBSERVE_COMPLETED_HAND'",
    ])
      expect(execute.indexOf(dispatch), dispatch).toBeGreaterThan(applied);
    expect(runtime).toMatch(
      /const optionBrainOpts = optionSwitchDecisionOpts\(optionStates\);\s*HorseMind\.applyFixedLimitBetsAreNeverProbesOption\(optionBrainOpts\);/
    );
    // nothing else sets the process switch in production
    const setters = files('.')
      .filter((rel) => !/^(scripts|benchmark|testing)\//.test(rel))
      .filter((rel) =>
        /setFixedLimitBetsAreNeverProbes\(|applyFixedLimitBetsAreNeverProbesOption\(/.test(
          strip(read(rel))
        )
      )
      .sort();
    expect(setters).toEqual(['engine/HorseMind.ts', 'engine/horseDecision/workerRuntime.ts']);
  });
});

// The per-decision style memo (aStyleReadIsReadOncePerDecision) keys on everything the read depends on. With F1
// switchable live, the switch value is one of those inputs (Hand Analysis 2026-11-16T00:02:19Z note D4): a flip
// between two reads in the same decision scope must give a fresh read, never the memo entry from the other state.
describe('a style read is never served across an F1 switch flip', () => {
  afterEach(() => {
    HorseMind.setFixedLimitBetsAreNeverProbes(FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT);
    HorseMind.setStyleReadMemo(true);
    HorseMind.setDecisionScope(null);
    HorseMind.reset();
  });
  it('re-reads after each flip in the same scope, and still uses the memo while the switch stands', () => {
    HorseMind.reset();
    HorseMind.setStyleReadMemo(true);
    HorseMind.setDecisionScope('holdem:full' as never, 'flh', 'cash');
    HorseMind.beginStyleReadMemo();
    HorseMind.takeStyleReadMemoCounts();
    HorseMind.styleRead(OPP);
    HorseMind.styleRead(OPP);
    expect(HorseMind.takeStyleReadMemoCounts()).toEqual({ hits: 1, misses: 1 });
    HorseMind.setFixedLimitBetsAreNeverProbes(!HorseMind.fixedLimitBetsAreNeverProbesOn());
    HorseMind.styleRead(OPP);
    HorseMind.styleRead(OPP);
    expect(HorseMind.takeStyleReadMemoCounts()).toEqual({ hits: 1, misses: 1 });
    HorseMind.setFixedLimitBetsAreNeverProbes(!HorseMind.fixedLimitBetsAreNeverProbesOn());
    HorseMind.styleRead(OPP);
    expect(HorseMind.takeStyleReadMemoCounts()).toEqual({ hits: 0, misses: 1 });
  });
});
