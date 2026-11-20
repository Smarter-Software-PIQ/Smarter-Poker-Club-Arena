import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Incident 075013fd (Lane 1): engine boot, shutdown, and FATAL/crash logs must
 * persist to `public.engine_lifecycle_logs` so any crash or failed boot can be
 * read from the database without SSHing to the Hetzner host.
 */
const ROOT = process.cwd();
const MIGRATION = readFileSync(
  join(ROOT, 'supabase/migrations/20261119175748_engine_lifecycle_logs_table.sql'),
  'utf8'
);
const INDEX = readFileSync(join(ROOT, 'server/src/index.ts'), 'utf8');
const SERVICE = readFileSync(join(ROOT, 'server/src/services/engineLifecycleLog.ts'), 'utf8');

describe('engine lifecycle logs persist to the database without SSH', () => {
  it('defines public.engine_lifecycle_logs with RLS, service_role grants, and size bounds', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS public.engine_lifecycle_logs');
    expect(MIGRATION).toContain(
      'ALTER TABLE public.engine_lifecycle_logs ENABLE ROW LEVEL SECURITY'
    );
    expect(MIGRATION).toContain(
      'REVOKE ALL ON TABLE public.engine_lifecycle_logs FROM PUBLIC, anon, authenticated, service_role'
    );
    expect(MIGRATION).toContain(
      'GRANT SELECT, INSERT ON TABLE public.engine_lifecycle_logs TO service_role'
    );
    expect(MIGRATION).toContain("level IN ('info', 'warn', 'error', 'fatal')");
    expect(MIGRATION).toContain('octet_length(detail::text) <= 16384');
  });

  it('wires boot, shutdown, leadership loss, deadline, and FATAL handlers in server/src/index.ts', () => {
    expect(INDEX).toContain('recordEngineLifecycleLog');
    expect(INDEX).toContain('flushEngineLifecycleLogs');
    expect(INDEX).toContain("event: 'boot'");
    expect(INDEX).toContain("event: 'shutdown_signal'");
    expect(INDEX).toContain("event: 'leadership_shutdown'");
    expect(INDEX).toContain("event: 'fatal_error'");
    expect(INDEX).toContain("event: 'shutdown_failed'");
    expect(INDEX).toContain("event: 'shutdown_deadline'");
    expect(INDEX).toContain('await flushEngineLifecycleLogs(');
  });

  it('keeps persistence bounded, non-blocking, and never-throwing', () => {
    expect(SERVICE).toContain('MAX_LIFECYCLE_IN_FLIGHT');
    expect(SERVICE).toContain('MAX_LIFECYCLE_DETAIL_BYTES');
    expect(SERVICE).toContain('timer.unref()');
  });
});
