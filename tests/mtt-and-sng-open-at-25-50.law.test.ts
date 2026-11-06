import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BLIND_STRUCTURES,
  SPIN_BLIND_STRUCTURE,
  mttAndSngOpeningBlinds,
} from '../src/config/blindStructures';
import { SPIN_BLINDS } from '../src/config/spinSpec';

describe('MTTs and Sit & Gos open at 25/50; Spins retain their own structure', () => {
  it.each(Object.entries(BLIND_STRUCTURES))(
    '%s opens at 25/50 without decreasing later',
    (_, levels) => {
      const playing = levels.filter((row) => !row.isBreak);
      expect(playing[0]).toMatchObject({ smallBlind: 25, bigBlind: 50 });
      for (let i = 1; i < playing.length; i++) {
        expect(playing[i].smallBlind).toBeGreaterThanOrEqual(playing[i - 1].smallBlind);
        expect(playing[i].bigBlind).toBeGreaterThanOrEqual(playing[i - 1].bigBlind);
      }
    }
  );
  it('preserves indices, clocks, antes, breaks and all later stakes above the floor', () => {
    const original = [
      { level: 1, smallBlind: 25, bigBlind: 25, durationMinutes: 8, ante: 0 },
      { level: 2, smallBlind: 25, bigBlind: 50, durationMinutes: 8, ante: 0 },
      { level: 3, smallBlind: 0, bigBlind: 0, durationMinutes: 5, ante: 0, isBreak: true },
      { level: 4, smallBlind: 50, bigBlind: 100, durationMinutes: 8, ante: 10 },
    ];
    const before = structuredClone(original);
    expect(mttAndSngOpeningBlinds(original)).toEqual([
      { ...original[0], bigBlind: 50 },
      ...original.slice(1),
    ]);
    expect(original).toEqual(before);
  });
  it('leaves the complete Spin preview identical to its dedicated specification', () => {
    expect(SPIN_BLIND_STRUCTURE).toEqual(
      SPIN_BLINDS.map((row, i) => ({
        level: i + 1,
        smallBlind: row.small,
        bigBlind: row.big,
        ante: 0,
        durationMinutes: 5,
      }))
    );
    expect(SPIN_BLIND_STRUCTURE[0]).toMatchObject({ smallBlind: 10, bigBlind: 20 });
  });
  it('uses the existing pre-start registered-contract transition admission', () => {
    expect(
      readFileSync(
        'supabase/migrations/20261106011202_tournaments_open_at_twenty_five_fifty.sql',
        'utf8'
      )
    ).toContain("SET LOCAL app.lock_level_clock='on';");
  });
  it('runs the real database transition proof in required accounting CI', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('python3 -B scripts/ci/test-mtt-lobby-entry-counts.py');
    expect(readFileSync('scripts/ci/test-mtt-lobby-entry-counts.py', 'utf8')).toContain(
      "str(ROOT/'scripts/ci/test-tournament-opening-blinds.py')"
    );
  });
});
