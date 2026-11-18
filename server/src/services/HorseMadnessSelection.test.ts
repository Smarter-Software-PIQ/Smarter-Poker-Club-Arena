import { describe, expect, it } from 'vitest';
import { orderMadnessCandidates } from './HorseMadnessSelection.js';

const madness = {
  game_variant: 'plo5',
  bomb_pot_enabled: true,
  big_blind_ante_enabled: true,
  nit_game: true,
  // Every PLO table keeps 40 since 2026-11-17; the ruleset is the identity.
  maintain_percent_min: 40,
  rules_profile: 'madness_without_lightning',
};
const weighted = [
  { h: { id: 'tiny' }, w: 4 },
  { h: { id: 'proven' }, w: 1 },
  { h: { id: 'unknown' }, w: 3 },
];
const performance = new Map([
  ['tiny', { hands: 71, bb100: 219 }],
  ['proven', { hands: 10_000, bb100: 15 }],
]);
/* The overrides below deliberately pass undefined and null profiles, so the
   helper takes the selector's own parameter shape rather than the fixture's. */
type TableLike = Parameters<typeof orderMadnessCandidates>[1];
async function order(table: TableLike = madness, records = performance) {
  return orderMadnessCandidates(weighted, table, records);
}

describe('Madness prefers measured PLO strength after normal admission', () => {
  it('does not mistake a 71-hand heater for a well sampled winner', async () => {
    expect((await order()).map((x) => x.h.id)).toEqual(['proven', 'tiny', 'unknown']);
  });
  it('retains every candidate and never mutates the eligible pool', async () => {
    const before = structuredClone(weighted);
    const result = await order();
    expect(result).toHaveLength(weighted.length);
    expect(result.map((x) => x.h.id).sort()).toEqual(weighted.map((x) => x.h.id).sort());
    expect(weighted).toEqual(before);
  });
  it('retains the existing weighted draw when performance is unreadable', async () => {
    expect((await order(madness, new Map())).map((x) => x.h.id)).toEqual([
      'tiny',
      'unknown',
      'proven',
    ]);
  });
  it('leaves ordinary Classic, other variants and unqualified rules on the existing draw', async () => {
    // The identity is the cluster's ruleset plus the plo5 scope (2026-11-17).
    // A floor value is deliberately NOT one of these cases any more: every PLO
    // table reads 40 now, so 40 must not be what makes a table ordinary.
    for (const over of [
      { rules_profile: undefined },
      { rules_profile: null },
      { rules_profile: 'classic' },
      { rules_profile: 'madness' },
      { game_variant: 'nlh' },
      { game_variant: 'plo6' },
    ]) {
      expect((await order({ ...madness, ...over })).map((x) => x.h.id)).toEqual([
        'tiny',
        'unknown',
        'proven',
      ]);
    }
  });
  it('still prefers measured strength when the floor reads 40, not 50', async () => {
    // The regression this guards: moving the floor to 40 must not silently turn
    // the measured-PLO ordering off for the tables it was built for.
    const atForty = { ...madness, maintain_percent_min: 40 };
    expect((await order(atForty)).map((x) => x.h.id)).toEqual(['proven', 'tiny', 'unknown']);
  });

  it('never calls a Lightning or Action plo5 table Madness', async () => {
    // These share the bomb pot, the big-blind ante, the nit game and now the
    // 40 floor, so only the ruleset keeps them apart.
    const lightning = { ...madness, rules_profile: null, maintain_percent_min: 40 };
    expect((await order(lightning)).map((x) => x.h.id)).toEqual(['tiny', 'unknown', 'proven']);
  });

  it('treats missing and invalid samples as unknown, never as proven wins', async () => {
    for (const bad of [
      { hands: 0, bb100: 1000 },
      { hands: NaN, bb100: 1000 },
      { hands: 20, bb100: Infinity },
      { hands: -1, bb100: 1000 },
    ]) {
      expect(
        (
          await order(
            madness,
            new Map([
              ['tiny', bad],
              ['proven', { hands: 10000, bb100: 15 }],
            ])
          )
        ).map((x) => x.h.id)
      ).toEqual(['proven', 'tiny', 'unknown']);
    }
  });
});
