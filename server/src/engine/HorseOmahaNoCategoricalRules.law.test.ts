/**
 * LAW: WITH omahaNoCategoricalRules ON, NO CATEGORICAL RULE DECIDES A PLO4/PLO5 CASH ACTION, AND PLO6 IS
 * UNTOUCHED (lane UNBLOCK 2026-11-19; owner 8:37 PM Chicago: "Every decision needs to be made independently
 * on each and every hand. No law or rule should ever prevent the correct decision from happening."; owner
 * 8:27 PM: "DON'T TOUCH PLO6").
 *
 *  1. The option set: every name it switches off is a ledger flag; off or out of scope the decision runs
 *     with the very same options object (byte-identical).
 *  2. On the corpus of HorseOmahaNoBlanketRule (built heads-up spots and 56 real recorded Horse decisions,
 *     plus the paired-board spots against a labelled value leader) with production's live Omaha set, the
 *     categorical receipts of HorseOmahaRuleSites (every categorical and open site, the V81 / V84 / V86 big-bet
 *     cells among them) fire with the option off (the corpus reaches them) and NONE fires with it on, in PLO5
 *     and in PLO4.
 *  3. PLO6: the same recorded decisions dealt six cards are byte-identical (action, amount, receipts) on and off.
 *  4. Off: false and unset are byte-identical.
 * Hand ids only; no hole card of any opponent is read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  OMAHA_NO_CATEGORICAL_RULES_OFF,
  omahaNoCategoricalRulesInScope,
  withoutOmahaCategoricalRules,
} from './HorseOmahaNoCategoricalRules.js';
import { OMAHA_CATEGORICAL_RULE_SITES, OMAHA_OPEN_RULE_SITES } from './HorseOmahaRuleSites.js';
import {
  LIVE,
  LIVE_OPTIONS,
  pricedSpot,
  recordedState,
  type PricedSpot,
  type RecordedDecision,
} from './HorseOmahaPricedRules.test-support.js';
import RECORDED from './HorseOmahaPricedRules.fixture.json';

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const RECORDS = RECORDED as unknown as RecordedDecision[];
const ON: HorseDecideOpts = { ...LIVE_OPTIONS, omahaNoCategoricalRules: true };
const PATTERNS = [
  ...OMAHA_CATEGORICAL_RULE_SITES.flatMap((s) => s.legacyReceipts),
  ...OMAHA_OPEN_RULE_SITES.filter((s) => s.legacyOptions.some((o) => o !== 'v16SizeCond')).flatMap(
    (s) => s.legacyReceipts
  ),
];
const matches = (receipt: string, pattern: string): boolean =>
  pattern.endsWith('*') ? receipt.startsWith(pattern.slice(0, -1)) : receipt === pattern;
const categorical = (fires: readonly string[]): string[] =>
  fires.filter((f) => PATTERNS.some((p) => matches(f, p)));

const BUILT: PricedSpot[] = [
  ...['QcJd6c6d4h', '7c7d2s3s4c', 'Qc7c2s3s4c', '8c6c2s3s4d', 'KcTc2s3s4d', 'AdKd2c8s4s'].flatMap(
    (hole) => [1, 0.5, 0.33].map((f) => ({ hole, board: '9dQdJh7h', bet: Math.round(216 * f) }))
  ),
  ...['JcJs2s3s4c', 'QcJs5s3s4c', '5h3h2c8s4s', 'AhKh2c8s4s'].flatMap((hole) =>
    [1, 0.5].map((f) => ({ hole, board: '9dQdJh7h2h', bet: Math.round(216 * f) }))
  ),
  ...['AcQd6c5d2h', '9c9s6c5d2h', 'AhKh6c5d2c'].map((hole) => ({ hole, board: '9dQsQh7h3h' })),
  ...['AhKhJcTc2s', 'AhKh7c6c2s', 'JcTc8s7s2d', 'KhJh8c2c2s'].flatMap((hole) => [
    { hole, board: 'Qh9h3d' },
    { hole, board: 'Qh9h3d', inPosition: true },
  ]),
  ...['AcAd6c5d2h', 'QcQd6c5d2h', 'Ac5d6c4d2h'].map((hole) => ({
    hole,
    board: '9dQs3h7h',
    bet: 0,
    heroBetFlop: true,
  })),
  ...['AdAhKdJd4h', 'KdKhAdJd4h', 'AcAdKs4h2c'].flatMap((hole) =>
    ['8s6c9s', '9h7s3d'].flatMap((board) =>
      [false, true].map((inPosition) => ({ hole, board, bet: 0, inPosition }))
    )
  ),
  ...['AcQd6c5d2h', 'AcAd6c5d2h'].flatMap((hole) => [
    { hole, board: '9dQsQh7h', bet: 0, heroBetFlop: true },
    { hole, board: '9dQsQh7h3c', bet: 0, heroBetTurn: true },
  ]),
];
const stat = (mean: number, n: number) => ({ mean, n, engaged: null, excess: 0 });
const VALUE_LEADER = {
  hands: 400,
  measured: true,
  tightReRaiser: false,
  wideReRaiser: false,
  valueLeader: true,
  postflopAggressor: false,
  threeBet: stat(0.08, 200),
  betCheckedTo: stat(0.27, 300),
  foldToBet: stat(0.5, 120),
  riverCall: stat(0.2, 60),
};

/** The recorded decision dealt `n` hole cards (PLO4: the first four; PLO6: a sixth card no one shows). */
function dealt(r: RecordedDecision, n: 4 | 5 | 6): RecordedDecision {
  if (n === 5) return r;
  const hole = r.hole.match(/.{2}/g) ?? [];
  if (n === 4) return { ...r, variant: 'plo4', hole: hole.slice(0, 4).join('') };
  const used = new Set([...hole, ...(r.boards.join('').match(/.{2}/g) ?? [])]);
  const extra = ['2c', '2d', '2h', '2s', '3c', '3d', '3h', '3s'].find((c) => !used.has(c))!;
  return { ...r, variant: 'plo6', hole: [...hole, extra].join('') };
}

interface Played {
  where: string;
  action: string;
  amount: number | null;
  fires: string[];
}
function decide(build: () => unknown, opts: HorseDecideOpts, seed: number, leader = false) {
  HorseMind.reset();
  const st = build() as { hero: never; gs: never };
  if (leader) vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockReturnValue(VALUE_LEADER as never);
  drainFires();
  seedFastRandom(seed);
  const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
    telemetry: true,
    observeMind: false,
    decisionTimeMs: 1794938400000,
    ...opts,
  } as never);
  if (leader) vi.restoreAllMocks();
  return {
    action: String(d.action),
    amount: d.amount ?? null,
    fires: drainFires().map((f) => f.feature),
  };
}
function play(opts: HorseDecideOpts, holes: 4 | 5 | 6): Played[] {
  enableBrainTelemetry();
  const out: Played[] = [];
  for (const seed of [1, 7]) {
    if (holes === 5) {
      BUILT.forEach((s, i) =>
        out.push({ where: `built ${i}`, ...decide(() => pricedSpot(s), opts, seed) })
      );
      BUILT.filter((s) => s.bet === 0).forEach((s, i) =>
        out.push({ where: `leader ${i}`, ...decide(() => pricedSpot(s), opts, seed, true) })
      );
    }
    for (const r of RECORDS)
      out.push({
        where: `hand ${r.n} seat ${r.seat} ${r.street} plo${holes}`,
        ...decide(() => recordedState(dealt(r, holes)), opts, seed),
      });
  }
  return out;
}

describe('omahaNoCategoricalRules: the option set', () => {
  it('every option it switches off is a ledger flag, and the option itself is one', () => {
    const flags = new Set(HORSE_DATA_LEDGER.filter((e) => e.kind === 'flag').map((e) => e.key));
    expect(flags.has('omahaNoCategoricalRules')).toBe(true);
    expect(OMAHA_NO_CATEGORICAL_RULES_OFF.filter((o) => !flags.has(o))).toEqual([]);
  });
  it('off or out of scope the same options object runs; in scope every listed option is false', () => {
    const st = recordedState(RECORDS[0]) as unknown as { hero: never; gs: never };
    expect(omahaNoCategoricalRulesInScope(st.hero, st.gs)).toBe(true);
    expect(withoutOmahaCategoricalRules(LIVE_OPTIONS, st.hero, st.gs)).toBe(LIVE_OPTIONS);
    const on = withoutOmahaCategoricalRules(ON, st.hero, st.gs) as Record<string, unknown>;
    for (const o of OMAHA_NO_CATEGORICAL_RULES_OFF) expect(on[o], o).toBe(false);
    const six = recordedState(dealt(RECORDS[0], 6)) as unknown as { hero: never; gs: never };
    expect(omahaNoCategoricalRulesInScope(six.hero, six.gs)).toBe(false);
    expect(withoutOmahaCategoricalRules(ON, six.hero, six.gs)).toBe(ON);
    const tourney = { ...(st.gs as object), gameMode: 'tournament' } as never;
    expect(withoutOmahaCategoricalRules(ON, st.hero, tourney)).toBe(ON);
  });
});

describe('omahaNoCategoricalRules: no categorical rule decides a PLO4/PLO5 cash action', () => {
  it('PLO5: the corpus reaches the categorical rules with it off; none fires with it on', () => {
    const off = play(LIVE_OPTIONS, 5);
    const reached = [...new Set(off.flatMap((p) => categorical(p.fires)))].sort();
    console.log(
      `[law] plo5 decisions ${off.length}; categorical receipts with it off: ${reached.join(' ')}`
    );
    expect(reached.length).toBeGreaterThan(3);
    const on = play(ON, 5);
    expect(on.flatMap((p) => categorical(p.fires).map((f) => `${p.where}: ${f}`))).toEqual([]);
  }, 900000);
  it('PLO4: none fires with it on', () => {
    const on = play(ON, 4);
    expect(on.flatMap((p) => categorical(p.fires).map((f) => `${p.where}: ${f}`))).toEqual([]);
  }, 600000);
  it('PLO6: byte-identical on and off (action, amount and every receipt)', () => {
    const LIVE6: HorseDecideOpts = { ...LIVE_OPTIONS };
    // warm-up: once-per-process receipts (the reservoir's first-seen count) fire on the first play only
    play(LIVE6, 6);
    expect(play({ ...LIVE6, omahaNoCategoricalRules: true }, 6)).toEqual(play(LIVE6, 6));
  }, 600000);
  it('off: false and unset are byte-identical', () => {
    play(LIVE_OPTIONS, 4);
    expect(play({ ...LIVE_OPTIONS, omahaNoCategoricalRules: false }, 4)).toEqual(
      play(LIVE_OPTIONS, 4)
    );
    expect(play({ ...LIVE_OPTIONS, omahaNoCategoricalRules: false }, 5)).toEqual(
      play(LIVE_OPTIONS, 5)
    );
  }, 600000);
});
