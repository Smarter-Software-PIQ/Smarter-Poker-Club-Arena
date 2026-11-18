import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLO_LIGHTNING_GAME, ploContinuationFor, ploWindDownFor } from './PloLightningDemand.js';
import { readPloLightningDemand } from './PloLightningDemandRead.js';
const choice = {
  game_id: PLO_LIGHTNING_GAME,
  event_id: '00000000-0000-4000-8000-000000000001',
  continues: false,
  wind_down: true,
} as const;
afterEach(() => vi.restoreAllMocks());
describe('the original post-human demand result reaches its consumers', () => {
  it('admits continuation separately, never treating it as a human', () => {
    expect(
      ploContinuationFor(PLO_LIGHTNING_GAME, { ...choice, continues: true, wind_down: false })
    ).toBe(true);
    expect(ploContinuationFor('other', { ...choice, continues: true, wind_down: false })).toBe(
      false
    );
    expect(ploContinuationFor(PLO_LIGHTNING_GAME, choice)).toBe(false);
  });
  it('winds down only the selected game without a human anywhere in it', () => {
    expect(ploWindDownFor(PLO_LIGHTNING_GAME, choice, new Set())).toBe(true);
    expect(ploWindDownFor(PLO_LIGHTNING_GAME, choice, new Set([PLO_LIGHTNING_GAME]))).toBe(false);
    expect(ploWindDownFor('other', choice, new Set())).toBe(false);
    expect(ploWindDownFor(PLO_LIGHTNING_GAME, null, new Set())).toBe(false);
  });
  it('reads the authoritative decision once and preserves an unavailable outcome', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const read = vi.fn(async () => ({ data: choice, error: null }));
    expect(await readPloLightningDemand(read)).toEqual(choice);
    expect(read).toHaveBeenCalledTimes(1);
    for (const data of [
      null,
      {},
      { ...choice, game_id: 'other' },
      { ...choice, continues: true },
      { ...choice, event_id: null },
    ])
      expect(await readPloLightningDemand(async () => ({ data, error: null }))).toBeNull();
    expect(
      await readPloLightningDemand(async () => ({ data: choice, error: new Error('unavailable') }))
    ).toBeNull();
  });
});

it('the fleet never widens the work hours for the PLO Lightning game (owner 2026-11-12)', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./HorseFleetManager.ts', import.meta.url), 'utf8');
  expect(source).not.toContain('ploActivityPool');
  expect(source).toContain(
    'const pool = sittable.filter((h) => availableNow(h.id, regularsNowMs));'
  );
});
