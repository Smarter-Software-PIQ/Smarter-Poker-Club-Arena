/**
 * LAW: DIGEST RE-DISPATCH AND ALERT RESOLUTION PRESERVE LAST FIRING TIME (2026-11-26)
 *
 * Root causes fixed in 20261126175536_digest_dispatch_and_alert_resolution_preserve_last_firing_at.sql:
 *   1. Alert 449217 (DailyDigest.deploy_failed for 2026-11-25) was verified fixed
 *      at 12:23Z, then at 13:00Z the 7 AM digest called fn_sp_dispatch_attention
 *      -> fn_record_operational_alert which bumped last_received_at to 13:00Z
 *      past investigation_touched_at, flipping its digest status back to
 *      "not_picked_up". fn_sp_dispatch_attention now reuses an already-recorded
 *      (day, rule, key) alert id without re-delivering.
 *   2. Ten auto-resolving DB functions stamped `last_received_at = clock_timestamp()`
 *      when setting `status = 'resolved'`, invalidating 78 verified_fixed and
 *      informational reviews in fn_sp_original_alert_proof. A table-level
 *      BEFORE UPDATE trigger on operational_alert_events preserves
 *      OLD.last_received_at on firing -> resolved transitions without a new
 *      delivery, while genuine re-fires continue to advance last_received_at.
 *   3. fn_sp_original_alert_proof derives v_last_firing_at so single-delivery
 *      resolved rows stamped at resolved_at remain verifiable.
 *   4. fn_sp_digest_attention formats singular/plural counts for deploy_failed
 *      and break_failed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const MIG_PATH = resolve(
  ROOT,
  'supabase/migrations/20261126175536_digest_dispatch_and_alert_resolution_preserve_last_firing_at.sql'
);
const SQL = readFileSync(MIG_PATH, 'utf8');

describe('digest re-dispatch and alert resolution preserve last_received_at', () => {
  it('ships in one bounded transaction with live proofs and function probes', () => {
    expect(SQL.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(SQL.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(SQL.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(SQL).toContain("SET LOCAL lock_timeout = '1s';");
    expect(SQL).toContain("SET LOCAL statement_timeout = '8s';");
    expect(SQL).toContain('-- @live-proof:');
    expect(SQL).toContain('-- @probe-for: public.fn_sp_dispatch_attention');
    expect(SQL).toContain('-- @probe-for: public.fn_sp_original_alert_proof');
    expect(SQL).toContain('-- @probe-for: public.fn_sp_digest_attention');
  });

  it('installs the table-level trigger before zzz_reliability_intake_update without touching re-fires', () => {
    expect(SQL).toContain(
      'CREATE OR REPLACE TRIGGER a0_operational_alert_preserve_last_firing_on_resolve'
    );
    expect(SQL).toContain(
      "OLD.status = 'firing' AND NEW.status = 'resolved' AND NEW.delivery_count = OLD.delivery_count AND NEW.last_received_at > OLD.last_received_at"
    );
    expect(SQL).toContain('NEW.last_received_at := OLD.last_received_at;');
  });

  it('reuses existing same-day sp-daily-digest alert ids and preserves supersession invariants', () => {
    expect(SQL).toContain('A NEWER DIGEST EVALUATION SUPERSEDES');
    expect(SQL).toContain('DailyDigest.stuck_tournament');
    expect(SQL).toContain('Reuse an already-recorded alert for this (day, rule, key)');
    expect(SQL).toContain("WHERE e.source = 'sp-daily-digest'");
  });

  it('hardens fn_sp_original_alert_proof with v_last_firing_at and repairs only poisoned non-refiring rows', () => {
    expect(SQL).toContain('v_last_firing_at');
    expect(SQL).toContain("original.status = 'resolved'");
    expect(SQL).toContain('COALESCE(original.delivery_count, 1) <= 1');
    expect(SQL).toContain("source = 'sp-daily-digest'");
    expect(SQL).toContain("investigation_status IN ('verified_fixed', 'informational')");
  });

  it('fixes singular/plural titles for deploy_failed and break_failed', () => {
    expect(SQL).toContain("format('%s engine deploy attempt%s did not ship'");
    expect(SQL).toContain("format('%s engine maintenance break%s did not pass'");
  });
});
