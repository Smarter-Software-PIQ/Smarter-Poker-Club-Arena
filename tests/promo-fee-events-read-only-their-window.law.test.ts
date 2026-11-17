import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * PROMO FEE EVENTS READ ONLY THE WINDOW THEY ANSWER (2026-11-17). The cash CTE
 * of fn_ca_promo_fee_events read a player's entire rake history before keeping
 * earned_at >= p_from; with Horses holding 76k-row histories the per-hand promo
 * triggers pushed Lightning post-commit obligations past their 8 s timeout (576
 * alerts in three hours). This law fails the build if the newest definition of
 * fn_ca_promo_fee_events reads rake_attributions without a lower created_at bound.
 */
const DIR = join(__dirname, '..', 'supabase', 'migrations');
const FN = 'fn_ca_promo_fee_events';

describe('promo fee events read only the window they answer', () => {
  it('the newest definition bounds the rake read by p_from', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const defining = files.filter((f) => {
      const sql = readFileSync(join(DIR, f), 'utf8');
      return new RegExp(
        `(CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${FN}\\b|'public\\.${FN}\\()`,
        'i'
      ).test(sql);
    });
    expect(defining.length).toBeGreaterThan(0);
    const sql = readFileSync(join(DIR, defining[defining.length - 1]), 'utf8');
    expect(sql).toMatch(/a\.created_at\s*>=\s*p_from/);
    expect(sql).toMatch(/anchor found % times|CREATE\s+OR\s+REPLACE/i);
  });
});
