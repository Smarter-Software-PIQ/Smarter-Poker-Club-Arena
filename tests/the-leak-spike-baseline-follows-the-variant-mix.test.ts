import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The leak-spike baseline was one pooled rate per tag, so a day whose variant
 * mix moved read as a spike: on 2026-10-30 big_bet_fold read 1.51x its pooled
 * baseline while every variant's own rate was flat (a tournament start hold
 * had removed most tournament NLH hands). The expected count now weights each
 * variant's baseline rate by the day's variant hands. Measured read-only on
 * 2026-10-30: big_bet_fold 1.51x -> 1.34x; plo_toppair_no_redraw_stackoff
 * 2.65x -> 2.05x and plo_set_stackoff 2.17x -> 1.67x are still reported.
 */
const ROOT = path.resolve(__dirname, '..');
const FILE =
  'supabase/migrations/20261031225911_leak_spike_baseline_follows_the_day_s_variant_mix.sql';
const MIGRATION = fs.readFileSync(path.join(ROOT, FILE), 'utf8');

describe('the leak spike baseline follows the day variant mix', () => {
  it('weights each variant baseline rate by the day variant hands', () => {
    expect(MIGRATION).toContain('day_variant as (');
    expect(MIGRATION).toContain('base_tag_variant as (');
    expect(MIGRATION).toContain(
      'sum(dv.hands * (btv.cnt::numeric / btv.hands)) filter (where btv.hands > 0) as known'
    );
    expect(MIGRATION).toContain('left join mix_expected me using (tag)');
  });

  it('falls back to the pooled rate for a variant with no baseline hands', () => {
    expect(MIGRATION).toContain(
      '+ coalesce(me.unknown_hands, 0) * coalesce(c.cnt, 0)::numeric / p.hands'
    );
  });

  it('keeps the loss-side predicate and every spike verdict', () => {
    expect(MIGRATION).toMatch(/and d\.tag not like '%\\_won'/);
    for (const code of [
      "'code','leak_tag_spike'",
      "'code','leak_tag_spike_positive_ev'",
      "'code','leak_tag_spike_unresolved'",
    ])
      expect(MIGRATION).toContain(code);
  });

  it('replaces only the body it was written against and keeps the grants', () => {
    expect(MIGRATION).toContain("IS DISTINCT FROM 'fe5badb4faac910d40658878cb975add'");
    expect(MIGRATION).toMatch(/^BEGIN;$/m);
    expect(MIGRATION).toMatch(/^COMMIT;$/m);
    expect(MIGRATION).toContain(
      'REVOKE ALL ON FUNCTION public.fn_run_horse_daily_audit(date) FROM PUBLIC, anon, authenticated;'
    );
  });
});
