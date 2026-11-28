/**
 * LAW - A WAITING GAME KEEPS ITS FIRST-OWED CLOCK THROUGH A RELEASE (2026-11-28).
 *
 * Measured live on the 1 AM CST release of 2026-11-28 (2b3b3647d3a6, the first
 * build to publish detail.variety_owed_since): the fleet's last beat before
 * the stop was 12:57:43 AM with nine games owed, its first beat after the
 * restart was 1:05:19 AM, and all nine games read 1:05:15 AM as their
 * first-owed time. The memory was a private field of the fleet process, which
 * restarts at every release, so every wait already running was cut to zero
 * exactly when the live check reads it.
 *
 * Now the fleet reads, ONCE per boot, the newest heartbeat written before it
 * started, and the first seating cycle keeps that beat's first-owed time for
 * every game still owed (HorseVarietyFirst.carriedOwedSince, guarded by an
 * age bound and a ceiling). It feeds the heartbeat only: no decision reads it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from './supabase.js';
import {
  carriedOwedSince,
  drainCycleOutcome,
  drainOwedGames,
  drainWhyForBeat,
  VARIETY_OWED_CARRY_CEILING_MS,
  VARIETY_OWED_CARRY_MAX_AGE_MS,
  varietyDrainDecision,
  varietyOwedSince,
  type DrainTable,
} from './HorseVarietyFirst.js';
import { HorseFleetManager } from './HorseFleetManager.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

/* The 1 AM CST release of 2026-11-28, as the heartbeat table recorded it. */
const LAST_BEAT = '2026-11-28T06:57:43.980402+00:00';
const FIRST_CYCLE = '2026-11-28T07:05:15.915Z';
const NOW = Date.parse(FIRST_CYCLE);
const OWED_AT_10PM = '2026-11-28T04:12:40.101Z';
const OWED_AT_MIDNIGHT = '2026-11-28T06:01:09.000Z';

afterEach(() => vi.restoreAllMocks());

describe('the first-owed time is carried over a restart', () => {
  it('the measured release: a game owed before the stop and still owed after it keeps its time', () => {
    const carried = carriedOwedSince({
      heartbeat: { beatAt: LAST_BEAT, owedSince: { A: OWED_AT_10PM, B: OWED_AT_MIDNIGHT } },
      nowMs: NOW,
    });
    expect(carried).toEqual({ A: OWED_AT_10PM, B: OWED_AT_MIDNIGHT });
    /* the first seating cycle: A and B still owed, C newly owed */
    const first = varietyOwedSince({
      withheld: false,
      owedGames: ['A', 'B', 'C'],
      previous: {},
      carried,
      nowIso: FIRST_CYCLE,
    });
    expect(first).toEqual({ A: OWED_AT_10PM, B: OWED_AT_MIDNIGHT, C: FIRST_CYCLE });
    /* the old code: every game reads the first cycle's time */
    expect(
      varietyOwedSince({
        withheld: false,
        owedGames: ['A', 'B', 'C'],
        previous: {},
        nowIso: FIRST_CYCLE,
      })
    ).toEqual({ A: FIRST_CYCLE, B: FIRST_CYCLE, C: FIRST_CYCLE });
  });

  it('only a game owed on the first seating cycle keeps a carried time; the memory of this process wins', () => {
    const carried = { A: OWED_AT_10PM, B: OWED_AT_MIDNIGHT };
    /* B is no longer owed (it has an occupied table): nothing is kept for it */
    const first = varietyOwedSince({
      withheld: false,
      owedGames: ['A'],
      previous: {},
      carried,
      nowIso: FIRST_CYCLE,
    });
    expect(first).toEqual({ A: OWED_AT_10PM });
    /* owed again later, B starts a new clock: the carried time is gone with the first cycle */
    const LATER = '2026-11-28T07:20:00.000Z';
    expect(
      varietyOwedSince({ withheld: false, owedGames: ['A', 'B'], previous: first, nowIso: LATER })
    ).toEqual({ A: OWED_AT_10PM, B: LATER });
    /* a time this process already holds is never replaced by a carried one */
    expect(
      varietyOwedSince({
        withheld: false,
        owedGames: ['A'],
        previous: { A: OWED_AT_MIDNIGHT },
        carried: { A: OWED_AT_10PM },
        nowIso: FIRST_CYCLE,
      })
    ).toEqual({ A: OWED_AT_MIDNIGHT });
    /* a withheld cycle publishes no owed games: it keeps its memory and takes nothing */
    expect(
      varietyOwedSince({
        withheld: true,
        owedGames: [],
        previous: {},
        carried,
        nowIso: FIRST_CYCLE,
      })
    ).toEqual({});
  });

  it('a beat too old, from the future, missing or unreadable carries nothing', () => {
    const owedSince = { A: OWED_AT_10PM };
    const at = (beatAt: unknown, nowMs = NOW) =>
      carriedOwedSince({ heartbeat: { beatAt, owedSince }, nowMs });
    /* the bound itself: 20 minutes, 2.6 times the longest measured stop (460 s) */
    expect(VARIETY_OWED_CARRY_MAX_AGE_MS).toBe(20 * 60_000);
    const beatMs = Date.parse(LAST_BEAT);
    expect(at(LAST_BEAT, beatMs + VARIETY_OWED_CARRY_MAX_AGE_MS)).toEqual(owedSince);
    expect(at(LAST_BEAT, beatMs + VARIETY_OWED_CARRY_MAX_AGE_MS + 1)).toEqual({});
    expect(at(LAST_BEAT, beatMs - 1)).toEqual({});
    expect(at(null)).toEqual({});
    expect(at(1764313063980)).toEqual({});
    expect(at('yesterday')).toEqual({});
    expect(at('2026-11-28')).toEqual({});
    expect(carriedOwedSince({ heartbeat: null, nowMs: NOW })).toEqual({});
  });

  it('a malformed map or time is ignored, one game at a time', () => {
    const from = (owedSince: unknown) =>
      carriedOwedSince({ heartbeat: { beatAt: LAST_BEAT, owedSince }, nowMs: NOW });
    expect(from(null)).toEqual({});
    expect(from(undefined)).toEqual({});
    expect(from('{}')).toEqual({});
    expect(from([OWED_AT_10PM])).toEqual({});
    expect(VARIETY_OWED_CARRY_CEILING_MS).toBe(90 * 24 * 60 * 60_000);
    const atCeiling = new Date(NOW - VARIETY_OWED_CARRY_CEILING_MS).toISOString();
    const pastCeiling = new Date(NOW - VARIETY_OWED_CARRY_CEILING_MS - 1).toISOString();
    expect(
      from({
        good: OWED_AT_10PM,
        offset: '2026-11-27T22:12:40.101-06:00',
        now: FIRST_CYCLE,
        atCeiling,
        future: new Date(NOW + 1).toISOString(),
        pastCeiling,
        epoch: '1970-01-01T00:00:00.000Z',
        number: 1764303160101,
        dateOnly: '2026-11-28',
        words: 'a while ago',
        impossible: '2026-13-45T99:99:99.000Z',
        nothing: null,
        '': OWED_AT_10PM,
      })
    ).toEqual({
      good: OWED_AT_10PM,
      /* the same instant, written the way the fleet writes it */
      offset: OWED_AT_10PM,
      now: FIRST_CYCLE,
      atCeiling,
    });
  });
});

describe('the carried time changes no decision', () => {
  type T = DrainTable & { seated: number };
  const table = (id: string, game: string, role: 'main' | 'feeder', index: number | null): T => ({
    id,
    cluster_id: game,
    role,
    main_index: index,
    lifecycle: 'live',
    seated: 6,
    created_at: '2026-11-28T05:00:00.000Z',
  });
  /* a full cap, two games owed (one cannot start), game X holding an extra table */
  const floor = [table('x-m1', 'X', 'main', 1), table('x-f', 'X', 'feeder', null)];
  const owedGames = ['A', 'B'];
  const cycle = (carried: Record<string, string> | undefined) => {
    const owedSince = varietyOwedSince({
      withheld: false,
      owedGames,
      previous: {},
      carried,
      nowIso: FIRST_CYCLE,
    });
    const drainOwed = drainOwedGames({ owedGames, cannotStart: new Set(['B']) });
    const decision = varietyDrainDecision<T>({
      tables: floor,
      seatedAt: (id) => floor.find((x) => x.id === id)?.seated ?? 0,
      personSeatedAt: () => false,
      personWaitingGames: new Set(),
      neverHeldGames: new Set(),
      owedGames: drainOwed,
      shortfall: drainOwed.length,
      current: [],
      mayAddNew: true,
    });
    const outcome = drainCycleOutcome({
      withheld: false,
      readsComplete: true,
      owedThisCycle: drainOwed.length,
      owedInPlan: drainOwed.length,
      decision: decision.tables,
      remembered: [],
      personSeatedAt: () => false,
    });
    const why = drainWhyForBeat({
      withheld: false,
      owedThisCycle: owedGames.length,
      owedCapBlocked: drainOwed.length,
      decided: outcome.decided,
      why: decision.why,
      room: { cap: 20, counted: 20 },
      anOwedStartAdmitted: false,
    });
    return { owedSince, decided: { drainOwed, decision, outcome, why } };
  };

  it("the drain's cycle outcome is identical with and without a carried time", () => {
    const without = cycle(undefined);
    const withCarried = cycle({ A: OWED_AT_10PM, B: OWED_AT_MIDNIGHT, GONE: OWED_AT_10PM });
    /* the cycle really decides something, so "identical" is not two empty answers */
    expect(without.decided.outcome.released).toEqual(['x-f']);
    expect(without.decided.why).toBe('released');
    expect(withCarried.decided).toEqual(without.decided);
    /* the same games are published either way; only their times differ */
    expect(Object.keys(withCarried.owedSince)).toEqual(Object.keys(without.owedSince));
    expect(without.owedSince).toEqual({ A: FIRST_CYCLE, B: FIRST_CYCLE });
    expect(withCarried.owedSince).toEqual({ A: OWED_AT_10PM, B: OWED_AT_MIDNIGHT });
  });

  it('in the fleet the first-owed memory reaches the heartbeat and nothing else', () => {
    const fleet = read('./HorseFleetManager.ts');
    const count = (needle: string) => fleet.split(needle).length - 1;
    /* the carried times: declared once, read once, as varietyOwedSince's `carried` */
    expect(count('owedSinceCarried')).toBe(2);
    expect(fleet).toContain('carried: owedSinceCarried,');
    /* the memory: one assignment (from the pure function), its own `previous`, and the beat */
    expect(count('this.varietyOwedSinceByGame')).toBe(3);
    expect(fleet).toContain('this.varietyOwedSinceByGame = varietyOwedSince({');
    expect(fleet).toContain('previous: this.varietyOwedSinceByGame,');
    expect(fleet).toContain('beat.varietyOwedSince = this.varietyOwedSinceByGame;');
    /* the beat's copy: written once, read once, by the heartbeat write */
    expect(count('beat.varietyOwedSince')).toBe(2);
    expect(fleet).toContain('variety_owed_since: beat.varietyOwedSince,');
    /* no decision function of the drain takes a first-owed time */
    const rules = read('./HorseVarietyFirst.ts');
    const uses = rules
      .split('\n')
      .filter((line) => !/^\s*(\/\*|\*|\/\/)/.test(line))
      .filter((line) => /carriedOwedSince|varietyOwedSince|owedSince|carried\b/.test(line));
    expect(uses.map((line) => line.trim())).toEqual([
      'export function varietyOwedSince(input: {',
      'carried?: Readonly<Record<string, string>>;',
      'out[game] = input.previous[game] ?? input.carried?.[game] ?? input.nowIso;',
      'export function carriedOwedSince(input: {',
      'heartbeat: { beatAt: unknown; owedSince: unknown } | null;',
      'const map = hb.owedSince;',
    ]);
  });
});

describe('one read per boot', () => {
  type Harness = {
    owedSinceBeforeBoot: Promise<unknown> | null;
    readOwedSinceBeforeBoot: (bootIso: string) => Promise<unknown>;
    takeOwedSinceBeforeBoot: () => Promise<Record<string, string>>;
  };
  const harness = () => new HorseFleetManager() as unknown as Harness;
  const BOOT = '2026-11-28T07:04:50.000Z';

  /** The heartbeat table, answering the one query the fleet makes of it. */
  function heartbeats(answer: { data: unknown; error: unknown } | Error) {
    const calls: Array<[string, ...unknown[]]> = [];
    const spy = vi.spyOn(supabase, 'from').mockImplementation(((name: string) => {
      calls.push(['from', name]);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'lt', 'order', 'limit']) {
        b[m] = (...args: unknown[]) => (calls.push([m, ...args]), b);
      }
      b.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
        (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)).then(ok, bad);
      return b;
    }) as never);
    return { calls, spy };
  }

  it("reads the newest beat written before the boot, never this process's own", async () => {
    const db = heartbeats({
      data: [
        { beat_at: LAST_BEAT, detail: { variety_owed_since: { A: OWED_AT_10PM }, reason: null } },
      ],
      error: null,
    });
    const fleet = harness();
    expect(await fleet.readOwedSinceBeforeBoot(BOOT)).toEqual({
      beatAt: LAST_BEAT,
      owedSince: { A: OWED_AT_10PM },
    });
    expect(db.calls).toEqual([
      ['from', 'ca_horse_fleet_heartbeat'],
      ['select', 'beat_at, detail'],
      ['lt', 'beat_at', BOOT],
      ['order', 'beat_at', { ascending: false }],
      ['limit', 1],
    ]);
  });

  it('a failed read, an error or an empty table changes nothing, and never rejects', async () => {
    for (const answer of [
      new Error('supabase_timeout'),
      { data: null, error: { message: 'boom' } },
      { data: [], error: null },
      { data: [{ beat_at: LAST_BEAT, detail: null }], error: null },
    ]) {
      vi.restoreAllMocks();
      heartbeats(answer);
      vi.spyOn(Date, 'now').mockReturnValue(NOW);
      const fleet = harness();
      fleet.owedSinceBeforeBoot = fleet.readOwedSinceBeforeBoot(BOOT);
      expect(await fleet.takeOwedSinceBeforeBoot()).toEqual({});
    }
    vi.restoreAllMocks();
    vi.spyOn(supabase, 'from').mockImplementation((() => {
      throw new Error('no client');
    }) as never);
    expect(await harness().readOwedSinceBeforeBoot(BOOT)).toBeNull();
  });

  it('the first seating cycle takes it; no cycle after that reads or takes anything', async () => {
    const db = heartbeats({
      data: [{ beat_at: LAST_BEAT, detail: { variety_owed_since: { A: OWED_AT_10PM } } }],
      error: null,
    });
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const fleet = harness();
    /* a fleet that was never started holds no read: seedAllTables alone asks nothing */
    expect(fleet.owedSinceBeforeBoot).toBeNull();
    fleet.owedSinceBeforeBoot = fleet.readOwedSinceBeforeBoot(BOOT);
    expect(await fleet.takeOwedSinceBeforeBoot()).toEqual({ A: OWED_AT_10PM });
    expect(fleet.owedSinceBeforeBoot).toBeNull();
    expect(await fleet.takeOwedSinceBeforeBoot()).toEqual({});
    expect(db.spy).toHaveBeenCalledTimes(1);
    /* too old by the time the first seating cycle runs: nothing */
    const late = harness();
    late.owedSinceBeforeBoot = late.readOwedSinceBeforeBoot(BOOT);
    vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse(LAST_BEAT) + VARIETY_OWED_CARRY_MAX_AGE_MS + 1
    );
    expect(await late.takeOwedSinceBeforeBoot()).toEqual({});
  });

  it('the wiring: start() makes the only read, and a cycle awaits it only while it is untaken', () => {
    const fleet = read('./HorseFleetManager.ts');
    const count = (needle: string) => fleet.split(needle).length - 1;
    /* the heartbeat table is read in one place, and that place is called once, by start() */
    expect(count(".from('ca_horse_fleet_heartbeat')")).toBe(1);
    expect(count('this.readOwedSinceBeforeBoot(')).toBe(1);
    const start = fleet.indexOf('  async start(): Promise<void> {');
    const stop = fleet.indexOf('  stop(): Promise<void> {');
    const call = fleet.indexOf(
      'this.owedSinceBeforeBoot = this.readOwedSinceBeforeBoot(new Date().toISOString());'
    );
    expect(start).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(start);
    expect(call).toBeGreaterThan(start);
    expect(call).toBeLessThan(stop);
    expect(call).toBeLessThan(fleet.indexOf('await this.ensureAllTablesExist();', start));
    /* the cycle: nothing awaited once taken, nothing taken by a withheld cycle */
    expect(count('this.takeOwedSinceBeforeBoot()')).toBe(1);
    expect(fleet).toContain(
      'cycleWithheld || !this.owedSinceBeforeBoot ? {} : await this.takeOwedSinceBeforeBoot();\n' +
        '      if (!readIsCurrent()) return;\n' +
        '      this.varietyOwedSinceByGame = varietyOwedSince({'
    );
    /* taken means gone: the field is cleared before the read is awaited */
    expect(fleet).toContain(
      'const read = this.owedSinceBeforeBoot;\n    this.owedSinceBeforeBoot = null;'
    );
  });
});
