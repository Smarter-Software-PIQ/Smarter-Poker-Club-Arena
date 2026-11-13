import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  PUBLIC_HIST215_V1,
  PUBLIC_HIST215_V1_FEATURE_SCHEMA_SHA256,
  PUBLIC_HIST215_V2,
  PUBLIC_HIST215_V2_FEATURE_SCHEMA_SHA256,
  public215FeatureContract,
  public215FeatureContractBySchema,
} from './GtoPublicHist215Contracts.js';
import {
  compilePublic215Template,
  encodePublic215V2Appended,
  public215ContractVector,
  type Public215Template,
} from './GtoPublicHist215Features.js';
import { PUBLIC_HIST215_V2_APPENDED } from './GtoPublicHist215FeatureSchema.js';
import {
  compilePublicHist215,
  public215Digest,
  type PublicHist215Payload,
} from './GtoPublicHist215Model.js';

const hex = (n: number) => {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, n, false);
  return v.getBigUint64(0, false).toString(16).padStart(16, '0');
};
const R8_IP = '1eff0dca52c74b86d77a314c3554cb7357e42e3979bda3970e306dd242e63b19';
function wire(): Public215Template {
  return {
    format: 'public_hist215_template_v1',
    root_actor: 'IP',
    context: {
      depth_bucket: 80,
      table_size: 2,
      game_family: 'cash',
      objective: 'cash_ev',
      utility_context: 'cash_ev',
      pot_type: 'srp',
      hero_position: 'BTN',
      opponent_position: 'BB',
      street: 'flop',
      texture_class: 'Brud',
      node_role: 'cbet',
      facing_kind: 'none',
      facing_size_bucket: 'none',
    },
    scenario: {
      pot_chips_f64: hex(60),
      effective_stack_chips_f64: hex(800),
      chips_per_bb_f64: hex(10),
      rake_f64: [hex(5), hex(3)],
      ip_range_checksum: '01b3d4e721b36cf6d8d89fd4941b5ece0e9fd2853f61d1e5f98fbebb3f8f5228',
      oop_range_checksum: '3ac1e6fa6d92a000680addaf06eab130d2af9467d2e90aceae7cb542b8725c11',
    },
    opponent_weights: Array(1326).fill('1'),
  };
}
function r8Wire(): Public215Template {
  const w = wire();
  w.context.table_size = 6;
  w.context.hero_position = 'UTG';
  w.context.opponent_position = 'CO';
  w.context.facing_size_bucket = 'mid';
  w.scenario.ip_range_checksum = R8_IP;
  return w;
}
const compile = (w: Public215Template, v?: typeof PUBLIC_HIST215_V1 | typeof PUBLIC_HIST215_V2) =>
  compilePublic215Template(w, public215Digest(w), v);

describe('public215 feature contract v2 (appended R8 categories)', () => {
  it('declares two contracts with their own descriptors and widths, never inferred', () => {
    expect(public215FeatureContract(PUBLIC_HIST215_V1)?.featureCount).toBe(215);
    expect(public215FeatureContract(PUBLIC_HIST215_V2)?.featureCount).toBe(246);
    // v3 exists since V31 cell contract v3 (GtoPublicHist215FeatureContractV3.test.ts); v4 does not.
    expect(public215FeatureContract('holdem-public-hist215-v4')).toBeNull();
    expect(public215FeatureContractBySchema(PUBLIC_HIST215_V1_FEATURE_SCHEMA_SHA256)?.version).toBe(
      PUBLIC_HIST215_V1
    );
    expect(public215FeatureContractBySchema(PUBLIC_HIST215_V2_FEATURE_SCHEMA_SHA256)?.version).toBe(
      PUBLIC_HIST215_V2
    );
    expect(PUBLIC_HIST215_V2_FEATURE_SCHEMA_SHA256).toBe(
      'c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4'
    );
    expect(PUBLIC_HIST215_V2_APPENDED).toHaveLength(31);
    expect([...PUBLIC_HIST215_V2_APPENDED].sort()).toEqual([...PUBLIC_HIST215_V2_APPENDED]);
    const d = JSON.parse(
      readFileSync(new URL('./GtoPublicHist215FeatureDescriptorV2.json', import.meta.url), 'utf8')
    );
    expect(d.feature_count).toBe(246);
    expect(d.feature_order.slice(215)).toEqual(
      PUBLIC_HIST215_V2_APPENDED.map((k: string) => expect.stringContaining(k))
    );
    expect(d.predecessor_schema_sha256).toBe(PUBLIC_HIST215_V1_FEATURE_SCHEMA_SHA256);
  });
  it('keeps v1 the default and refuses R8 categories under v1', () => {
    expect(compile(wire()).featureContract).toBe(PUBLIC_HIST215_V1);
    expect(() => compile(r8Wire())).toThrow();
    expect(() => compile(r8Wire(), PUBLIC_HIST215_V1)).toThrow();
    const bad = r8Wire();
    bad.context.hero_position = 'MP';
    expect(() => compile(bad, PUBLIC_HIST215_V2)).toThrow();
  });
  it('one-hots exactly the appended categories of an R8 template', () => {
    const t = compile(r8Wire(), PUBLIC_HIST215_V2);
    const a = encodePublic215V2Appended(t);
    expect(a).toHaveLength(31);
    const on = PUBLIC_HIST215_V2_APPENDED.filter((_: string, i: number) => a[i] === 1);
    expect(on).toEqual([
      'facing_size_bucket=mid',
      'hero_position=UTG',
      'iprange=' + R8_IP,
      'opponent_position=CO',
    ]);
    expect(a.filter((x) => x !== 0 && x !== 1)).toEqual([]);
  });
  it('leaves the v1 vector untouched and appends zeros for a v1 template read as v2', () => {
    const v1 = Array.from({ length: 215 }, (_, i) => i / 7);
    const t1 = compile(wire(), PUBLIC_HIST215_V1);
    expect(public215ContractVector(v1, t1)).toEqual(v1);
    const t2 = compile(wire(), PUBLIC_HIST215_V2);
    const out = public215ContractVector(v1, t2);
    expect(out).toHaveLength(246);
    expect(out.slice(0, v1.length)).toEqual(v1);
    expect(out.slice(215).every((x) => x === 0)).toBe(true);
    expect(() => public215ContractVector(v1.slice(1), t1)).toThrow();
    expect(
      createHash('sha256')
        .update(JSON.stringify(public215ContractVector(v1, t1)))
        .digest('hex')
    ).toBe(createHash('sha256').update(JSON.stringify(v1)).digest('hex'));
  });
  it('binds a 246-wide model to the v2 descriptor and keeps 215 for every other', () => {
    const d = 'a'.repeat(64);
    const model = (schema: string, width: 215 | 246): PublicHist215Payload => ({
      format: 'public_hist215_v1',
      feature_count: width,
      variant: 'direct',
      action_ids: ['check', 'bet'],
      template_sha256: d,
      feature_schema_sha256: schema,
      provenance_sha256: d,
      heads: [7, 2, 4, 0.25, 0.75].map((n) => ({
        baseline_f64: hex(n),
        trees: Array.from({ length: 100 }, () => [
          { feature: width - 1, threshold_f64: hex(0.5), left: 1, right: 2, missing_left: true },
          { value_f64: hex(0) },
          { value_f64: hex(0) },
        ]),
      })),
    });
    const compile = (p: PublicHist215Payload) =>
      compilePublicHist215(p, {
        model_sha256: public215Digest(p),
        template_sha256: d,
        feature_schema_sha256: p.feature_schema_sha256,
        provenance_sha256: d,
        action_ids: p.action_ids,
      });
    const v2 = compile(model(PUBLIC_HIST215_V2_FEATURE_SCHEMA_SHA256, 246));
    expect(v2.featureCount).toBe(246);
    expect(() => v2.predict(Array(246).fill(0))).not.toThrow();
    expect(() => v2.predict(Array(215).fill(0))).toThrow();
    expect(() => compile(model(PUBLIC_HIST215_V2_FEATURE_SCHEMA_SHA256, 215))).toThrow();
    expect(compile(model(PUBLIC_HIST215_V1_FEATURE_SCHEMA_SHA256, 215)).featureCount).toBe(215);
    expect(compile(model(d, 215)).featureCount).toBe(215);
    expect(() => compile(model(d, 246))).toThrow();
  });
});
