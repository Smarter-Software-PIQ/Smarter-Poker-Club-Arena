/**
 * A host that goes silent is noticed within minutes (2026-11-03).
 * Operations hosts report a heartbeat; a silence past its allowance raises one
 * critical alert per outage, recovery is recorded as an informational event,
 * and the check is detection only.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

const dir = 'supabase/migrations';
const file = fs.readdirSync(dir).find((f) => f.endsWith('_host_heartbeat_and_silence_alert.sql'));
const sql = file ? fs.readFileSync(`${dir}/${file}`, 'utf8') : '';

describe('a silent host is noticed within minutes', () => {
  it('checks every 5 minutes and declares itself detection only', () => {
    expect(sql).toContain("cron.schedule('host-heartbeat-check','*/5 * * * *'");
    expect(sql).toMatch(/-- periodic-work: detection only/);
  });
  it('fires once per outage and records recovery as informational', () => {
    expect(sql).toContain("'HostHeartbeatMissing','firing','critical'");
    expect(sql).toContain('silence_event_key IS NULL AND beat_at < n-max_silence');
    expect(sql).toContain("'HostHeartbeatResumed','info','info'");
  });
  it('every alert names its owning task', () => {
    const alerts = sql.match(/fn_record_operational_alert\(/g) ?? [];
    const owned = sql.match(/'target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca'/g) ?? [];
    expect(alerts.length).toBe(3);
    expect(owned.length).toBe(3);
  });
  it('is private to the database owner and moves nothing', () => {
    expect(sql).toContain('FROM PUBLIC, anon, authenticated, service_role');
    expect(sql).not.toMatch(/chip_ledger|wallet|fn_club_bank_send/);
  });
});
