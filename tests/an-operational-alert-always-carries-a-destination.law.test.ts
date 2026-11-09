/**
 * LAW: AN OPERATIONAL ALERT ALWAYS CARRIES A DESTINATION (2026-11-09).
 *
 * ca-stall-watch inserted TableStoppedDealing rows with no
 * payload.target_task_id (601 in 7 days), so the Production Alerts fleet could
 * not route them. The owning table now stamps the destination on every insert
 * and never overwrites one a sender set.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261109184743_operational_alert_events_always_carry_a_destination.sql'),
  'utf8',
);

describe('operational_alert_events destination invariant', () => {
  it('has a BEFORE INSERT row trigger on the table', () => {
    expect(MIG).toMatch(/CREATE TRIGGER a00_operational_alert_stamp_destination\s+BEFORE INSERT ON public\.operational_alert_events\s+FOR EACH ROW/);
  });
  it('stamps the fleet task id only when the sender left it empty', () => {
    expect(MIG).toContain("NULLIF(NEW.payload->>'target_task_id', '') IS NULL");
    expect(MIG).toContain('01a09b86-5ba8-7290-8657-1041f13dd3ca');
  });
  it('is one transaction, never raises, and rewrites no history', () => {
    expect(MIG).toMatch(/^BEGIN;/m);
    expect(MIG).toMatch(/^COMMIT;/m);
    expect(MIG).toContain("SET LOCAL lock_timeout");
    expect(MIG).not.toMatch(/RAISE EXCEPTION/);
    expect(MIG).not.toMatch(/UPDATE public\.operational_alert_events/);
  });
});
