import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const migration = readFileSync(
  join(root, 'supabase/migrations/20261113054116_bounty_recovery_skips_busy_settlement_lanes.sql'),
  'utf8'
);

it('keeps canonical payment and proof logic byte-identical after lane admission', () => {
  const original = readFileSync(
    join(
      root,
      'supabase/migrations/20260910174349_the_bounty_sweep_takes_one_tournament_lane_per_call.sql'
    ),
    'utf8'
  );
  const tail = (s: string) =>
    s.slice(s.indexOf('  FOR candidate IN\n    SELECT bo.id'), s.indexOf('\n$function$;'));
  expect(tail(migration)).toBe(tail(original));
  expect(migration).toContain('pg_try_advisory_xact_lock_shared');
  expect(migration).toContain('pg_try_advisory_xact_lock(');
});

it('admits independent bounty work under real PostgreSQL lock contention', () => {
  const scratch = mkdtempSync(join(root, '.bounty-lane-test-'));
  try {
    const output = execFileSync('python3', ['scripts/ci/test-bounty-recovery-lane-contention.py'], {
      cwd: root,
      env: {
        ...process.env,
        TMPDIR: scratch,
        PATH: `/opt/homebrew/opt/postgresql@17/bin:${process.env.PATH ?? ''}`,
      },
      encoding: 'utf8',
      timeout: 45_000,
    });
    expect(output).toContain('BOUNTY_LANE_CONTENTION PASS');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 50_000);
