/**
 * LAW: THE SPARRING BENCH LEARNS THE LIFETIME OPPONENT HUD, AND STAYS A MEASURING STICK
 * (PLO-OWNER lane REPLACEMENTS-3, 2026-11-21; lead ruling: one source of opponent reads = the HUD provider).
 *
 *  1. OFF-vs-OFF = 0 flips with the provider installed: two arms with the same options, each with its own store
 *     learning its own hands, play every deal of every pair identically (PLO4 and PLO5, heads-up and six-max).
 *  2. A scripted folder's fold-to-raise read CONVERGES TO ITS SCRIPTED RATE: the store's lifetime f.fRaise count of
 *     the scripted seat equals the script's own tally exactly, and the installed read (hudStat) moves from the prior
 *     to the scripted rate by n/(n+k).
 *  3. NO HOLE CARD REACHES THE STORE: the store's hand type has no field for one, the harness hands it the board,
 *     the line and hand NAMES only, and no card string is in any profile it builds.
 *  4. Pre-loading is DATA: a block exported and read back gives the next block the same start in every arm (the
 *     control still parts nowhere), its hands are added to the pre-loaded ones, and a store is never warmed by play.
 *  5. Benchmark-only: no runtime source imports SparringHud.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HorseDecideOpts } from '../engine/HorseLogic.js';
import * as OS from '../engine/HorseOptionSwitch.js';
import {
  clearDecisionHud,
  hudStat,
  installDecisionHud,
} from '../engine/opponentHud/OpponentHud.js';
import { exploiterSpotHelpers as H, type ExploiterPolicy } from './ExploiterLeague.js';
import { SPARRING_PROBES, runSparringCell, type SparringVariant } from './SparringLeague.js';
import {
  HUD_BENCH_HAND_MS,
  HUD_BENCH_T0,
  SparringHudStore,
  type SparringHudHand,
} from './SparringHud.js';

process.env.EQUITY_GOVERNOR = 'off';
const PAIRS = Number(process.env.SPARRING_LAW_PAIRS) || 60;

function liveOpts(): HorseDecideOpts {
  const all = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'sparring-live-switches-20261120.json'), 'utf8')
  ) as Record<string, string>;
  const cfg = (options: Record<string, string>) => ({
    version: 2,
    style: { version: 1, options: {} },
    options,
  });
  const kept: Record<string, string> = {};
  for (const [k, v] of Object.entries(all))
    if (OS.parseOptionSwitchConfig(cfg({ [k]: v })).ok) kept[k] = v;
  const parsed = OS.parseOptionSwitchConfig(cfg(kept));
  if (!parsed.ok) throw new Error('switch fixture invalid');
  return OS.optionSwitchDecisionOpts(parsed.states) as HorseDecideOpts;
}

/** every string anywhere in a value */
function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const v of x) strings(v, out);
  else if (x && typeof x === 'object')
    for (const [k, v] of Object.entries(x)) {
      out.push(k);
      strings(v, out);
    }
  return out;
}
const CARD = /^(10|[2-9TJQKA])[:]?(h|d|c|s|hearts|diamonds|clubs|spades)$/i;

afterEach(() => clearDecisionHud());

const CELLS: Array<{ variant: SparringVariant; seats: number }> = [
  { variant: 'plo4', seats: 2 },
  { variant: 'plo5', seats: 2 },
  { variant: 'plo4', seats: 6 },
  { variant: 'plo5', seats: 6 },
];

describe('LAW 1: OFF-vs-OFF = 0 flips with the HUD provider installed and learning', () => {
  for (const { variant, seats } of CELLS) {
    it(`${variant} ${seats}-max: ${PAIRS} pairs, the control parts nowhere and both stores learned every hand`, async () => {
      const base = liveOpts();
      const r = await runSparringCell({
        name: 'probe:threebet_every_open',
        policy: SPARRING_PROBES.threebet_every_open,
        variant,
        seats,
        stackBB: 100,
        pairs: PAIRS,
        seed: 20261150,
        bbAnte: variant === 'plo5' ? 1 : 0,
        mirror: true,
        keepPerHand: true,
        hud: { priors: { 'f.fRaise': [0.5, 20] }, exportProfiles: true },
        arms: [
          { label: 'BASE', horseOpts: base },
          { label: 'CTRL', horseOpts: { ...base } },
        ],
      });
      const [b, c] = r.arms;
      const f = c.flips!;
      expect(f.main.hands).toBe(PAIRS);
      expect(f.main.handsDiffering).toBe(0);
      expect(f.main.flips).toEqual({});
      expect(f.mirror!.handsDiffering).toBe(0);
      expect(c.vsArm0Bb100).toBe(0);
      expect(c.vsArm0Se).toBe(0);
      expect(c.perHandLine).toEqual(b.perHandLine);
      expect(c.perHandMirrorLine).toEqual(b.perHandMirrorLine);
      expect(r.hud).toHaveLength(2);
      for (const h of r.hud!) {
        for (const s of [h.main, h.mirror!]) {
          expect(s.hands).toBe(PAIRS);
          expect(s.refused).toBe(0);
          expect(s.applied).toBe(PAIRS * seats);
          expect(s.packets).toBeGreaterThan(PAIRS);
          expect(s.profiles).toHaveLength(seats);
          for (const p of s.profiles!) expect(p.hands).toBe(PAIRS);
          // LAW 3 (dynamic): no card string anywhere in what the store built
          expect(strings(s.profiles).filter((x) => CARD.test(x))).toEqual([]);
        }
      }
      // identical arms learned identical stores
      expect(JSON.stringify(r.hud![1].main.profiles)).toBe(JSON.stringify(r.hud![0].main.profiles));
      expect(JSON.stringify(r.hud![1].mirror!.profiles)).toBe(
        JSON.stringify(r.hud![0].mirror!.profiles)
      );
    }, 900_000);
  }

  it('without spec.hud nothing is installed or reported (the bench as before)', async () => {
    const base = liveOpts();
    const r = await runSparringCell({
      name: 'probe:threebet_every_open',
      policy: SPARRING_PROBES.threebet_every_open,
      variant: 'plo4',
      seats: 2,
      stackBB: 100,
      pairs: 8,
      seed: 20261150,
      mirror: true,
      arms: [{ label: 'BASE', horseOpts: base }],
    });
    expect(r.hud).toBeUndefined();
  }, 300_000);
});

describe('LAW 2: a scripted folder is read at its scripted rate', () => {
  const users = ['league-human-1', 'league-2'];
  /** seat 0 bets the flop, seat 1 raises, seat 0 folds unless `calls` */
  const hand = (pair: number, calls: boolean): SparringHudHand => ({
    pair,
    deal: 'main',
    seed: 7,
    variant: 'plo4',
    bigBlind: 2,
    smallBlind: 1,
    ante: 0,
    buttonSeat: 2,
    users,
    stack: 200,
    actions: [
      { seatIdx: 1, stage: 'preflop', action: 'raise', amount: 6 },
      { seatIdx: 0, stage: 'preflop', action: 'call', amount: 4 },
      { seatIdx: 0, stage: 'flop', action: 'bet', amount: 8 },
      { seatIdx: 1, stage: 'flop', action: 'raise', amount: 28 },
      calls
        ? { seatIdx: 0, stage: 'flop', action: 'call', amount: 20 }
        : { seatIdx: 0, stage: 'flop', action: 'fold', amount: 0 },
      ...(calls
        ? ([
            { seatIdx: 0, stage: 'turn', action: 'check', amount: 0 },
            { seatIdx: 1, stage: 'turn', action: 'check', amount: 0 },
            { seatIdx: 0, stage: 'river', action: 'check', amount: 0 },
            { seatIdx: 1, stage: 'river', action: 'check', amount: 0 },
          ] as const)
        : []),
    ],
    board: calls ? ['Ah', '7d', '2c', '9s', '3h'] : ['Ah', '7d', '2c'],
    shown: calls
      ? [
          { seatIdx: 0, handName: 'Pair' },
          { seatIdx: 1, handName: 'Two Pair' },
        ]
      : [],
    winnings: calls ? [0, 68] : [0, 20],
  });

  it('the lifetime count is the script, and the installed read goes from the prior to 90% by n/(n+k)', () => {
    const prior: [number, number] = [0.5, 20];
    const store = new SparringHudStore('plo4', { 'f.fRaise': prior });
    const read = (pair: number) => {
      store.install(users, 1, 'flop', pair);
      return hudStat('league-human-1', 'plo4', 'f.fRaise');
    };
    const first = read(0);
    expect(first.source).toBe('prior');
    expect(first.p).toBe(0.5);
    let folds = 0;
    const seen: number[] = [];
    for (let p = 0; p < 400; p++) {
      const calls = p % 10 === 9;
      if (!calls) folds++;
      store.learn(hand(p, calls));
      if (p === 9 || p === 99 || p === 399) seen.push(read(p + 1).p!);
    }
    expect(store.counts.refused).toBe(0);
    expect(store.profileOf('league-human-1')!.life['f.fRaise']).toEqual([400, 360]);
    expect(folds).toBe(360);
    const last = read(400);
    expect(last.source).toBe('lifetime');
    expect(last.raw!).toBeCloseTo(0.9, 3);
    // shrinkage, no cliff: each read is (hits + k x prior) / (n + k), nearer 0.9 the more hands he has shown
    expect(last.p!).toBeCloseTo((last.hits + last.k * 0.5) / (last.n + last.k), 9);
    expect(seen[0]).toBeGreaterThan(0.5);
    expect(seen[1]).toBeGreaterThan(seen[0]);
    expect(seen[2]).toBeGreaterThan(seen[1]);
    expect(seen[2]).toBeGreaterThan(0.85);
    expect(seen[2]).toBeLessThanOrEqual(0.9);
    // the raiser's own profile holds no fold-to-raise opportunity, and the hero is not in his own packet
    expect(store.profileOf('league-2')!.life['f.fRaise']).toBeUndefined();
    expect(Object.keys(store.packetFor(users, 1, 'flop', store.clockMs(400)).opp)).toEqual([
      'league-human-1',
    ]);
    // with no packet installed the same read is the caller's prior exactly
    installDecisionHud(null);
    expect(hudStat('league-human-1', 'plo4', 'f.fRaise', 0.5).source).toBe('prior');
  });

  it("on the bench: the Horses hold exactly the scripted seat's own tally of folds to a flop raise", async () => {
    const tally = { n: 0, fold: 0 };
    let k = 0;
    const folder: ExploiterPolicy = (s, horse) => {
      if (s.stage !== 'flop') return horse();
      const mine = s.history.filter((a) => a.stage === 'flop' && a.userId === s.userId);
      const last = mine[mine.length - 1]?.action;
      if (s.toCall > 0 && (last === 'bet' || last === 'raise')) {
        tally.n++;
        if (k++ % 10 === 9 && s.legalActions.includes('call')) return { action: 'call' };
        tally.fold++;
        return { action: 'fold' };
      }
      if (s.toCall <= 0 && mine.length === 0) return H.potWager(s, 1);
      return horse();
    };
    const r = await runSparringCell({
      name: 'profile:scripted_folder',
      policy: folder,
      variant: 'plo4',
      seats: 2,
      stackBB: 100,
      pairs: Math.max(PAIRS, 120),
      seed: 20261150,
      hud: { exportProfiles: true },
      arms: [{ label: 'BASE', horseOpts: liveOpts() }],
    });
    const p = r.hud![0].main.profiles!.find((x) => x.user === 'league-human-1')!;
    expect(tally.n).toBeGreaterThan(0);
    expect(p.life['f.fRaise']).toEqual([tally.n, tally.fold]);
    expect(r.hud![0].mirror).toBeNull();
  }, 900_000);
});

describe('LAW 3: no hole card reaches the store', () => {
  const code = (f: string) =>
    readFileSync(join(__dirname, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  it('the store file names no card of a player and imports no card type', () => {
    const src = code('SparringHud.ts');
    expect(/\bcards\b|\bhole\b|\bCard\b|holeCards/.test(src)).toBe(false);
  });
  it('the harness hands the store the line, the board, the chips won and hand names: never e.cards', () => {
    const src = code('SparringLeague.ts');
    const learn = src.slice(src.indexOf('hud?.learn({'));
    const call = learn.slice(0, learn.indexOf('});'));
    expect(call.length).toBeGreaterThan(100);
    expect(/cards/.test(call)).toBe(false);
    expect(call).toContain('sparringBoardKeys(e.board)');
    expect(call).toContain('shown: e.shown');
  });
});

describe('LAW 4: a pre-loaded store is data, the same in every arm, and its hands add up', () => {
  it('block A exported, read back as JSON, pre-loads block B: control parts nowhere, hands A + B', async () => {
    const base = liveOpts();
    const cell = (seed: number, pairs: number, preload?: unknown[]) =>
      runSparringCell({
        name: 'probe:threebet_every_open',
        policy: SPARRING_PROBES.threebet_every_open,
        variant: 'plo4',
        seats: 2,
        stackBB: 100,
        pairs,
        seed,
        mirror: true,
        keepPerHand: true,
        hud: { exportProfiles: true, ...(preload ? { preload } : {}) },
        arms: [
          { label: 'BASE', horseOpts: base },
          { label: 'CTRL', horseOpts: { ...base } },
        ],
      });
    const a = await cell(20261149, 20);
    const data = JSON.parse(JSON.stringify(a.hud![0].main.profiles)) as unknown[];
    const b = await cell(20261150, 24, data);
    expect(b.arms[1].flips!.main.handsDiffering).toBe(0);
    expect(b.arms[1].flips!.mirror!.handsDiffering).toBe(0);
    for (const h of b.hud!)
      for (const s of [h.main, h.mirror!]) {
        expect(s.refused).toBe(0);
        for (const p of s.profiles!) expect(p.hands).toBe(44);
      }
    // the pre-loaded data itself was not touched (every store works on its own copy)
    expect((data[0] as { hands: number }).hands).toBe(20);
    // the store's clock starts one hand after the newest pre-loaded hand
    const st = new SparringHudStore('plo4', {}, data);
    expect(st.t0).toBe(HUD_BENCH_T0 + 20 * HUD_BENCH_HAND_MS);
    expect(new SparringHudStore('plo4').t0).toBe(HUD_BENCH_T0);
  }, 900_000);
});

describe('LAW 5: the bench store is benchmark-only', () => {
  const SRC = join(__dirname, '..');
  const IMPORT =
    /from\s+['"][^'"]*\/SparringHud(\.js)?['"]|import\(\s*['"][^'"]*\/SparringHud(\.js)?['"]/;
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) out.push(p);
    }
    return out;
  }
  it('no runtime source imports it, and the scan sees the engine', () => {
    const files = walk(SRC).map((p) => ({ p, rel: relative(SRC, p).split(sep).join('/') }));
    expect(
      files
        .filter((f) => !f.rel.startsWith('benchmark/'))
        .filter((f) => IMPORT.test(readFileSync(f.p, 'utf8')))
        .map((f) => f.rel)
    ).toEqual([]);
    expect(files.some((f) => f.rel === 'engine/HorseLogic.ts')).toBe(true);
    expect(files.some((f) => f.rel === 'benchmark/SparringHud.ts')).toBe(true);
  });
});
