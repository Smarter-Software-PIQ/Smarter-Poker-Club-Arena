import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the fee redemption runs with the maintained Data Console qualification', () => {
  it('retains the native before/after regression in the required accounting path', () => {
    const runner = readFileSync('scripts/ci/test-data-console-postgres-contracts.sh', 'utf8');
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const native = readFileSync('scripts/ci/test-player-fee-redemption.sh', 'utf8');
    expect(ci).toContain('run: npm run test:data:postgres');
    expect(runner).toContain('bash "$repo/scripts/ci/test-player-fee-redemption.sh"');
    expect(runner).toContain('FEE_REDEMPTION_SCRATCH="$DATA_CONSOLE_PG_SCRATCH_PARENT"');
    expect(native).toContain('fee-redemption-source-functions.sql');
    expect(native).toContain('fee-redemption-assert.sql');
    expect(native).toContain('regression unexpectedly passed before the migration');
    // The standing rake share (20261025030629) replaces the October 24 cron,
    // proven against the recorded out-of-band state in the same database.
    expect(native).toContain('20261024223153_woowoo_half_earned_rake_credited_to_kingfish.sql');
    expect(native).toContain('*_a_standing_rake_share_replaces_the_woowoo_cron.sql');
    expect(native).toContain('rake-share-out-of-band.sql');
    expect(native).toContain('rake-share-lag.sql');
    expect(native).toContain('rake-share-assert.sql');
    expect(native).toContain('rake share regression unexpectedly passed before the migration');
    // The replay reads the clock the migration was installed under; a real
    // clock made the seven-day proof fail on a calendar schedule (2026-10-31).
    expect(native).toContain('SHARE_CLOCK="${RAKE_SHARE_REPLAY_CLOCK:-2026-10-25 03:06:29+00}"');
    expect(native).toContain('pin_share_clock "${SHARE[0]}" "$WORK/rake-share-migration.sql"');
    expect(native).toContain(
      'pin_share_clock "$FIXTURE/rake-share-assert.sql" "$WORK/rake-share-assert.sql"'
    );
    expect(native).toContain(
      'pin_share_clock "$FIXTURE/rake-share-lag.sql" "$WORK/rake-share-lag.sql"'
    );
  });
  it('anchors only the isolated historical replay and restores the clock before calendar checks', () => {
    const native = readFileSync('scripts/ci/test-player-fee-redemption.sh', 'utf8');
    const clock = readFileSync(
      'scripts/ci/fixtures/player-fee-redemption/fixture-clock.sql',
      'utf8'
    );
    expect(native.indexOf('fixture-clock.sql')).toBeLessThan(
      native.indexOf('-f "$FIXTURE/rake-share-out-of-band.sql"')
    );
    const restore = native.indexOf('\nrestore_fixture_clock\n');
    expect(restore).toBeGreaterThan(native.indexOf('-f "$WORK/rake-share-assert.sql"'));
    expect(restore).toBeLessThan(native.indexOf('CALENDAR='));
    expect(native).toContain("pg_get_functiondef('pg_catalog.now()'::regprocedure)");
    expect(native).toContain('builtin clock not restored');
    expect(clock).toContain('historical fixture clock not installed');
    expect(clock).toContain("current_user <> 'fee_test'");
    expect(clock).toContain('inet_server_addr() IS NOT NULL');
    expect(clock).toContain(
      "current_setting('data_directory') <> current_setting('fee_fixture.expected_data_directory')"
    );
    expect(clock).toContain("'2026-10-25 12:00:00+00'::timestamptz");
  });
});
