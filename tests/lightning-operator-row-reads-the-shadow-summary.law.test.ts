import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * THE LIGHTNING OPERATOR ROW READS THE SHADOW SUMMARY (2026-11-15).
 *
 * Lightning > Operator answered HTTP 500 (8 s statement timeout) because each
 * cluster row with a shadow comparison this week ran the full
 * fn_lightning_shadow_report to keep five fields of its first version pair.
 * 20261115010232 patches the installed row (production md5 dc81e3aa...) to
 * read that summary itself. This law pins the patch against the production
 * bytes it was written for; tests/unit/lightningOperatorRowShadowSummary.pg.test.ts
 * proves on real PostgreSQL that every row is unchanged and the work falls.
 */
const ROOT = resolve(__dirname, '..');
const FIX = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20261115010232_lightning_operator_row_reads_the_shadow_summary.sql'
  ),
  'utf8'
);
const FIXTURE = JSON.parse(
  readFileSync(
    resolve(ROOT, 'scripts/ci/fixtures/lightning-operator-installed-20261115.json'),
    'utf8'
  )
) as Array<{ signature: string; md5: string; definition: string }>;
const ROW = FIXTURE.find((f) => f.signature.startsWith('fn_lightning_operator_cluster_row('))!;

const md5 = (text: string) => createHash('md5').update(text).digest('hex');
const pairs = [...FIX.matchAll(/\$a\$([\s\S]*?)\$a\$/g)].map((m) => m[1]);
const keys = (def: string) =>
  [...def.slice(def.lastIndexOf('RETURN jsonb_build_object(')).matchAll(/^\s+'([a-z_]+)',/gm)].map(
    (m) => m[1]
  );

function patched(): string {
  let d = ROW.definition;
  for (let i = 0; i < pairs.length; i += 2) {
    expect(d.split(pairs[i]).length - 1, pairs[i].slice(0, 60)).toBe(1);
    d = d.replace(pairs[i], () => pairs[i + 1]);
  }
  return d;
}

describe('the Lightning operator row reads the shadow summary', () => {
  it('the fixture is the production image it says it is', () => {
    for (const f of FIXTURE) expect(md5(f.definition), f.signature).toBe(f.md5);
    expect(ROW.md5).toBe('dc81e3aa94d6994c11e3894e733cacac');
    expect(ROW.definition).toContain('public.fn_lightning_shadow_report(g.id');
  });

  it('patches that image under its md5, two anchors, each exactly once, in one short transaction', () => {
    expect(FIX).toContain(`'${ROW.md5}'`);
    expect(pairs).toHaveLength(4);
    expect(FIX.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(FIX.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(FIX).toContain("SET LOCAL lock_timeout = '1s';");
    expect(FIX).toMatch(/^-- @live-proof: \(SELECT pg_get_functiondef/m);
    patched();
  });

  it('the patched row never calls the report and returns every key it returned before', () => {
    const d = patched();
    expect(d).not.toContain('public.fn_lightning_shadow_report(');
    expect(d).not.toMatch(/\bv_sr\b/);
    expect(keys(d)).toEqual(keys(ROW.definition));
    expect(keys(d)).toContain('shadow');
    // The summary keeps the report's rules: binding, seated, both scores, first pair.
    for (const rule of [
      "lm.snapshot_binding #>> '{}' = v_bind",
      "sm.snapshot_binding #>> '{}' = lm.snapshot_binding #>> '{}'",
      'x.live_quality_score IS NOT NULL',
      "ORDER BY (r.sv = r.lv || '-port'), r.n DESC, r.lv, r.sv",
      'v_sr_to := LEAST(v_now, now());',
      "WHEN r.d_mean > 0 AND r.d_fail <= 0 THEN 'shadow_leads'",
    ])
      expect(d, rule).toContain(rule);
  });
});
