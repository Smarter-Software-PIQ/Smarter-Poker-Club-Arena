import { describe, expect, it } from 'vitest';
import {
  PUBLIC_HIST215_V1,
  PUBLIC_HIST215_V2,
  PUBLIC_HIST215_V3,
} from './GtoPublicHist215Contracts.js';
import {
  compilePublic215Template,
  encodePublic215V2Appended,
  encodePublic215V3Appended,
  public215TemplateMatchesContext,
  type Public215Template,
} from './GtoPublicHist215Features.js';
import { public215Digest } from './GtoPublicHist215Model.js';

// FLOP-5 D6 (dormant): a holdem-public-hist215-v3 template is authored over a
// cell contract v3 cell, the 13 context keys plus cell_contract "v3" and its
// line_class (World Hub public_hist215 ties the descriptor and the contexts both
// ways). v1 and v2 templates keep exactly the 13-key shape they always had.
const hex = (n: number) => {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, n, false);
  return v.getBigUint64(0, false).toString(16).padStart(16, '0');
};
const BASE = {
  depth_bucket: 80,
  table_size: 6,
  game_family: 'cash',
  objective: 'cash_ev',
  utility_context: 'cash_ev',
  pot_type: 'srp',
  hero_position: 'BB',
  opponent_position: 'BTN',
  street: 'turn',
  texture_class: 'Brpd',
  node_role: 'facing_bet',
  facing_kind: 'bet',
  facing_size_bucket: 'mid',
};
function wire(context: Record<string, unknown>): Public215Template {
  return {
    format: 'public_hist215_template_v1',
    root_actor: 'OOP',
    context: context as unknown as Public215Template['context'],
    scenario: {
      pot_chips_f64: hex(600),
      effective_stack_chips_f64: hex(20000),
      chips_per_bb_f64: hex(100),
      rake_f64: [hex(0.1), hex(250)],
      ip_range_checksum: '1eff0dca52c74b86d77a314c3554cb7357e42e3979bda3970e306dd242e63b19',
      oop_range_checksum: '22f7c9b7c5cd1a795476f2e5419b1829d6e13bbfe6dd7a682c56f8c6c72a387e',
    },
    opponent_weights: Array(1326).fill('1'),
  };
}
type Version = typeof PUBLIC_HIST215_V1 | typeof PUBLIC_HIST215_V2 | typeof PUBLIC_HIST215_V3;
const compile = (context: Record<string, unknown>, v: Version) => {
  const w = wire(context);
  return compilePublic215Template(w, public215Digest(w), v);
};
const V3 = { ...BASE, cell_contract: 'v3', line_class: 'x.b-mid.c/x' };

describe('public215 template over a cell contract v3 cell (dormant)', () => {
  it('v1 and v2 keep the 13-key template and refuse the v3 keys (default unchanged)', () => {
    // (the R8 ranges here are v2 categories, so v1 refuses BASE by category, as before)
    expect(() => compile(BASE, PUBLIC_HIST215_V1)).toThrow(
      /UNKNOWN_PUBLIC_CATEGORY|RANGE_CATEGORY/
    );
    expect(compile(BASE, PUBLIC_HIST215_V2).context).toEqual(BASE);
    for (const v of [PUBLIC_HIST215_V1, PUBLIC_HIST215_V2] as const) {
      expect(() => compile(V3, v)).toThrow(/KEYS/);
      expect(() => compile({ ...BASE, line_class: 'x' }, v)).toThrow(/KEYS/);
    }
  });

  it('v3 takes exactly the 15-key v3 cell and refuses anything else', () => {
    const t = compile(V3, PUBLIC_HIST215_V3);
    expect(t.context).toEqual(V3);
    expect(() => compile(BASE, PUBLIC_HIST215_V3)).toThrow(/KEYS/);
    expect(() => compile({ ...V3, cell_contract: 'v4' }, PUBLIC_HIST215_V3)).toThrow(
      /CELL_CONTRACT_V3/
    );
    // the line must be well formed and name the node's street (turn: one '/')
    for (const line_class of ['x.b-mid.c', 'x/x/x', 'q', 7])
      expect(() => compile({ ...V3, line_class }, PUBLIC_HIST215_V3)).toThrow(/CELL_CONTRACT_V3/);
    // donk and the overbet bucket encode under v3 only
    const donk = { ...V3, node_role: 'donk', facing_kind: 'none', facing_size_bucket: 'none' };
    expect(encodePublic215V3Appended(compile(donk, PUBLIC_HIST215_V3))).toEqual([0, 1]);
    expect(
      encodePublic215V3Appended(compile({ ...V3, facing_size_bucket: 'big' }, PUBLIC_HIST215_V3))
    ).toEqual([1, 0]);
  });

  it('the v3 keys do not light any v2 or v3 column', () => {
    const t2 = compile(BASE, PUBLIC_HIST215_V2);
    const t3 = compile(V3, PUBLIC_HIST215_V3);
    expect(encodePublic215V2Appended(t3)).toEqual(encodePublic215V2Appended(t2));
    expect(encodePublic215V3Appended(t3)).toEqual([0, 0]);
  });

  it('matches a v3 template only to a v3 cell of its own line, and a v2 one only to a v2 cell', () => {
    const t3 = compile(V3, PUBLIC_HIST215_V3);
    const t2 = compile(BASE, PUBLIC_HIST215_V2);
    const row3 = { ...BASE, cell_contract_version: 'v3', line_class: V3.line_class };
    // a runtime row (cell_contract_version) and a context (cell_contract) both work
    expect(public215TemplateMatchesContext(t3, row3)).toBe(true);
    expect(public215TemplateMatchesContext(t3, V3)).toBe(true);
    expect(public215TemplateMatchesContext(t3, { ...row3, line_class: 'x.b-big.c/x' })).toBe(false);
    expect(public215TemplateMatchesContext(t3, BASE)).toBe(false);
    expect(public215TemplateMatchesContext(t3, { ...row3, cell_contract_version: null })).toBe(
      false
    );
    expect(public215TemplateMatchesContext(t2, row3)).toBe(false);
    expect(public215TemplateMatchesContext(t2, V3)).toBe(false);
    // v2 answers are the original ones, with the new fields absent or null
    expect(public215TemplateMatchesContext(t2, BASE)).toBe(true);
    expect(
      public215TemplateMatchesContext(t2, {
        ...BASE,
        cell_contract_version: null,
        line_class: null,
      })
    ).toBe(true);
    expect(public215TemplateMatchesContext(t2, { ...BASE, depth_bucket: 150 })).toBe(false);
  });
});
