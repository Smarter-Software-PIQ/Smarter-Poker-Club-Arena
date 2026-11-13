import { describe, expect, it } from 'vitest';
import descriptorV2 from './GtoPublicHist215FeatureDescriptorV2.json' with { type: 'json' };
import {
  PUBLIC_HIST215_V1,
  PUBLIC_HIST215_V2,
  PUBLIC_HIST215_V2_FEATURE_SCHEMA_SHA256,
  PUBLIC_HIST215_V3,
  PUBLIC_HIST215_V3_FEATURE_SCHEMA_SHA256,
  public215FeatureContract,
  public215FeatureContractBySchema,
} from './GtoPublicHist215Contracts.js';
import {
  PUBLIC_HIST215_V3_DESCRIPTOR,
  compilePublic215Template,
  encodePublic215V2Appended,
  encodePublic215V3Appended,
  public215ContractVector,
  type Public215Template,
} from './GtoPublicHist215Features.js';
import {
  PUBLIC_HIST215_PRIOR,
  PUBLIC_HIST215_V2_APPENDED,
  PUBLIC_HIST215_V3_APPENDED,
} from './GtoPublicHist215FeatureSchema.js';
import {
  compilePublicHist215,
  public215Digest,
  type PublicHist215Payload,
} from './GtoPublicHist215Model.js';

// V31 cell contract v3 (2026-11-13, dormant): holdem-public-hist215-v3 is v2's 246
// features followed by the overbet facing bucket and the 'donk' role. World Hub
// public_hist215.FEATURE_DESCRIPTOR_V3_SHA256 pins the same digest.
const hex = (n: number) => {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, n, false);
  return v.getBigUint64(0, false).toString(16).padStart(16, '0');
};
const R8_IP = '1eff0dca52c74b86d77a314c3554cb7357e42e3979bda3970e306dd242e63b19';
const R8_OOP = '22f7c9b7c5cd1a795476f2e5419b1829d6e13bbfe6dd7a682c56f8c6c72a387e';
function wire(context: Partial<Public215Template['context']> = {}): Public215Template {
  return {
    format: 'public_hist215_template_v1',
    root_actor: 'OOP',
    context: {
      depth_bucket: 200,
      table_size: 6,
      game_family: 'cash',
      objective: 'cash_ev',
      utility_context: 'cash_ev',
      pot_type: 'srp',
      hero_position: 'BB',
      opponent_position: 'BTN',
      street: 'flop',
      texture_class: 'Brpd',
      node_role: 'facing_bet',
      facing_kind: 'bet',
      facing_size_bucket: 'mid',
      ...context,
    },
    scenario: {
      pot_chips_f64: hex(600),
      effective_stack_chips_f64: hex(20000),
      chips_per_bb_f64: hex(100),
      rake_f64: [hex(0.1), hex(250)],
      ip_range_checksum: R8_IP,
      oop_range_checksum: R8_OOP,
    },
    opponent_weights: Array(1326).fill('1'),
  };
}
const compile = (
  w: Public215Template,
  v: typeof PUBLIC_HIST215_V1 | typeof PUBLIC_HIST215_V2 | typeof PUBLIC_HIST215_V3
) => compilePublic215Template(w, public215Digest(w), v);

describe('public215 feature contract v3 (cell contract v3, dormant)', () => {
  it('is v2 plus two appended one-hots, with its own pinned digest', () => {
    expect(public215FeatureContract(PUBLIC_HIST215_V3)).toEqual({
      version: PUBLIC_HIST215_V3,
      schemaSha256: PUBLIC_HIST215_V3_FEATURE_SCHEMA_SHA256,
      featureCount: 248,
    });
    expect(PUBLIC_HIST215_V3_FEATURE_SCHEMA_SHA256).toBe(
      '26d9271d8b1b1b2400476e9cb1c22662e0086bf5111b1f2e1ce7281ef131b784'
    );
    expect(public215FeatureContractBySchema(PUBLIC_HIST215_V3_FEATURE_SCHEMA_SHA256)?.version).toBe(
      PUBLIC_HIST215_V3
    );
    expect(public215Digest(PUBLIC_HIST215_V3_DESCRIPTOR)).toBe(
      PUBLIC_HIST215_V3_FEATURE_SCHEMA_SHA256
    );
    expect(PUBLIC_HIST215_V3_APPENDED).toEqual(['facing_size_bucket=big', 'node_role=donk']);
    expect(PUBLIC_HIST215_V3_DESCRIPTOR.feature_order.slice(0, 246)).toEqual(
      descriptorV2.feature_order
    );
    expect(PUBLIC_HIST215_V3_DESCRIPTOR.feature_order.slice(246)).toEqual([
      ...PUBLIC_HIST215_V3_APPENDED,
    ]);
    expect(PUBLIC_HIST215_V3_DESCRIPTOR.predecessor_schema_sha256).toBe(
      PUBLIC_HIST215_V2_FEATURE_SCHEMA_SHA256
    );
    const seen = new Set<string>([...PUBLIC_HIST215_PRIOR, ...PUBLIC_HIST215_V2_APPENDED]);
    for (const k of PUBLIC_HIST215_V3_APPENDED) expect(seen.has(k)).toBe(false);
    // The v2 descriptor file and digest are untouched.
    expect(public215Digest(descriptorV2)).toBe(PUBLIC_HIST215_V2_FEATURE_SCHEMA_SHA256);
  });

  it('encodes an overbet-facing node and a donk node only under v3', () => {
    for (const context of [
      { facing_size_bucket: 'big' },
      { node_role: 'donk', facing_kind: 'none', facing_size_bucket: 'none' },
    ]) {
      const w = wire(context);
      expect(() => compile(w, PUBLIC_HIST215_V1)).toThrow();
      expect(() => compile(w, PUBLIC_HIST215_V2)).toThrow(/UNKNOWN_PUBLIC_CATEGORY/);
      expect(compile(w, PUBLIC_HIST215_V3).featureContract).toBe(PUBLIC_HIST215_V3);
    }
    expect(
      encodePublic215V3Appended(compile(wire({ facing_size_bucket: 'big' }), PUBLIC_HIST215_V3))
    ).toEqual([1, 0]);
    expect(
      encodePublic215V3Appended(
        compile(
          wire({ node_role: 'donk', facing_kind: 'none', facing_size_bucket: 'none' }),
          PUBLIC_HIST215_V3
        )
      )
    ).toEqual([0, 1]);
  });

  it('keeps the first 246 features of a v2-encodable node byte-identical', () => {
    const v1 = Array.from({ length: 215 }, (_, i) => (i * 13) / 7);
    const t2 = compile(wire(), PUBLIC_HIST215_V2);
    const t3 = compile(wire(), PUBLIC_HIST215_V3);
    const out2 = public215ContractVector(v1, t2);
    const out3 = public215ContractVector(v1, t3);
    expect(out2).toHaveLength(246);
    expect(out3).toHaveLength(248);
    expect(out3.slice(0, 246)).toEqual(out2);
    expect(out3.slice(246)).toEqual([0, 0]);
    expect(encodePublic215V2Appended(t3)).toEqual(encodePublic215V2Appended(t2));
  });

  it('binds a 248-wide model to the v3 descriptor only', () => {
    const d = 'a'.repeat(64);
    const model = (schema: string, width: 246 | 248): PublicHist215Payload => ({
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
    const bind = (p: PublicHist215Payload) =>
      compilePublicHist215(p, {
        model_sha256: public215Digest(p),
        template_sha256: d,
        feature_schema_sha256: p.feature_schema_sha256,
        provenance_sha256: d,
        action_ids: p.action_ids,
      });
    const v3 = bind(model(PUBLIC_HIST215_V3_FEATURE_SCHEMA_SHA256, 248));
    expect(v3.featureCount).toBe(248);
    expect(() => v3.predict(Array(248).fill(0))).not.toThrow();
    expect(() => v3.predict(Array(246).fill(0))).toThrow();
    expect(() => bind(model(PUBLIC_HIST215_V3_FEATURE_SCHEMA_SHA256, 246))).toThrow();
    expect(() => bind(model(PUBLIC_HIST215_V2_FEATURE_SCHEMA_SHA256, 248))).toThrow();
  });
});
