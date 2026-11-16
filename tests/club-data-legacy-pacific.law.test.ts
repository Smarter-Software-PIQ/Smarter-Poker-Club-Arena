import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyChangedPaths } from '../scripts/ci/classify-ci-changes.mjs';

const read = (p: string) => readFileSync(p, 'utf8');
const migration =
  'supabase/migrations/20261116163311_legacy_club_data_reads_pacific_calendar_days.sql';
const sql = read(migration);
const native = 'scripts/ci/test-club-data-legacy-pacific-postgres.py';

describe('all Data report bases use Pacific dates without rewriting money', () => {
  it('observes existing event ownership and timestamps, keeps the old writers private', () => {
    expect(sql).toContain('public.fn_ca_club_data_fact_put_pre_pacific(');
    expect(sql).toContain('public.fn_ca_club_data_hand_put_pre_pacific(');
    expect(sql).toContain('pg_try_advisory_xact_lock');
    expect(sql).toContain('IF n>=32 THEN RETURN false');
    expect(sql).toContain('INSERT INTO public.ca_club_data_pacific_journal');
    expect(sql).toContain("AT TIME ZONE 'America/Los_Angeles'");
    expect(sql).not.toMatch(
      /(?:UPDATE|DELETE FROM) public\.(?:wallet_transactions|rake_records|agent_commissions|chip_ledger)/i
    );
  });

  it('rebuilds only from full timestamped sources and refuses unproven controls', () => {
    expect(sql).toContain('PACIFIC_DATA_SEED_REQUIRES_REPEATABLE_READ');
    expect(sql).toContain('PACIFIC_DATA_SEED_PREATTACHMENT_TRANSACTION_STILL_OPEN');
    expect(sql).toContain('ca_pacific_events');
    expect(sql).toContain('FULL JOIN ca_pacific_control');
    expect(sql).toContain('Original source ownership or per-record fee receipts are incomplete');
    expect(sql).toContain('CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE');
    expect(sql).not.toMatch(/fn_ca_club_data_pacific_day\([^)]*last_at/);
  });

  it('routes all 13 legacy doors and keeps commission UTC cores unchanged', () => {
    const preimages = JSON.parse(read('tests/fixtures/club-data-pacific/preimages.json')) as {
      proname: string;
    }[];
    const names = new Set(
      preimages.filter((x) => x.proname.endsWith('_chicago_basis')).map((x) => x.proname)
    );
    expect(names.size).toBe(13);
    for (const name of names) expect(sql).toContain(`public.${name}(`);
    expect(sql).toContain("position('fn_ca_club_data_reads_union_basis' IN d)=0");
    expect(sql).toContain('ca_rake_snapshot_pacific_v2');
    expect(sql).toContain('ca_rake_export_start_pacific_v2');
    expect(sql).toContain("''day_basis'', ''America/Los_Angeles 00:00'', ''generated_at''");
    expect(sql).toContain('ca-data-pacific:');
    expect(sql).toContain('SET TimeZone TO');
    expect(sql).toContain('public.fn_ca_club_pacific_member_fee_totals');
    expect(sql).toContain('public.fn_ca_club_data_pacific_cash_gross(p_club_id,v_from,v_to)');
    const earned = sql.slice(
      sql.indexOf('$earned$WITH RECURSIVE'),
      sql.indexOf('commission_days AS MATERIALIZED ($earned$')
    );
    expect(earned).not.toContain('fn_ca_club_pacific_member_fee_totals');
  });

  it('executes both native regressions through required Data PostgreSQL qualification', () => {
    const runner = read('scripts/ci/test-data-console-postgres-contracts.sh');
    expect(runner).toContain(native);
    expect(runner).toContain('scripts/ci/test-club-data-pacific-fees.py');
    for (const path of [
      native,
      'scripts/ci/test-club-data-pacific-fees.py',
      'tests/fixtures/club-data-pacific/preimages.json',
    ]) {
      expect(classifyChangedPaths([path]).server).toBe(true);
    }
    const fixture = read(native);
    expect(fixture).toContain('contended report capture is append-only and nonblocking');
    expect(fixture).toContain('actual public screen reads Pacific totals');
    expect(fixture).toContain('actual public reader refuses a failed rebuild');
  });

  it('uses the finite loader and durable failure receipts, with no schedule or retry', () => {
    const workflow = read('.github/workflows/club-data-accounting-seed.yml');
    const driver = read('scripts/ci/club-data-accounting-seed.mjs');
    expect(workflow).toContain('legacy_pacific');
    expect(workflow).not.toMatch(/\bschedule:/);
    expect(driver).toContain("'REPEATABLE READ', '240s'");
    expect(driver).toContain('legacy Pacific source evidence incomplete');
    expect(driver).toContain('250 * 60_000');
  });
});
