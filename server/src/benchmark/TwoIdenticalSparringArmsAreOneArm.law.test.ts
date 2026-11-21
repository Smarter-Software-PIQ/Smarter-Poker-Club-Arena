/**
 * LAW (BENCH-FIX, 2026-11-21): THE SPARRING BENCH IS A MEASURING STICK.
 *
 * 1. Two arms with the same option set are the same arm: on the same seed and deal an OFF-vs-OFF run
 *    has exactly 0 flips and a 0.0 chip difference, for PLO4 and PLO5, heads-up and six-max.
 *    Root cause this pins: runSparringCell called playHand without a hand clock, so every deal took
 *    the next slot of HorseLeague's process-wide timestamp counter. The brain keys per-hand draws on
 *    `timestamp:userId` (the persona indifference band, chart adherence), so the BASE arm, the
 *    candidate arm and each arm's mirror drew DIFFERENT mixes for the same seat on the same cards and
 *    parted with no option between them (134 flips of 1,000 in a six-max control on 2026-11-21).
 *    Every deal of a pair is now dealt on leaguePairHandClock(pair, seed), as the league runners are.
 * 2. An arm's hands depend on its own option set, the seed and the deal, never on which other arms
 *    share the cell or in what order they play (no state crosses between arms).
 * 3. Legality is counted by who acted: a refused answer of the adversary script, of the Horse brain
 *    in seat 0 and of an opposing Horse seat land on three separate counters, and the script's own
 *    wager is inside the legal range by construction, so a verdict's hard flag reads Horse seats only.
 *
 * EQUITY_GOVERNOR must be off for a bench process (scripts/sparring.sh sets it): the governor cuts the
 * Monte Carlo sample when the event loop lags, which is a decision that depends on the machine's load.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from '../engine/HorseLogic.js';
import * as OS from '../engine/HorseOptionSwitch.js';
import { calculateBettingState, validateAction } from '../engine/PokerEngine.js';
import { exploiterSpotHelpers as H } from './ExploiterLeague.js';
import { dealMoodClockMs, leaguePairHandClock, type LeagueSeatSpot } from './HorseLeague.js';
import {
  SPARRING_PROBES,
  SPARRING_PROFILES,
  addSparringFlipHand,
  guardFamilyZ,
  newSparringFlipDeal,
  runSparringCell,
  sparringLegalWagerTo,
  sparringProfilePolicy,
  type SparringCellResult,
  type SparringVariant,
} from './SparringLeague.js';

process.env.EQUITY_GOVERNOR = 'off';
const PAIRS = Number(process.env.SPARRING_LAW_PAIRS) || 60;

/** The live switch set of Nov 20 2026, through this tree's own parser (as scripts/sparring.sh does). */
function liveOpts(over: Record<string, string> = {}): HorseDecideOpts {
  const all = {
    ...(JSON.parse(
      readFileSync(join(__dirname, 'fixtures', 'sparring-live-switches-20261120.json'), 'utf8')
    ) as Record<string, string>),
    ...over,
  };
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

const CELLS: Array<{ variant: SparringVariant; seats: number }> = [
  { variant: 'plo4', seats: 2 },
  { variant: 'plo5', seats: 2 },
  { variant: 'plo4', seats: 6 },
  { variant: 'plo5', seats: 6 },
];

const zeroCounts = { illegal: 0, brainFallback: 0, corrected: 0 };

describe('LAW: two identical sparring arms are one arm (OFF-vs-OFF = 0 flips, 0.0 chips)', () => {
  for (const { variant, seats } of CELLS) {
    for (const adversary of ['probe:threebet_every_open', 'profile:aggro_reg'] as const) {
      it(`${variant} ${seats}-max vs ${adversary}: ${PAIRS} pairs, control parts nowhere`, async () => {
        const base = liveOpts();
        const probe = adversary.startsWith('probe:');
        const r = await runSparringCell({
          name: adversary,
          policy: probe
            ? SPARRING_PROBES.threebet_every_open
            : sparringProfilePolicy(SPARRING_PROFILES.aggro_reg),
          variant,
          seats,
          stackBB: 100,
          pairs: PAIRS,
          seed: 20261150,
          bbAnte: variant === 'plo5' ? 1 : 0,
          mirror: probe,
          keepPerHand: true,
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
        expect(f.main.netDiffHands).toBe(0);
        expect(c.vsArm0Bb100).toBe(0);
        expect(c.vsArm0Se).toBe(0);
        expect(c.perHand).toEqual(b.perHand);
        expect(c.perHandLine).toEqual(b.perHandLine);
        if (probe) {
          expect(f.mirror!.handsDiffering).toBe(0);
          expect(f.mirror!.netDiffHands).toBe(0);
          expect(c.perHandMirror).toEqual(b.perHandMirror);
          expect(c.perHandMirrorLine).toEqual(b.perHandMirrorLine);
        }
        // The denominator is real: Horse-seat decisions were compared on every street reached.
        expect(f.main.compared['horse|preflop']).toBeGreaterThan(PAIRS / 2);
        // Property over the states these hands reached: no seat class asked for a refused wager.
        for (const a of r.arms) {
          expect(a.bySeat.horse).toEqual(zeroCounts);
          expect(a.bySeat.seat0Brain).toEqual(zeroCounts);
          expect(a.bySeat.scripted).toEqual(zeroCounts);
          expect(a.truncated).toBe(0);
        }
      }, 900_000);
    }
  }
});

describe('LAW: every deal of a pair is dealt on one hand clock and one mood hour (the mechanism)', () => {
  it('every brain decision of pair p, in every arm and deal, sees leaguePairHandClock(p, seed) and dealMoodClockMs', async () => {
    const pairs = 12;
    const seed = 20261153;
    const seen = new Map<number, Set<number | undefined>>();
    let withoutClock = 0;
    const spy = vi.spyOn(HorseLogic, 'decide');
    try {
      const base = liveOpts();
      await runSparringCell({
        name: 'clock',
        policy: SPARRING_PROBES.threebet_every_open,
        variant: 'plo5',
        seats: 6,
        stackBB: 100,
        pairs,
        seed,
        bbAnte: 1,
        mirror: true,
        arms: [
          { label: 'BASE', horseOpts: base },
          { label: 'CAND', horseOpts: { ...base, omahaRiverCheckedToBetIsMeasured: true } },
          { label: 'CTRL', horseOpts: { ...base } },
        ],
      });
      for (const call of spy.mock.calls) {
        const gs = call[1] as { actionHistory?: Array<{ timestamp: number }> };
        const opts = (call[4] ?? {}) as HorseDecideOpts;
        if (typeof opts.decisionTimeMs !== 'number') withoutClock++;
        const first = gs.actionHistory?.[0]?.timestamp;
        if (first === undefined) continue;
        if (!seen.has(first)) seen.set(first, new Set());
        seen.get(first)!.add(opts.decisionTimeMs);
      }
    } finally {
      spy.mockRestore();
    }
    expect(spy).toBeDefined();
    expect(withoutClock).toBe(0);
    // One first-action timestamp per pair, shared by 3 arms x 2 deals: the pair's own hand clock.
    const expected = new Map<number, number>();
    for (let p = 0; p < pairs; p++) {
      const handSeed = (seed ^ (p * 2654435761)) >>> 0 || 1;
      expected.set(leaguePairHandClock(p, seed) + 1, dealMoodClockMs(handSeed));
    }
    expect([...seen.keys()].sort((x, y) => x - y)).toEqual(
      [...expected.keys()].sort((x, y) => x - y)
    );
    for (const [ts, moods] of seen) expect([...moods]).toEqual([expected.get(ts)]);
  }, 600_000);

  it('the wall-clock hour does not reach a bench decision: two mood hours, the same hands', async () => {
    const KEY = '__smarterPokerHorseMoodClockMs';
    const g = globalThis as Record<string, unknown>;
    const before = g[KEY];
    const at = async (hour: number) => {
      g[KEY] = hour * 3_600_000 + 1000;
      const r = await runSparringCell({
        name: 'mood',
        policy: SPARRING_PROBES.pot_stab_turn_river,
        variant: 'plo4',
        seats: 6,
        stackBB: 100,
        pairs: 30,
        seed: 20261154,
        mirror: true,
        keepPerHand: true,
        arms: [{ label: 'BASE', horseOpts: liveOpts() }],
      });
      return [r.arms[0].perHandLine, r.arms[0].perHandMirrorLine, r.arms[0].perHand];
    };
    try {
      expect(await at(3)).toEqual(await at(15));
    } finally {
      if (before === undefined) delete g[KEY];
      else g[KEY] = before;
    }
  }, 600_000);
});

describe('LAW: an arm depends on its own options, the seed and the deal only', () => {
  it('alone, first or second in the cell, an arm plays the same hands', async () => {
    const a = liveOpts();
    const b = liveOpts({
      omahaRiverCheckedToBetIsMeasured: 'on',
      omahaRiverFirstToActBetIsPriced: 'on',
    });
    const cell = (arms: Array<{ label: string; horseOpts: HorseDecideOpts }>) =>
      runSparringCell({
        name: 'iso',
        policy: SPARRING_PROBES.pot_stab_turn_river,
        variant: 'plo5',
        seats: 2,
        stackBB: 100,
        pairs: PAIRS,
        seed: 20261151,
        bbAnte: 1,
        mirror: true,
        keepPerHand: true,
        // The probe's own brain in seat 0 is pinned (the default is arm 0's set, which is the cell's
        // first arm by design); what is under test is the opposing Horses of each arm.
        seat0Opts: a,
        arms,
      });
    const pick = (r: SparringCellResult, label: string) => {
      const x = r.arms.find((y) => y.label === label)!;
      return [x.perHand, x.perHandLine, x.perHandMirror, x.perHandMirrorLine];
    };
    const ab = await cell([
      { label: 'A', horseOpts: a },
      { label: 'B', horseOpts: b },
    ]);
    const ba = await cell([
      { label: 'B', horseOpts: b },
      { label: 'A', horseOpts: a },
    ]);
    const onlyA = await cell([{ label: 'A', horseOpts: a }]);
    const onlyB = await cell([{ label: 'B', horseOpts: b }]);
    expect(pick(ab, 'A')).toEqual(pick(onlyA, 'A'));
    expect(pick(ba, 'A')).toEqual(pick(onlyA, 'A'));
    expect(pick(ab, 'B')).toEqual(pick(onlyB, 'B'));
    expect(pick(ba, 'B')).toEqual(pick(onlyB, 'B'));
  }, 900_000);
});

describe('LAW: legality is counted by who acted, and the script is legal by construction', () => {
  const cell = (policy: Parameters<typeof runSparringCell>[0]['policy']) =>
    runSparringCell({
      name: 'who',
      policy,
      variant: 'plo4',
      seats: 2,
      stackBB: 100,
      pairs: 30,
      seed: 20261152,
      arms: [{ label: 'BASE', horseOpts: liveOpts() }],
    });

  it('a script asking for more than the pot is moved onto the range: no illegal action, the move is counted', async () => {
    const r = await cell((s) =>
      s.minRaiseTo !== null
        ? { action: s.currentBet > 0 ? 'raise' : 'bet', amount: 1e7 + 0.333 }
        : H.call(s)
    );
    const a = r.arms[0];
    expect(a.scriptedSnapped).toBeGreaterThan(0);
    expect(a.illegal).toBe(0);
    expect(a.bySeat.scripted.illegal).toBe(0);
  }, 300_000);

  it('a refused answer of the Horse brain in seat 0 lands on seat0Brain, never on the Horse seats or the script', async () => {
    const r = await cell((s, horse) => {
      const h = horse() as { action: string; amount?: number };
      if (s.minRaiseTo !== null && s.maxRaiseTo !== null) {
        // The brain's own answer object, made illegal in place: the harness must not repair it.
        h.action = s.currentBet > 0 ? 'raise' : 'bet';
        h.amount = s.maxRaiseTo + 1000;
      }
      return h;
    });
    const a = r.arms[0];
    expect(a.bySeat.seat0Brain.illegal).toBeGreaterThan(0);
    expect(a.bySeat.seat0Brain.illegal).toBe(a.illegal);
    expect(a.bySeat.horse.illegal).toBe(0);
    expect(a.bySeat.scripted.illegal).toBe(0);
    expect(a.scriptedSnapped).toBe(0);
  }, 300_000);

  it('random states: the harness wager validates against the engine (min-raise, pot limit, stack)', () => {
    let a = 0x51ed270b;
    const rnd = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const cents = (x: number) => Math.round(x * 100) / 100;
    let checked = 0;
    for (let i = 0; i < 200_000; i++) {
      const potLimit = rnd() < 0.85;
      const currentBet = rnd() < 0.4 ? 0 : cents(2 + rnd() * 120);
      const myBet = currentBet > 0 && rnd() < 0.5 ? cents(rnd() * currentBet) : 0;
      const lastRaise = currentBet > 0 ? cents(Math.max(2, rnd() * currentBet)) : 2;
      const pot = cents(currentBet + myBet + rnd() * 400);
      const stack = cents(1 + rnd() * 600);
      const toCall = Math.max(0, currentBet - myBet);
      const stackTo = myBet + stack;
      const maxTo = Math.min(stackTo, potLimit ? currentBet + pot + toCall : Infinity);
      const minTo = currentBet > 0 ? currentBet + Math.max(2, lastRaise) : 2;
      if (!(maxTo > currentBet && maxTo >= minTo)) continue;
      const want = rnd() < 0.3 ? maxTo + rnd() * 3 : minTo - 2 + rnd() * (maxTo - minTo + 4);
      const amount = sparringLegalWagerTo(minTo, maxTo, want);
      if (amount >= stackTo) continue; // the street engine plays that as all-in
      const bs = calculateBettingState(pot, currentBet, myBet, 2, lastRaise, potLimit);
      const v = validateAction((currentBet > 0 ? 'raise' : 'bet') as never, amount, stack, bs);
      if (!v.valid) throw new Error(`${v.error}: ${amount} in [${minTo}, ${maxTo}] want ${want}`);
      expect(amount).toBeGreaterThanOrEqual(minTo - 0.005);
      expect(amount).toBeLessThanOrEqual(maxTo + 1e-9);
      checked++;
    }
    expect(checked).toBeGreaterThan(100_000);
  });

  it('hashRand is a draw in [0, 1): a p-branch fires p of the time, not p + (1 - p) / 2', () => {
    let below = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const spot = {
        cards: [
          { rank: 'A', suit: 's' },
          { rank: String((i % 8) + 2), suit: 'h' },
        ],
        board: [],
        history: { length: i % 7 },
        pot: i,
      } as unknown as LeagueSeatSpot;
      const x = H.hashRand(spot, 11);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      if (x < 0.45) below++;
    }
    expect(below / N).toBeGreaterThan(0.42);
    expect(below / N).toBeLessThan(0.48);
  });
});

describe('flip counting and the guard family bar', () => {
  it('counts the first divergence by seat class, street and change class, with its denominator', () => {
    const f = newSparringFlipDeal();
    const line = (xs: Array<[number, string, string, number]>) =>
      xs.map(([s, st, a, m]) => ({ s, st, a, m }));
    const base = line([
      [1, 'preflop', 'raise', 7],
      [0, 'preflop', 'call', 5],
      [0, 'flop', 'check', 0],
      [1, 'flop', 'bet', 10],
      [0, 'flop', 'fold', 0],
    ]);
    addSparringFlipHand(f, base, base, 0, 1, 1);
    addSparringFlipHand(
      f,
      base,
      [...base.slice(0, 3), { s: 1, st: 'flop', a: 'check', m: 0 }],
      1,
      1,
      2.5
    );
    addSparringFlipHand(f, base, [{ s: 1, st: 'preflop', a: 'raise', m: 8 }], 2, 1, 1);
    addSparringFlipHand(f, base, [base[0], { s: 0, st: 'preflop', a: 'fold', m: 0 }], 3, 1, 0);
    expect(f.hands).toBe(4);
    expect(f.handsDiffering).toBe(3);
    expect(f.firstDifferingHand).toBe(1);
    expect(f.flips).toEqual({
      'horse|flop|bet->check': 1,
      'horse|preflop|size': 1,
      'seat0|preflop|call->fold': 1,
    });
    // hand 0: 1 preflop + 1 flop Horse decisions; hand 1: the same up to the parting flop bet; hand 2: the
    // parting open; hand 3: the open only (the script parted next).
    expect(f.compared['horse|preflop']).toBe(4);
    expect(f.compared['horse|flop']).toBe(2);
    expect(f.compared['seat0|preflop']).toBe(3);
    expect(f.netDiffHands).toBe(2);
    expect(f.netAbsDiffBb).toBe(2.5);
  });

  it('z_fam(m) is the standard-normal quantile of 0.8413^(1/m) (LEAD-3 RULING 1)', () => {
    const table: Array<[number, string]> = [
      [1, '1.00'],
      [6, '1.90'],
      [11, '2.15'],
      [12, '2.19'],
      [24, '2.45'],
      [48, '2.69'],
    ];
    for (const [m, z] of table) expect(guardFamilyZ(m).toFixed(2)).toBe(z);
    // The ruling's table prints 2.80 for m = 66; its formula gives 2.7925. The formula is the rule.
    expect(guardFamilyZ(66)).toBeCloseTo(2.7925, 3);
    expect(() => guardFamilyZ(0)).toThrow();
  });
});

describe('LAW: the overlay points every import of the harness at the tree under test', () => {
  const repo = join(__dirname, '..', '..', '..');
  const script = join(repo, 'scripts', 'sparring.sh');
  const fixture = join(__dirname, 'fixtures', 'sparring-live-switches-20261120.json');
  const run = (league: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'sparring-overlay-'));
    try {
      writeFileSync(join(dir, 'SparringLeague.ts'), league);
      // the overlay carries the bench's HUD store too (2026-11-21, SparringLearnsTheHud.law.test.ts)
      writeFileSync(
        join(dir, 'SparringHud.ts'),
        "import { y } from './HudHistoryRows.js';\nimport { z } from '../engine/opponentHud/OpponentHud.js';\nvoid y;\nvoid z;\n"
      );
      writeFileSync(
        join(dir, 'sparringRun.ts'),
        "import { x } from './SparringLeague.js';\nvoid x;\n"
      );
      const out = join(dir, 'out');
      let status = 0;
      let text = '';
      try {
        text = execFileSync('bash', [script, repo, '-'], {
          env: {
            ...process.env,
            SPARRING_SRC: dir,
            SPARRING_OVERLAY_ONLY: '1',
            OUT: out,
            BASE: fixture,
          },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e) {
        status = (e as { status?: number }).status ?? 1;
        text = String((e as { stdout?: string }).stdout ?? '');
      }
      let written = '';
      try {
        written = readFileSync(join(out, 'overlay', 'SparringLeague.ts'), 'utf8');
      } catch {
        written = '';
      }
      return { status, text, written };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('static, side-effect and dynamic imports of the engine all resolve inside the tree', () => {
    const r = run(
      "import { a } from '../engine/A.js';\nimport '../engine/B.js';\n" +
        "export const x = async () => (await import('../engine/C.js'), await import('./HorseLeague.js'), a);\n"
    );
    expect(r.status).toBe(0);
    for (const m of ['engine/A.js', 'engine/B.js', 'engine/C.js', 'benchmark/HorseLeague.js'])
      expect(r.written).toContain(`'${repo}/server/src/${m}'`);
    expect(r.written).not.toMatch(/['"]\.\.\//);
  });

  it('refuses to run with a relative engine import it could not rewrite (a second module instance)', () => {
    const r = run('export const x = async () => import("../engine/C.js");\n');
    expect(r.status).toBe(2);
    expect(r.text).toMatch(/relative import not rewritten/);
  });
});
