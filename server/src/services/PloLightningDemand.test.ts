import { sliceCall } from '../testHelpers/sourceWindow.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PLO_LIGHTNING_GAME,
  ploActivityPool,
  ploContinuationFor,
  ploWindDownFor,
} from './PloLightningDemand.js';
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

describe('paced PLO demand keeps the activity hour from stalling startup', () => {
  it('can add the fifth player from the already sittable pool when everyone is asleep', () => {
    const eligible = ['funded-low-band-a', 'funded-low-band-b'];
    expect(
      ploActivityPool(PLO_LIGHTNING_GAME, new Set([PLO_LIGHTNING_GAME]), null, [], eligible, 2)
    ).toBe(eligible);
  });
  it('also supplies the durable twenty-percent continuation without inventing a human', () => {
    const eligible = ['eligible'];
    expect(
      ploActivityPool(
        PLO_LIGHTNING_GAME,
        new Set<string>(),
        { ...choice, continues: true, wind_down: false },
        [],
        eligible,
        1
      )
    ).toBe(eligible);
  });
  it('preserves other games, wind-down, empty demand and a sufficient awake pool', () => {
    const awake = ['awake'],
      eligible = ['awake', 'asleep'];
    for (const [game, humans, demand] of [
      ['other', new Set([PLO_LIGHTNING_GAME]), null],
      [PLO_LIGHTNING_GAME, null, null],
      [PLO_LIGHTNING_GAME, new Set(['other']), null],
      [PLO_LIGHTNING_GAME, new Set<string>(), choice],
      [PLO_LIGHTNING_GAME, new Set<string>(), null],
    ] as const)
      expect(ploActivityPool(game, humans, demand, awake, eligible, 2)).toBe(awake);
    expect(
      ploActivityPool(PLO_LIGHTNING_GAME, new Set([PLO_LIGHTNING_GAME]), null, awake, eligible, 1)
    ).toBe(awake);
  });
});

it('the fleet widens only the already qualified pool before selection', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./HorseFleetManager.ts', import.meta.url), 'utf8');
  const verdict = source.indexOf('const v = sitVerdictFor(h.id, table, sitCtx);');
  const activity = source.indexOf('pool = ploActivityPool(');
  expect(activity).toBeGreaterThan(verdict);
  expect(sliceCall(source, 'ploActivityPool(')).toMatch(/pool,\s+sittable,\s+emptySeats\.length/);
  expect(activity).toBeLessThan(source.indexOf('const weighted = orderMadnessCandidates('));
});
