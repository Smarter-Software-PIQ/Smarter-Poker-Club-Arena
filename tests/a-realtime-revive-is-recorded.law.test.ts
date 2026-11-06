import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 2026-11-06: the resume revive from #9645 only reached the console, so
// production could not prove the fix ever fired. Executed on PostgreSQL in
// scripts/ci/test-realtime-revive-is-recorded.py; this pins the shape.
const MIG = 'supabase/migrations/20261106102321_realtime_revive_is_recorded.sql';
const code = readFileSync(MIG, 'utf8').replace(/--[^\n]*/g, ' ');

describe('a realtime revive is recorded', () => {
  it('records reason, rejoin, gap and wait for each forced reconnect', () => {
    expect(code).toContain('CREATE TABLE public.client_realtime_revivals(');
    expect(code).toContain("reason IN ('not_connected', 'unanswered_heartbeat')");
    expect(code).toContain('CHECK (rejoined = (gap_ms IS NOT NULL))');
  });
  it('lets a signed-in player insert only their own row and nobody else read it', () => {
    expect(code).toContain('ENABLE ROW LEVEL SECURITY');
    expect(code).toMatch(
      /REVOKE ALL ON public\.client_realtime_revivals FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(code).toMatch(
      /GRANT INSERT \([^)]*\)\s+ON public\.client_realtime_revivals TO authenticated;/
    );
    expect(code).toContain('WITH CHECK (user_id = (SELECT auth.uid()))');
    expect(code).toContain('GRANT SELECT ON public.client_realtime_revivals TO service_role;');
    expect(code).not.toMatch(
      /GRANT SELECT ON public\.client_realtime_revivals TO (anon|authenticated)/
    );
  });
  it('reports revives and gap percentiles per day through a service-only view', () => {
    expect(code).toContain('CREATE VIEW public.v_realtime_revival_daily');
    expect(code).toContain('security_invoker = true');
    expect(code).toMatch(/percentile_disc\(0\.95\) WITHIN GROUP \(ORDER BY r\.gap_ms\)/);
    expect(code).toContain('GRANT SELECT ON public.v_realtime_revival_daily TO service_role;');
  });
  it('refuses a second install', () => {
    expect(code).toContain("RAISE EXCEPTION 'client_realtime_revivals already installed'");
  });
});
