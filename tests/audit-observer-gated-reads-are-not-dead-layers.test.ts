import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 2026-11-06 daily horse audit, finding 1. fn_audit_layer_silence warned
 * "v16_reads_tell fired ZERO times ... zero here means the repair did not
 * take" on 11-04, 11-05 and 11-06. The tell is observer-gated since #8075
 * (each horse reads only its own observations, and a restart cannot rebuild a
 * showdown counter from card-free history). The migration narrows that one
 * layer to a note; everything else it watches keeps its warn.
 */
const MIGRATION = fs.readFileSync(
  path.join(
    path.resolve(__dirname, '..'),
    'supabase/migrations/20261107233449_audit_observer_gated_reads_are_not_dead_layers.sql'
  ),
  'utf8'
);

describe('the audit tells an observer-gated read from a dead layer', () => {
  it('is one function in one transaction', () => {
    expect(MIGRATION.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
    expect(MIGRATION).toContain(
      'CREATE OR REPLACE FUNCTION public.fn_audit_layer_silence(p_day date)'
    );
    expect(MIGRATION).toMatch(/^BEGIN;$/m);
    expect(MIGRATION).toMatch(/^COMMIT;$/m);
  });

  it('reports a zero v16_reads_tell as layer_observer_gated (note), naming the gate and the numbers', () => {
    expect(MIGRATION).toMatch(/elsif feat\.feature = 'v16_reads_tell' then/);
    expect(MIGRATION).toContain(
      "'severity','note','category','logic','code','layer_observer_gated'"
    );
    expect(MIGRATION).toContain('bigBetSD >= 5');
    expect(MIGRATION).toContain('23,562 on 2026-10-25');
    expect(MIGRATION).toContain('Do not pool private showdown observations to silence this');
  });

  it('keeps every other branch and every watched layer', () => {
    expect(MIGRATION).toContain("'code','layer_silent'");
    expect(MIGRATION).toContain("'code','layer_retired'");
    expect(MIGRATION.match(/'code','layer_default_off'/g)).toHaveLength(2);
    expect(MIGRATION).toContain("'code','telemetry_dark'");
    for (const feature of [
      'preflop_v7',
      'v15_nut_status',
      'banded_mc_omaha',
      'banded_mc_nlh',
      'icm_real',
      'v16_hu_overlay',
      'v15_eq_capped',
      'v16_reads_cbet',
      'v16_sizecond_bigbet',
      'v16_reads_f3b',
      'v16_reads_tell',
      'v17_pos_behind',
      'v17_river_probe',
      'v17_catch_block',
      'v17_short_deck',
      'v18_straddle',
      'v18_self_image',
      'v18_exploit_size',
      'v19_overbet_polarity',
      'v19_river_bigbet_cap',
    ])
      expect(MIGRATION).toContain(`('${feature}',`);
  });
});
