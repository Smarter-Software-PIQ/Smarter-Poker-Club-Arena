import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lockTargets } from '../scripts/ci/maintenance-window-migrations.mjs';

const read = (path: string) => readFileSync(path, 'utf8');
const migration =
  'supabase/migrations/20261112151009_rebuy_and_addon_stack_invariants_survive_registered_updates.sql';

describe('registered chip awards keep the starting stack', () => {
  it('replaces the uninstalled rebuy migration through the existing daily route', () => {
    expect(
      read('supabase/migrations/20261112013925_a_rebuy_pays_the_starting_stack.sql')
    ).toContain('-- SUPERSEDED BY 20261112151009');
    expect(read(migration)).toContain('-- @install-window: daily-maintenance');
  });

  it('runs the actual old and new definitions against the same native assertions', () => {
    const runner = read('scripts/ci/test-maintenance-window-migrations.sh');
    expect(runner).toContain(`$ROOT/${migration}`);
    expect(runner.match(/-f "\$FIXTURES\/starting-stack-contract.sql"/g)).toHaveLength(2);
    expect(runner).toContain('registered service rebuy mismatch was accepted');
    expect(runner).toContain('starting-stack native regression failed');
  });

  it('requests only the trigger creation lock that permits maintenance readers', () => {
    expect(lockTargets(read(migration))).toEqual([
      { relation: 'public.tournaments', mode: 'ShareRowExclusiveLock' },
    ]);
  });

  it('selects native qualification when the source or fixture changes', () => {
    const workflow = read('.github/workflows/maintenance-window-migrations.yml');
    expect(workflow).toContain(
      'supabase/migrations/*_rebuy_and_addon_stack_invariants_survive_registered_updates.sql'
    );
    expect(workflow).toContain('scripts/ci/fixtures/maintenance-window-migrations/**');
    expect(workflow).toContain('bash scripts/ci/test-maintenance-window-migrations.sh');
  });
});
