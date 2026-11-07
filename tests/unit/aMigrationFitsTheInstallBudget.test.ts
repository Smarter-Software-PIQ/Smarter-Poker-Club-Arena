/**
 * A MIGRATION THAT CANNOT FINISH INSIDE THE INSTALL BUDGET DOES NOT MERGE
 * (2026-11-07). See scripts/ci/migration-cost-shape.mjs.
 *
 * Three merged migrations died on 2026-11-07 inside the applier's 12 s
 * transaction budget with nothing committed. Two of them read chip_ledger by a
 * LIKE prefix on idempotency_key, which no index answers. This pins that the
 * merge check refuses the pattern from COST_CHECKED_FROM on, that the applier
 * asks the same question, and that the exact bytes that failed are caught.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  COST_CHECKED_FROM,
  isCostChecked,
  migrationCostRisks,
} from '../../scripts/ci/migration-cost-shape.mjs';

const ROOT = resolve(__dirname, '../..');
const DIR = join(ROOT, 'supabase/migrations');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

describe('a migration fits the install budget', () => {
  it('every migration from the cut-over on is free of the known budget killers', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.sql') && isCostChecked(f));
    for (const f of files) expect(migrationCostRisks(f, read(f)), f).toEqual([]);
  });

  it('catches the exact merged bytes that died in production on 2026-11-07', () => {
    for (const [file, rev] of [
      ['20261107133350_the_weekly_close_is_evidence_not_cache.sql', '978c425bef'],
    ] as const) {
      let sql = '';
      try {
        sql = execFileSync('git', ['show', `${rev}:supabase/migrations/${file}`], { cwd: ROOT, encoding: 'utf8' });
      } catch {
        // A shallow checkout may not hold the commit; the synthetic cases below still pin the rule.
        continue;
      }
      expect(migrationCostRisks(file, sql).length, file).toBeGreaterThan(0);
    }
  });

  it('refuses a LIKE prefix on chip_ledger.idempotency_key in code', () => {
    const sql = "BEGIN;\nDO $$ BEGIN\n  IF (SELECT count(*) FROM public.chip_ledger l\n       WHERE l.idempotency_key LIKE 'bounty-only-final-two-make-good:%') <> 6 THEN RAISE EXCEPTION 'x'; END IF;\nEND $$;\nCOMMIT;\n";
    expect(migrationCostRisks('x.sql', sql)).toHaveLength(1);
    const built = "BEGIN;\nSELECT jsonb_object_agg(to_entity_id::text,1) FROM public.chip_ledger WHERE idempotency_key LIKE 'union_close:'||c_sid||':%';\nCOMMIT;\n";
    expect(migrationCostRisks('x.sql', built)).toHaveLength(1);
  });

  it('refuses the same scan in a live-proof, which production also runs', () => {
    const sql = "-- @live-proof: (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key LIKE 'k:%') = 6\nBEGIN;\nSELECT 1;\nCOMMIT;\n";
    expect(migrationCostRisks('x.sql', sql)).toHaveLength(1);
  });

  it('accepts named keys, and LIKE on other tables or in comments', () => {
    const ok = [
      "BEGIN;\nSELECT count(*) FROM public.chip_ledger WHERE idempotency_key = ANY (ARRAY['a','b']);\nCOMMIT;\n",
      "BEGIN;\nSELECT count(*) FROM public.chip_ledger WHERE idempotency_key = 'a';\nCOMMIT;\n",
      "BEGIN;\nSELECT count(*) FROM public.ca_manual_adjustments WHERE decision_note LIKE 'migration 2026%';\nCOMMIT;\n",
      "BEGIN;\n-- chip_ledger WHERE idempotency_key LIKE 'k:%' was the old way\nSELECT 1;\nCOMMIT;\n",
      "BEGIN;\nSELECT 1 FROM public.wallet_credit_idempotency WHERE idempotency_key LIKE 'k:%';\nSELECT 1 FROM public.chip_ledger WHERE id = 'x';\nCOMMIT;\n",
    ];
    for (const sql of ok) expect(migrationCostRisks('x.sql', sql), sql).toEqual([]);
  });

  it('judges only from the cut-over on, so merged history is not re-judged', () => {
    expect(isCostChecked(`${COST_CHECKED_FROM}_x.sql`)).toBe(true);
    expect(isCostChecked('20261107133350_the_weekly_close_is_evidence_not_cache.sql')).toBe(false);
  });

  it('the applier asks the same question before it sends anything', () => {
    const applier = readFileSync(join(ROOT, 'scripts/ci/apply-recorded-migration.mjs'), 'utf8');
    expect(applier).toContain("from './migration-cost-shape.mjs'");
    const shapeAt = applier.indexOf('const shape = migrationTransactionShape(file, sql);');
    const costAt = applier.indexOf('const risks = migrationCostRisks(file, sql);');
    expect(shapeAt).toBeGreaterThan(0);
    expect(costAt).toBeGreaterThan(shapeAt);
    expect(applier.slice(costAt, costAt + 120)).toContain('refused(');
    expect(costAt).toBeLessThan(applier.indexOf('client.connect('));
  });
});
