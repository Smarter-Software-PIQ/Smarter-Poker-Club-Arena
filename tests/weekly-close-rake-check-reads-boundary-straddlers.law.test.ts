/**
 * THE WEEKLY CLOSE RAKE CHECK READS HANDS THAT STRADDLE THE BOUNDARY
 * (2026-11-07).
 *
 * The Midway Union close for the week of 2026-10-19 failed 188 times because
 * two Lightning hands recognized at 06:59:59.8 on 2026-10-26 had their rake
 * distributed in a separate transaction at 07:00:00.0-.1, so the accepted
 * hand rake (by recognition) and the earned rake (by earned_at, the payout
 * basis) disagreed by exactly 10.00. Migration 20261107021911 makes the
 * evidence report require accepted - straddle = earned, where the straddle
 * is bounded to ten minutes either side of each boundary. This law keeps a
 * later redefinition of the report from dropping that term, and keeps the
 * payout basis (earned_at) untouched.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const ROOT = '20261107021911_weekly_close_rake_check_reads_boundary_straddlers.sql';
const files = readdirSync(DIR)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();
const root = readFileSync(join(DIR, ROOT), 'utf8');

describe('weekly close rake check reads boundary straddlers', () => {
  it('the straddle is bounded to ten minutes on each side and reads the same accepted population', () => {
    expect(root).toMatch(/s\.earned_at >= p_end AND s\.earned_at < p_end \+ interval '10 minutes'/);
    expect(root).toMatch(
      /s\.earned_at >= p_start AND s\.earned_at < p_start \+ interval '10 minutes'/
    );
    expect(root).toContain('union_pnl_cash_outcome_link_resolutions');
    expect(root).toContain("s.source_type = 'cash_rake_accrual'");
  });

  it('both rake comparisons in the evidence report subtract the straddle', () => {
    const uses =
      root.match(
        /v_accepted_rake-public\.fn_union_pnl_week_rake_straddle\(p_union_id,p_start,p_end\)/g
      ) ?? [];
    expect(uses.length).toBe(2);
  });

  it('no later migration redefines the evidence report without the straddle', () => {
    for (const f of files.slice(files.indexOf(ROOT) + 1)) {
      const sql = readFileSync(join(DIR, f), 'utf8');
      if (/FUNCTION public\.fn_union_pnl_evidence_report\(/.test(sql)) {
        expect(sql, `${f} redefines the report`).toContain('fn_union_pnl_week_rake_straddle');
      }
    }
  });

  it('nothing in the correction moves money or rewrites the payout basis', () => {
    expect(root).not.toMatch(/INSERT INTO public\.chip_ledger/i);
    expect(root).not.toMatch(
      /UPDATE public\.(accounting_cash_rake_sources|rake_records|union_eco_ledger)/i
    );
  });
});
