/**
 * THE HORSE'S OWN PLAYING STYLE, the shared assignment and table rule
 * (HorsePlayStyle.ts; owner 2026-11-15 16:40 and 16:42; option
 * horsePlayStyles, default OFF).
 */
import { describe, expect, it } from 'vitest';
import {
  HORSE_PLAY_STYLES,
  HORSE_PLAY_STYLE_MIN_EFFECTIVE_BB,
  horsePlayStyleAtTable,
  horsePlayStyleFallback,
  horsePlayStyleFor,
  isHorsePlayStyle,
  type HorsePlayStyle,
  type HorsePlayStyleTable,
} from './HorsePlayStyle.js';
import {
  holdemPersonaFor,
  personaFromValue,
  ploArchetypeFor,
  ploPersonaFor,
} from './HorsePersona.js';

const uuid = (i: number): string => {
  const h = (n: number, w: number) => (n >>> 0).toString(16).padStart(w, '0').slice(-w);
  return `${h(i * 2654435761, 8)}-${h(i * 40503, 4)}-4${h(i * 97, 3)}-a${h(i * 31, 3)}-${h(i * 7919, 8)}${h(i, 4)}`;
};
const IDS = Array.from({ length: 30_000 }, (_, i) => uuid(i + 1));

describe('assignment: a third of the fleet each, by the id alone', () => {
  it('30,000 synthetic ids fall in uniform thirds', () => {
    const n: Record<HorsePlayStyle, number> = { tight: 0, current: 0, pressure: 0 };
    for (const id of IDS) n[horsePlayStyleFor(id)]++;
    // One third is 10,000; three standard deviations of a third of 30,000 is 245.
    for (const s of HORSE_PLAY_STYLES) expect(Math.abs(n[s] - 10_000)).toBeLessThan(300);
  });

  it('league seat ids and short ids are spread too', () => {
    const n: Record<HorsePlayStyle, number> = { tight: 0, current: 0, pressure: 0 };
    for (let i = 1; i <= 9000; i++) n[horsePlayStyleFor(`league-${i}`)]++;
    for (const s of HORSE_PLAY_STYLES) expect(Math.abs(n[s] - 3000)).toBeLessThan(200);
  });

  it('is stable: the same id answers the same style every time', () => {
    for (const id of IDS.slice(0, 2000)) expect(horsePlayStyleFor(id)).toBe(horsePlayStyleFor(id));
    // Pinned: a change of the hash or the salt re-deals the fleet and must be deliberate.
    expect(
      ['league-1', 'league-2', 'league-3', 'league-4', 'league-5', 'league-6'].map((id) =>
        horsePlayStyleFor(id)
      )
    ).toMatchInlineSnapshot(`
      [
        "pressure",
        "tight",
        "current",
        "tight",
        "current",
        "tight",
      ]
    `);
  });

  it('is independent of the id-hash archetypes of both games', () => {
    for (const archetypeOf of [ploArchetypeFor, (id: string) => holdemPersonaFor(id).archetype]) {
      const by = new Map<string, Record<HorsePlayStyle, number>>();
      for (const id of IDS) {
        const row = by.get(archetypeOf(id)) ?? { tight: 0, current: 0, pressure: 0 };
        row[horsePlayStyleFor(id)]++;
        by.set(archetypeOf(id), row);
      }
      expect(by.size).toBe(4);
      for (const row of by.values()) {
        const total = row.tight + row.current + row.pressure;
        for (const s of HORSE_PLAY_STYLES)
          expect(Math.abs(row[s] / total - 1 / 3)).toBeLessThan(0.03);
      }
    }
  });

  it('an authored style wins; anything else is ignored', () => {
    const id = IDS[0];
    for (const s of HORSE_PLAY_STYLES) expect(horsePlayStyleFor(id, s)).toBe(s);
    for (const bad of [undefined, null, '', 'TIGHT', 'lag', 1, true, {}, ['tight']])
      expect(horsePlayStyleFor(id, bad)).toBe(horsePlayStyleFor(id));
    expect(isHorsePlayStyle('pressure')).toBe(true);
    expect(isHorsePlayStyle('hybrid')).toBe(false);
    expect(horsePlayStyleFor('')).toBe(horsePlayStyleFor('default-horse'));
  });

  it('the authored persona carries playStyle only when it is one of the three names', () => {
    const id = IDS[1];
    const base = personaFromValue(undefined, id);
    expect('playStyle' in base).toBe(false);
    expect(personaFromValue({ straddleRate: 0.1 }, id)).toEqual({ ...base, straddleRate: 0.1 });
    expect(personaFromValue({ playStyle: 'loose' }, id)).toEqual(base);
    expect(personaFromValue({ playStyle: 'tight' }, id)).toEqual({ ...base, playStyle: 'tight' });
    // The archetype functions are untouched by the style.
    expect(ploPersonaFor(id)).toEqual(ploPersonaFor(id));
  });
});

describe('the table rule', () => {
  const table = (over: Partial<HorsePlayStyleTable> = {}): HorsePlayStyleTable => ({
    vpipFloorPct: 0,
    tournament: false,
    lightning: false,
    effectiveStackBB: 100,
    tightExpectedVpipPct: 24,
    ...over,
  });

  it('a deep cash table of a mapped game with no floor: every style plays as itself', () => {
    for (const s of HORSE_PLAY_STYLES) {
      expect(horsePlayStyleFallback(s, table())).toBeNull();
      expect(horsePlayStyleAtTable(s, table())).toBe(s);
    }
  });

  it('current is current everywhere, and no fact is read for it', () => {
    expect(
      horsePlayStyleFallback('current', table({ tournament: true, tightExpectedVpipPct: null }))
    ).toBeNull();
  });

  it.each([
    ['a tournament', { tournament: true }, 'tournament'],
    ['Lightning', { lightning: true }, 'lightning'],
    [
      'exactly 50 bb effective',
      { effectiveStackBB: HORSE_PLAY_STYLE_MIN_EFFECTIVE_BB },
      'short_stack',
    ],
    ['20 bb effective', { effectiveStackBB: 20 }, 'short_stack'],
    ['an unknown depth', { effectiveStackBB: Number.NaN }, 'short_stack'],
    ['a game with no mapping', { tightExpectedVpipPct: null }, 'unmapped_game'],
  ] as const)('%s: tight and pressure both play current', (_n, over, why) => {
    for (const s of ['tight', 'pressure'] as const) {
      expect(horsePlayStyleFallback(s, table(over))).toBe(why);
      expect(horsePlayStyleAtTable(s, table(over))).toBe('current');
    }
  });

  it('just over 50 bb the style applies', () => {
    expect(horsePlayStyleAtTable('tight', table({ effectiveStackBB: 50.5 }))).toBe('tight');
  });

  it('a VPIP floor above the tight expected VPIP sends tight, and only tight, to current', () => {
    for (const floor of [30, 50]) {
      expect(horsePlayStyleFallback('tight', table({ vpipFloorPct: floor }))).toBe('vpip_floor');
      expect(horsePlayStyleAtTable('tight', table({ vpipFloorPct: floor }))).toBe('current');
      expect(horsePlayStyleAtTable('pressure', table({ vpipFloorPct: floor }))).toBe('pressure');
    }
    // A floor the tight widths meet anyway leaves the style alone.
    expect(horsePlayStyleAtTable('tight', table({ vpipFloorPct: 20 }))).toBe('tight');
    expect(horsePlayStyleAtTable('tight', table({ vpipFloorPct: 24 }))).toBe('tight');
    expect(horsePlayStyleAtTable('tight', table({ vpipFloorPct: 25 }))).toBe('current');
  });
});
