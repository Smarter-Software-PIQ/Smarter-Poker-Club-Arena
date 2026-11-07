import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  session: vi.fn(),
  insert: vi.fn(),
}));
vi.mock('../../src/core/MasterBus', () => ({ masterBus: { subscribe: mocks.subscribe } }));
vi.mock('../../src/lib/supabase', () => ({
  supabase: { auth: { getSession: mocks.session }, from: () => ({ insert: mocks.insert }) },
}));
import {
  mayWrite,
  MIN_WRITE_INTERVAL_MS,
  startShellTelemetry,
  __resetShellTelemetryForTests,
} from '../../src/services/ShellTelemetryService';

beforeEach(() => {
  vi.clearAllMocks();
  __resetShellTelemetryForTests();
});

describe('the writer is throttled', () => {
  it('allows the first write of a kind', () => {
    expect(mayWrite('staleness_checked', 1_000_000, undefined)).toBe(true);
  });

  it('refuses a second write inside the interval, allows one after', () => {
    const now = 1_000_000;
    expect(mayWrite('staleness_checked', now, now - MIN_WRITE_INTERVAL_MS + 1)).toBe(false);
    expect(mayWrite('staleness_checked', now, now - MIN_WRITE_INTERVAL_MS - 1)).toBe(true);
  });

  it('the interval is load-bearing — a KPI must not become a write storm', () => {
    expect(MIN_WRITE_INTERVAL_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe('telemetry can never break the app', () => {
  it('drops unreadable sessions and failed writes without interrupting the page', async () => {
    mocks.session.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
      data: { session: { user: { id: 'viewer' } } },
      error: null,
    });
    mocks.insert.mockRejectedValue(new Error('telemetry unavailable'));
    startShellTelemetry();
    const [event, callback] = mocks.subscribe.mock.calls[0];
    expect(event).toBe('SHELL_STALENESS_CHECKED');
    const payload = { stale: true, source: 'resume-probe', running: 'old', deployed: 'new' };
    expect(() => callback({ payload })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.insert).not.toHaveBeenCalled();
    __resetShellTelemetryForTests();
    startShellTelemetry();
    expect(() => mocks.subscribe.mock.calls[1][1]({ payload })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.insert).toHaveBeenCalledWith({
      user_id: 'viewer',
      event: 'staleness_checked',
      stale: true,
      source: 'resume-probe',
      running_entry: 'old',
      deployed_entry: 'new',
    });
  });
});

describe('the wiring', () => {
  const app = readFileSync(path.resolve(__dirname, '../../src/App.tsx'), 'utf8');
  const svc = readFileSync(
    path.resolve(__dirname, '../../src/services/ShellTelemetryService.ts'),
    'utf8'
  );

  it('is started at the app root, beside the gate that produces the events', () => {
    expect(app.includes('startShellTelemetry')).toBe(true);
    expect(
      app.indexOf('useShellUpdateGate()'),
      'the telemetry is started before the gate exists'
    ).toBeLessThan(app.indexOf('startShellTelemetry()'));
  });

  it('subscribes only to active freshness observations', () => {
    expect(svc.includes("subscribe('SHELL_STALENESS_CHECKED'")).toBe(true);
    expect(svc.includes("subscribe('SHELL_RELOADED'")).toBe(false);
  });

  it('never writes without a signed-in user (RLS requires user_id = auth.uid())', () => {
    expect(/if \(!userId\) return;/.test(svc)).toBe(true);
  });

  it('every write path is wrapped so telemetry cannot surface to the player', () => {
    // Session reads and the remaining write catch transport failures.
    const catches = svc.match(/\} catch \{/g) ?? [];
    expect(catches.length).toBeGreaterThanOrEqual(2);
    expect(
      svc.includes('reportError'),
      'telemetry must not report its own failures as errors'
    ).toBe(false);
  });
});

describe('the migration ships with the code that needs it', () => {
  it('the table and both KPI views are in the repo migration', () => {
    const sql = readFileSync(
      path.resolve(__dirname, '../../supabase/migrations/20260830_client_shell_telemetry.sql'),
      'utf8'
    );
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.client_shell_telemetry/);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.v_shell_staleness_rate/);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.v_shell_reload_lateness/);
    // RLS, or any signed-in user could write rows as anybody.
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/WITH CHECK \(user_id = auth\.uid\(\)\)/);
  });
});
