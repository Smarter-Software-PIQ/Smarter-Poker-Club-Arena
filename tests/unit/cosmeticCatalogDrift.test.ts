import { describe, expect, it } from 'vitest';
import {
  compareCosmeticCatalogs,
  loadCodeCatalogs,
} from '../../scripts/ci/check-cosmetic-catalog-drift.mjs';

function buildMatchingDb(code: Record<string, Map<string, string>>) {
  const db = new Map<string, string>();
  for (const [category, entries] of Object.entries(code)) {
    for (const [assetId, tier] of entries) {
      db.set(`${category}:${assetId}`, tier);
    }
  }
  return db;
}

describe('check-cosmetic-catalog-drift — canonical catalogs and legacy card-back aliases', () => {
  it('accepts dragon and galaxy in cosmetic_catalog when they match their canonical VIP targets', () => {
    const { code, aliases } = loadCodeCatalogs();
    expect(aliases.cards_id.get('dragon')).toBe('diamond');
    expect(aliases.cards_id.get('galaxy')).toBe('neon');

    const db = buildMatchingDb(code);
    db.set('cards_id:dragon', 'vip');
    db.set('cards_id:galaxy', 'vip');

    expect(compareCosmeticCatalogs({ code, aliases, db })).toEqual([]);
  });

  it('rejects a legacy alias whose database tier disagrees with its canonical target', () => {
    const { code, aliases } = loadCodeCatalogs();
    const db = buildMatchingDb(code);
    db.set('cards_id:dragon', 'free');

    const problems = compareCosmeticCatalogs({ code, aliases, db });
    expect(problems).toEqual([
      'cards_id/dragon: legacy alias of diamond (vip), database says free',
    ]);
  });

  it('still rejects any unknown asset in cosmetic_catalog that is neither canonical nor an alias', () => {
    const { code, aliases } = loadCodeCatalogs();
    const db = buildMatchingDb(code);
    db.set('cards_id:mystery_back', 'vip');

    const problems = compareCosmeticCatalogs({ code, aliases, db });
    expect(problems).toEqual(['cards_id/mystery_back: in cosmetic_catalog, MISSING from code']);
  });
});
