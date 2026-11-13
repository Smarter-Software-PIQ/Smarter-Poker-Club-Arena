/**
 * REGULARS (owner request 2026-11-07): a stable weekly pattern and a home game
 * per horse, consistent with the room's own curve, never a gate on coverage,
 * and never a way round HIT AND RUN.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AFFINITY_SEAT_WEIGHT,
  BAND_RUNGS,
  availableNow,
  homeAffinity,
  homeQueueRank,
  homeStakesFor,
  homeVariantsFor,
  hourOfWeekAt,
  inRegularPattern,
  regularPatternFor,
  regularSeatWeight,
  regularSessionEndFactor,
  roomWeightByHourOfWeek,
} from './HorseRegulars.js';
import {
  SECOND_TABLE_RATE,
  cashTableFill,
  isActiveNow,
  mix32,
  roomBandAt,
  stakeBandForBigBlind,
  wantsTableChange,
  type HorseStakeBand,
} from './HorseBehavior.js';
import { planHorseQueues } from './HorseGameQueue.js';
import { supabase } from './supabase.js';
import { HorseSessionRotator, type RotatorEngine } from './HorseSessionRotator.js';
import { setMaintenanceFrozen } from '../maintenance/freezeState.js';
import { MIDWAY_UNION_ID } from './StableHand.js';

/** Deterministic uuid-shaped ids, the shape horse ids have. */
const uuid = (i: number) => {
  const a = mix32(i * 2654435761 + 1)
    .toString(16)
    .padStart(8, '0');
  const b = mix32(i * 40503 + 7)
    .toString(16)
    .padStart(8, '0');
  const c = mix32(i * 69069 + 13)
    .toString(16)
    .padStart(8, '0');
  const d = mix32(i * 1103515245 + 17)
    .toString(16)
    .padStart(8, '0');
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${c.slice(1, 4)}-${c.slice(4)}${d}`;
};
const FLEET_IDS = Array.from({ length: 3000 }, (_, i) => uuid(i));
/** The first `n` ids of the fleet (a stable, smaller stable for the costlier checks). */
const fleetOf = (n: number) => FLEET_IDS.filter((_, i) => i < n);
/** Chicago Monday 2026-01-05 00:00 CST, no DST in the week. */
const REF_MONDAY = Date.parse('2026-01-05T06:00:00Z');
const atHourOfWeek = (how: number) => REF_MONDAY + how * 3_600_000 + 60_000;

/** Every enabled cash game on production, 2026-11-07 (variant, sb, bb, count). */
const CASH_GAMES: ReadonlyArray<readonly [string, number, number, number]> = [
  ['flh', 0.1, 0.25, 1],
  ['flh', 0.25, 0.5, 2],
  ['flh', 0.5, 1, 5],
  ['flh', 1, 2, 4],
  ['flh', 2, 5, 4],
  ['flh', 5, 10, 4],
  ['flo8', 0.1, 0.25, 1],
  ['flo8', 0.25, 0.5, 2],
  ['flo8', 0.5, 1, 5],
  ['flo8', 1, 2, 4],
  ['flo8', 2, 5, 4],
  ['flo8', 5, 10, 4],
  ['nlh', 0.05, 0.1, 1],
  ['nlh', 0.1, 0.25, 1],
  ['nlh', 0.25, 0.5, 2],
  ['nlh', 0.5, 1, 6],
  ['nlh', 1, 2, 2],
  ['pineapple', 0.25, 0.5, 1],
  ['pineapple', 0.5, 1, 5],
  ['plo4', 0.1, 0.25, 1],
  ['plo4', 0.25, 0.5, 2],
  ['plo4', 0.5, 1, 5],
  ['plo4', 1, 2, 1],
  ['plo5', 0.1, 0.25, 1],
  ['plo5', 0.25, 0.5, 1],
  ['plo5', 0.5, 1, 6],
  ['plo5', 1, 2, 2],
  ['plo5', 2, 5, 1],
  ['plo6', 0.1, 0.25, 1],
  ['plo6', 0.25, 0.5, 1],
  ['plo6', 0.5, 1, 6],
  ['plo6', 1, 2, 1],
  ['plo8', 0.25, 0.5, 1],
  ['plo8', 0.5, 1, 5],
  ['short_deck', 0.25, 0.5, 2],
  ['short_deck', 0.5, 1, 6],
];
const GAMES = CASH_GAMES.flatMap(([variant, , bb, n]) =>
  Array.from({ length: n }, (_, i) => ({ id: `${variant}:${bb}:${i}`, variant, bb }))
);

describe('a regular has a stable weekly pattern', () => {
  it('is 2-5 sessions of 3-6 hours, all at one Chicago start hour, the same every call', () => {
    for (const id of fleetOf(500)) {
      const p = regularPatternFor(id);
      expect(p.days.length).toBeGreaterThanOrEqual(2);
      expect(p.days.length).toBeLessThanOrEqual(5);
      expect(new Set(p.days).size).toBe(p.days.length);
      expect(p.hours).toBeGreaterThanOrEqual(3);
      expect(p.hours).toBeLessThanOrEqual(6);
      for (const s of p.starts) expect(s % 24).toBe(p.startHour);
      expect(regularPatternFor(id)).toEqual(p);
    }
  });

  it('is inside its pattern exactly in the hours its sessions cover', () => {
    const id = FLEET_IDS[7];
    const p = regularPatternFor(id);
    const covered = new Set<number>();
    for (const s of p.starts) for (let k = 0; k < p.hours; k++) covered.add((s + k) % 168);
    for (let how = 0; how < 168; how++) {
      expect(hourOfWeekAt(atHourOfWeek(how))).toBe(how);
      expect(inRegularPattern(id, atHourOfWeek(how))).toBe(covered.has(how));
    }
  });

  it('the sum of every pattern reproduces the room curve, never fights it', () => {
    const w = roomWeightByHourOfWeek();
    const share: number[] = [];
    for (let how = 0; how < 168; how++) {
      const t = atHourOfWeek(how);
      expect(w[how]).toBe(SECOND_TABLE_RATE[roomBandAt(t)]);
      share.push(FLEET_IDS.filter((id) => inRegularPattern(id, t)).length / FLEET_IDS.length);
    }
    const byBand = new Map<number, number[]>();
    w.forEach((x, i) => byBand.set(x, [...(byBand.get(x) ?? []), share[i]]));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const bands = [...byBand.keys()].sort((a, b) => b - a); // busiest band first
    const means = bands.map((b) => mean(byBand.get(b)!));
    // Busier band, more regulars in their hours: peak > evening > day > late > early > dawn.
    for (let i = 1; i < means.length; i++) expect(means[i]).toBeLessThan(means[i - 1]);
    // And hour by hour the two curves move together.
    const mw = mean([...w]);
    const ms = mean(share);
    let num = 0;
    let dw = 0;
    let ds = 0;
    for (let i = 0; i < 168; i++) {
      num += (w[i] - mw) * (share[i] - ms);
      dw += (w[i] - mw) ** 2;
      ds += (share[i] - ms) ** 2;
    }
    expect(num / Math.sqrt(dw * ds)).toBeGreaterThan(0.85);
  });

  it('never shrinks the old pool: availableNow is a superset of isActiveNow', () => {
    for (let how = 0; how < 168; how += 5) {
      const t = atHourOfWeek(how);
      for (const id of fleetOf(400)) {
        if (isActiveNow(id, new Date(t).getUTCHours())) expect(availableNow(id, t)).toBe(true);
        if (inRegularPattern(id, t)) expect(availableNow(id, t)).toBe(true);
      }
    }
  });

  it('settles in inside its pattern and winds down after it', () => {
    for (const id of fleetOf(300)) {
      for (let how = 0; how < 168; how += 7) {
        const t = atHourOfWeek(how);
        const f = regularSessionEndFactor(id, t);
        if (inRegularPattern(id, t)) expect(f).toBe(0.7);
        else expect(f).toBe(isActiveNow(id, new Date(t).getUTCHours()) ? 1.3 : 1.6);
      }
    }
  });
});

describe('a regular has a home game', () => {
  it('one or two variants, one or two adjacent stakes', () => {
    for (const id of fleetOf(800)) {
      const v = homeVariantsFor(id);
      expect(v.length === 1 || v.length === 2).toBe(true);
      for (const band of ['micro', 'low', 'mid', 'high'] as HorseStakeBand[]) {
        const s = homeStakesFor(id, band);
        const rungs = BAND_RUNGS[band];
        expect(s.length === 1 || s.length === 2).toBe(true);
        if (s.length === 2) expect(Math.abs(rungs.indexOf(s[0]) - rungs.indexOf(s[1]))).toBe(1);
      }
    }
  });

  it("every game in the current cash_games set is somebody's home game", () => {
    const fleet = fleetOf(712); // the cash-capable stable, 2026-11-07
    for (const g of GAMES) {
      const regulars = fleet.filter((id) => homeAffinity(id, g.variant, g.bb) === 'home');
      expect(regulars.length, `${g.variant} ${g.bb}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('the seat weight is pattern x affinity, and only that', () => {
    const t = atHourOfWeek(100);
    for (const id of fleetOf(200)) {
      const g = GAMES[mix32(id.length + id.charCodeAt(3)) % GAMES.length];
      const w = regularSeatWeight(id, { game_variant: g.variant, big_blind: g.bb }, t);
      expect(w).toBe(
        (inRegularPattern(id, t) ? 6 : 1) * AFFINITY_SEAT_WEIGHT[homeAffinity(id, g.variant, g.bb)]
      );
    }
  });
});

/**
 * THE ROOM STILL FILLS EVERY GAME. The fleet's seat walk, as a model: every
 * game in the production set in turn, a band-matched pool of available horses
 * with fewer than four tables, ordered by a random draw, top N seated. Run with
 * and without the regulars' weight, it must seat the same count at every game:
 * the weight orders a pool, it never shrinks one.
 */
describe('loyalty never leaves a game short', () => {
  const bands: HorseStakeBand[] = ['micro', 'low'];
  const fleet = fleetOf(712).map((id, i) => ({
    id,
    band: i < 176 ? bands[0] : bands[1], // 262:800 of 1062, scaled to the cash stable
  }));
  function walk(nowMs: number, seed: number, loyal: boolean, seatsPerGame: number) {
    let r = seed >>> 0;
    const rng = () => (r = mix32(r + 0x9e3779b9)) / 4_294_967_296;
    const at = new Map<string, number>();
    const seated = new Map<string, string[]>();
    for (const g of GAMES) {
      const band = stakeBandForBigBlind(g.bb);
      const pool = fleet.filter(
        (h) => h.band === band && (at.get(h.id) ?? 0) < 4 && availableNow(h.id, nowMs)
      );
      const pick = pool
        .map((h) => ({
          h,
          w:
            rng() *
            (loyal
              ? regularSeatWeight(h.id, { game_variant: g.variant, big_blind: g.bb }, nowMs)
              : 1),
        }))
        .sort((a, b) => b.w - a.w)
        .slice(0, seatsPerGame)
        .map((x) => x.h.id);
      for (const id of pick) at.set(id, (at.get(id) ?? 0) + 1);
      seated.set(g.id, pick);
    }
    return seated;
  }

  it.each([
    ['Friday 21:00 (peak)', 4 * 24 + 21],
    ['Wednesday 14:00 (day)', 2 * 24 + 14],
    ['Tuesday 06:00 (dawn)', 1 * 24 + 6],
    ['Sunday 02:00 (peak night)', 6 * 24 + 2],
  ])('%s: every variant and stake seats exactly what it did', (_label, how) => {
    const t = atHourOfWeek(how);
    for (const seed of [1, 2, 3]) {
      for (const seats of [6, 9]) {
        const before = walk(t, seed, false, seats);
        const after = walk(t, seed, true, seats);
        for (const g of GAMES) {
          expect(after.get(g.id)!.length, `${g.id} seats=${seats}`).toBe(before.get(g.id)!.length);
          // Every micro/low game is filled; mid/high have no horses on this stable today.
          if (g.bb <= 2) expect(after.get(g.id)!.length).toBe(seats);
        }
      }
    }
  });

  it('and at an ordinary load, most seats go to regulars at their home or in their hours', () => {
    const t = atHourOfWeek(4 * 24 + 21);
    const light = (seed: number, loyal: boolean) => {
      // About the live load: 75 horses on ~3 tables each, so ~25 games of 9.
      const out = walk(t, seed, loyal, 9);
      let regular = 0;
      let total = 0;
      for (const g of GAMES.filter((x) => x.bb <= 2).slice(0, 25)) {
        for (const id of out.get(g.id)!) {
          total++;
          if (inRegularPattern(id, t) || homeAffinity(id, g.variant, g.bb) === 'home') regular++;
        }
      }
      return regular / total;
    };
    for (const seed of [1, 2, 3]) {
      expect(light(seed, true)).toBeGreaterThan(0.5);
      expect(light(seed, true)).toBeGreaterThan(light(seed, false) + 0.2);
    }
  });
});

describe("a game's regulars stand in its line first", () => {
  it('planHorseQueues picks a home horse before an away one, and still picks someone', () => {
    const game = 'g-nlh-1';
    const ids = fleetOf(200);
    const home = ids.filter((id) => homeQueueRank(id, 'nlh', 1) === 0);
    const away = ids.filter((id) => homeQueueRank(id, 'nlh', 1) === 2);
    expect(home.length).toBeGreaterThan(0);
    expect(away.length).toBeGreaterThan(0);
    const plan = (pool: string[]) =>
      planHorseQueues({
        asks: [{ gameId: game, waitTarget: 2, pool, variant: 'nlh', bigBlind: 1 }],
        tables: [{ gameId: game, maxPlayers: 9, seated: 9 }],
        rows: [],
        excludedGameIds: new Set(),
        humanWaitingGameIds: new Set(),
        seatedByGame: new Map(),
        nowMs: Date.parse('2026-11-07T20:00:00Z'),
      });
    expect(plan([...away.slice(0, 5), home[0], ...away.slice(5, 10)]).add).toEqual([
      { game_id: game, user_id: home[0] },
    ]);
    // No regular in the pool: the line still grows, exactly as before.
    expect(plan(away.slice(0, 10)).add).toHaveLength(1);
  });
});

describe('the wiring is on the real paths', () => {
  const FLEET = readFileSync(resolve(__dirname, 'HorseFleetManager.ts'), 'utf8');
  it('the fleet draws from availableNow and weights the draw by regularSeatWeight', () => {
    expect(FLEET).toContain(
      'const pool = sittable.filter((h) => availableNow(h.id, regularsNowMs));'
    );
    expect(FLEET).toMatch(
      /w: Math\.random\(\) \* towardFour \* regularSeatWeight\(h\.id, table, regularsNowMs\)/
    );
    expect(FLEET).not.toMatch(/isActiveNow\(h\.id/);
    // The line asks carry the game, so planHorseQueues can rank its regulars.
    expect(FLEET).toMatch(/pool: pool\.map\(\(h\) => h\.id\),\s*variant: table\.game_variant,/);
  });
});

/* ── HIT AND RUN on the schedule departure, through the real rotator ──────── */
type Rows = Record<string, any>[];
function fakeDb(tables: Record<string, Rows>) {
  const build = (name: string) => {
    let rows = [...(tables[name] ?? [])];
    let from = 0;
    let to = Infinity;
    let lim = Infinity;
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), b);
    b.in = (c: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[c]))), b);
    b.is = (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), b);
    b.gt = (c: string, v: any) => ((rows = rows.filter((r) => String(r[c]) > String(v))), b);
    b.lte = () => b;
    b.not = () => b;
    b.order = () => b;
    b.limit = (n: number) => ((lim = n), b);
    b.range = (a: number, z: number) => ((from = a), (to = z), b);
    b.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
      Promise.resolve({
        data: rows.slice(from, Math.min(rows.length, to + 1)).slice(0, lim),
        error: null,
      }).then(ok, bad);
    return b;
  };
  vi.spyOn(supabase, 'from').mockImplementation(((name: string) => build(name)) as never);
  vi.spyOn(supabase, 'rpc').mockImplementation((() =>
    Promise.resolve({ data: null, error: { message: 'no rpc in fixture' } })) as never);
}

describe('a schedule departure is an ordinary leave: HIT AND RUN holds a horse in profit', () => {
  // Wednesday 14:00 Chicago.
  const NOW = Date.parse('2026-11-04T14:00:00-06:00');
  const TABLE = (() => {
    for (let i = 0; i < 500; i++) {
      const id = `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      if (cashTableFill(id, NOW) !== 'full') return id;
    }
    throw new Error('no non-full table id');
  })();
  const pickHorses = (want: (id: string) => boolean) =>
    FLEET_IDS.filter((id) => want(id) && !wantsTableChange(id, TABLE, 6, 60, NOW)).slice(0, 6);
  const OUT = pickHorses(
    (id) => !inRegularPattern(id, NOW) && !isActiveNow(id, new Date(NOW).getUTCHours())
  );
  const IN = pickHorses((id) => inRegularPattern(id, NOW));

  beforeEach(() => {
    setMaintenanceFrozen(false);
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    for (const m of ['log', 'warn', 'error'] as const)
      vi.spyOn(console, m).mockImplementation(() => {});
    // The session hazard per 90 s cycle is 0.02 x the schedule factor: 0.014
    // inside the pattern, 0.032 outside it. A roll of 0.02 departs only the
    // horse whose pattern is over.
    vi.spyOn(Math, 'random').mockReturnValue(0.02);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function rotate(horses: string[], owed: number, opts: { person?: string; rot?: any } = {}) {
    const table = {
      id: TABLE,
      big_blind: 0.25,
      small_blind: 0.1,
      game_variant: 'nlh',
      tournament_id: null,
      status: 'running',
      settings: {},
      cluster_id: '830603f7-ed8e-4e25-8572-ce7aa45a5469',
      role: 'main',
      main_index: 1,
      lifecycle: 'live',
      union_id: MIDWAY_UNION_ID,
      club_id: MIDWAY_UNION_ID,
      created_at: new Date(NOW - 3600_000).toISOString(),
      max_players: 6,
      min_buy_in: 10,
      max_buy_in: 25,
      is_deleted: false,
    };
    fakeDb({
      table_seats: [...horses, ...(opts.person ? [opts.person] : [])].map((user_id, s) => ({
        id: `s-${s}`,
        table_id: TABLE,
        user_id,
        seat_number: s + 1,
        stack: 25,
        joined_at: new Date(NOW - 60 * 60_000).toISOString(),
        club_id: MIDWAY_UNION_ID,
        leave_pending: false,
        is_sitting_out: false,
        left_at: null,
        tables: table,
      })),
      profiles: [
        ...horses.map((id) => ({ id, is_horse: true })),
        ...(opts.person ? [{ id: opts.person, is_horse: false }] : []),
      ],
      club_members: [],
      chip_ledger: [],
      table_waitlist: [],
      cash_game_waitlist: [],
      cash_games: [],
      cash_seat_moves: [],
      hand_history: [],
      tournament_players: [],
      tables: [table],
    });
    const leaves: string[] = [];
    const engine = (): RotatorEngine =>
      ({
        leaveTable: (userId: string) => {
          if (owed > 0)
            return { success: false, code: 'LEAVE_LOCKED', hands_remaining: owed } as never;
          leaves.push(userId);
          return { success: true };
        },
        sitOut: () => ({ success: true }),
        hitRunHandsOwed: () => owed,
      }) as RotatorEngine;
    const rot = opts.rot ?? (new HorseSessionRotator(engine) as any);
    if (opts.rot) rot.getEngine = () => engine();
    rot.isRunning = true;
    rot.lifecycleGeneration = 1;
    await rot.rotate(1);
    return leaves;
  }

  it('the fixture is what it says: six horses past their pattern, six inside it', () => {
    expect(OUT).toHaveLength(6);
    expect(IN).toHaveLength(6);
    for (const id of OUT) expect(regularSessionEndFactor(id, NOW)).toBe(1.6);
    for (const id of IN) expect(regularSessionEndFactor(id, NOW)).toBe(0.7);
  });

  // Owner 2026-11-12 (HorseWorkSchedule): past its pattern AND its daily
  // window a horse is off shift, and every off-shift horse goes home - once.
  // 2026-11-13: one shift change per table per cycle, so a table never stands
  // up all at once; the rest go on the following cycles.
  it('a horse whose pattern is over, owing nothing, leaves - one per table per cycle', async () => {
    const leaves = await rotate(OUT, 0);
    expect(leaves).toHaveLength(1);
    expect(OUT).toContain(leaves[0]);
  });

  it('every off-shift horse goes home, one per cycle, until none is left', async () => {
    let left = [...OUT];
    const gone: string[] = [];
    for (let cycle = 0; cycle < OUT.length && left.length > 0; cycle++) {
      const leaves = await rotate(left, 0);
      expect(leaves).toHaveLength(1);
      gone.push(...leaves);
      left = left.filter((id) => !leaves.includes(id));
    }
    expect(left).toHaveLength(0);
    expect([...gone].sort()).toEqual([...OUT].sort());
  });

  it('a person at a four-handed table keeps an off-shift horse only for the grace, then it goes', async () => {
    const three = OUT.slice(0, 3);
    const rot = new HorseSessionRotator((() => ({})) as never) as any;
    // A person plus three off-shift horses: leaving would drop the game to 3.
    expect(await rotate(three, 0, { person: 'person-1', rot })).toHaveLength(0);
    vi.setSystemTime(NOW + 9 * 60_000);
    expect(await rotate(three, 0, { person: 'person-1', rot })).toHaveLength(0);
    vi.setSystemTime(NOW + 10 * 60_000 + 1);
    const leaves = await rotate(three, 0, { person: 'person-1', rot });
    expect(leaves).toHaveLength(1);
    expect(three).toContain(leaves[0]);
    vi.setSystemTime(NOW);
  });

  it('the same horse in its pattern stays', async () => {
    expect(await rotate(IN, 0)).toHaveLength(0);
  });

  it('a horse in profit that owes hands is not stood up by its schedule', async () => {
    expect(await rotate(OUT, 3)).toHaveLength(0);
  });
});
