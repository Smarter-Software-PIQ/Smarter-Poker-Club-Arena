/**
 * A settled correction for an earlier week is that week's (2026-11-03).
 * The weekly club statement must not count a documented, settled prior-week
 * agent-wallet correction as an unperioded payment of the current week.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

const dir = 'supabase/migrations';
const file = fs
  .readdirSync(dir)
  .find((f) => f.endsWith('_a_settled_correction_for_an_earlier_week_is_that_weeks.sql'));
const sql = file ? fs.readFileSync(`${dir}/${file}`, 'utf8') : '';

describe('a settled correction for an earlier week is that week s', () => {
  it('excludes only settled agent-wallet corrections for a week ending by the period start', () => {
    expect(sql).toContain("a.status='settled' AND a.target_kind='agent_wallet'");
    expect(sql).toContain('a.amount=l.amount');
    expect(sql).toContain("l.idempotency_key='manual-agent-adjustment:'||a.id::text");
    expect(sql).toContain("<=(period.start_at AT TIME ZONE 'America/Los_Angeles')::date");
  });
  it('is one exact, preimage-guarded replacement in one transaction', () => {
    expect(sql).toContain('club_weekly_summary_preimage_changed');
    expect(sql).toContain('club_weekly_summary_patch_not_single');
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
  });
  it('moves no money', () => {
    expect(sql).not.toMatch(
      /fn_club_bank_send|INSERT INTO public\.chip_ledger|UPDATE public\.chip_ledger/
    );
  });
});
