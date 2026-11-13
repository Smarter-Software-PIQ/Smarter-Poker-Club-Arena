import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { CARD_BACK_CATALOG } from '../src/components/table/CardImage';

// feature_pricing is the server's price list and fn_purchase_feature_v2 sells
// any row on it. #10308 cut the Table Studio to ten printed card backs, seven
// of them paid, but the database kept card_back_dragon (125) and
// card_back_galaxy (75): SKUs nobody could see, which a direct call could
// still buy, and which failed Post-Deploy E2E's storefront census (operational
// alert 371597). Replaying every migration's feature_pricing writes must leave
// exactly the paid catalogue on sale, at the catalogue's prices.

const MIGRATIONS = 'supabase/migrations';

function replayCardBackPrices(): Map<string, number> {
  const live = new Map<string, number>();
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--[^\n]*/g, '');
    const writes = sql.matchAll(
      /(INSERT\s+INTO|DELETE\s+FROM)\s+(?:public\.)?feature_pricing\b([\s\S]*?);/gi
    );
    for (const [, verb, body] of writes) {
      if (/^DELETE/i.test(verb)) {
        for (const [, id] of body.matchAll(/'card_back_([a-z0-9_-]+)'/g)) live.delete(id);
        continue;
      }
      for (const [, id, cost] of body.matchAll(/\(\s*'card_back_([a-z0-9_-]+)'\s*,\s*(\d+)/g)) {
        live.set(id, Number(cost));
      }
    }
  }
  return live;
}

it('sells exactly the paid card-back catalogue, at its prices', () => {
  const paid = new Map(
    CARD_BACK_CATALOG.filter((design) => design.price > 0).map((design) => [
      design.id as string,
      design.price,
    ])
  );
  const priced = replayCardBackPrices();
  expect(paid.size).toBeGreaterThan(0);
  expect(Object.fromEntries([...priced].sort())).toEqual(Object.fromEntries([...paid].sort()));
});

it('keeps the production storefront census on the catalogue count', () => {
  const spec = readFileSync('tests/e2e/production-customization-commerce.spec.ts', 'utf8');
  const paid = CARD_BACK_CATALOG.filter((design) => design.price > 0).length;
  expect(spec).toContain(`{ tab: 'Cards', count: ${paid}, prefix: 'card_back_' }`);
});
