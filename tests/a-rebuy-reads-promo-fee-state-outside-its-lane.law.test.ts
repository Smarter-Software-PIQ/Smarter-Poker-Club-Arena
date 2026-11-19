/**
 * A REBUY READS PROMO FEE STATE OUTSIDE ITS EVENT LANE
 * (2026-11-19, incident 075013fd, lane E3)
 *
 * process_tournament_rebuy takes its event's rebuy key first, so every step of
 * one purchase is time the next purchase of that event waits. For an
 * open-grant holder whose hourly promo snapshot was not current, the in-lane
 * fn_ca_promo_play_through_settle recomputed the whole fee history (1.4 s mean,
 * 5.5 s max for rebuyers on production). The rebuy now brings that snapshot
 * current before it takes the key; the lane then reads it current.
 *
 * Owner rules: rebuys never pause the action (Dan, 2026-08-30); no unintended
 * delays (2026-11-18). Native proof:
 * scripts/ci/test-a-rebuy-reads-promo-fee-state-outside-its-lane.py.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    __dirname,
    '..',
    'supabase/migrations/20261119054539_a_rebuy_reads_promo_fee_state_outside_its_event_lane.sql'
  ),
  'utf8'
);

/** The dollar-quoted replacement text the migration substitutes into the rebuy. */
function replacement(): string {
  const open = sql.indexOf('v_new text := $n$');
  if (open < 0) throw new Error('replacement block not found');
  const start = open + 'v_new text := $n$'.length;
  return sql.slice(start, sql.indexOf('$n$', start));
}

describe('a rebuy reads promo fee state outside its event lane', () => {
  const block = replacement();
  const code = block.replace(/--[^\n]*/g, '');
  const ensure = code.indexOf('fn_ca_promo_fee_state_ensure(tp.club_id,p_user_id)');
  const lane = code.indexOf(
    'PERFORM public.fn_ca_share_tournament_lane_for_rebuy(p_tournament_id,p_user_id);'
  );

  it('brings the snapshot current before the event rebuy key is taken', () => {
    expect(ensure).toBeGreaterThan(-1);
    expect(lane).toBeGreaterThan(ensure);
  });

  it('only for an open-grant holder, so nobody else waits on a recomputation', () => {
    expect(code.slice(ensure, lane)).toMatch(/g\.closed_at IS NULL/);
  });

  it('is applied to a pinned pre-image and lands on a pinned post-image', () => {
    expect(sql).toMatch(/md5\(v_def\) <> '[0-9a-f]{32}'/);
    expect(sql).toMatch(/md5\(pg_get_functiondef\(v_sig\)\) <> '[0-9a-f]{32}'/);
  });
});
