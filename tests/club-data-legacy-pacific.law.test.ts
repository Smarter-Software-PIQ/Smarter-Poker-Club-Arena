import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { declaredProofs, proofIsRunnable } from '../scripts/ci/check-migrations-are-live.mjs';
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

describe('canonical funded cash report ownership', () => {
  const fix = read(
    'supabase/migrations/20261116181617_pacific_data_cash_follows_original_funded_source_ownership.sql'
  );
  it('uses immutable source authority and original raw contribution amounts', () => {
    expect(fix).toContain('accounting_cash_funding_contract_admissions');
    expect(fix).toContain('s.rake_record_id=p_record AND s.player_id=p_user');
    expect(fix).toContain('e.amount*e.c/sum(e.c) OVER()');
    expect(fix).not.toMatch(
      /(?:UPDATE|DELETE FROM) public\.(?:wallet_transactions|rake_records|rake_attributions|accounting_cash_rake_sources|accounting_cash_funding_contract_admissions)\b/i
    );
    expect(fix).not.toContain('CREATE TRIGGER');
    expect(fix).toContain('EXIT original_projection');
  });
  it('keeps receipt appends nonblocking and coverage tied to qualified source version', () => {
    const tables = fix.slice(fix.indexOf('CREATE TABLE'), fix.indexOf('CREATE FUNCTION'));
    expect(tables).not.toMatch(/PRIMARY KEY|UNIQUE/);
    expect(fix).toContain('basis_version=1');
    expect(fix).toContain('WITH facts AS NOT MATERIALIZED(');
    expect(fix).toContain('WITH unfinished AS MATERIALIZED(');
    expect(fix).toContain('JOIN expected e USING(rake_record_id,user_id)');
    expect(fix).toContain('EXCEPT SELECT rake_record_id,user_id FROM qualified');
    expect(fix).toContain("f.source IN(''live_fact'',''live_hand'',''live_cash_source'')");
    expect(fix).toContain('cash_records r');
    expect(fix).toContain('ca_club_data_pacific_cash_complete');
    expect(fix).toContain('WITH affected AS NOT MATERIALIZED(');
    expect(fix).toContain('n.stage>o.stage OFFSET 0');
    expect(read(native)).toContain(
      'moving one full-source participant retains unchanged participant club hand'
    );
    expect(fix).toContain('ca_club_data_pacific_cash_participants');
    expect(fix).toContain('captured:=true;');
    expect(fix).toContain('CASE WHEN captured THEN p_club END');
    expect(read(native)).toContain(
      'split callback participant witnesses make exact source readable after commit'
    );
    expect(read(native)).toContain(
      'later ambiguity scopes refusal to captured original baseline club too'
    );
    expect(read('scripts/ci/club-data-accounting-seed.mjs')).toContain(
      'utc_day=$1 AND basis_version=1'
    );
    expect(read(native)).toContain(
      'late admission removes historical former-owner phantom game atomically'
    );
    expect(read(native)).toContain(
      'concurrent duplicate source callbacks stay nonblocking and idempotent'
    );
  });
});

describe('restored Pacific source context is nullable at every UUID cast', () => {
  it('normalizes every cast under exact production preimages without changing captures', () => {
    const fix = read(
      'supabase/migrations/20261116203318_pacific_data_empty_rake_context_is_null.sql'
    );
    const proofs = declaredProofs(fix);
    expect(proofs).toHaveLength(1);
    expect(proofIsRunnable(proofs[0])).toBe(true);
    expect(proofs[0]).toContain('count(*)=2');
    expect(proofs[0]).toContain('bool_and');
    expect(proofs[0]).toContain('public.fn_ca_club_data_fact_put(');
    expect(proofs[0]).toContain('public.fn_ca_club_data_hand_put(');
    expect(proofs[0]).toContain('IN p.prosrc)=0');
    expect(fix).toContain('caf725b26e6115f60b80412183c61be0');
    expect(fix).toContain('246735d855771ebedf6278a514a4bffe');
    expect(fix).toContain("nullif(current_setting(''ca.pacific_rake_record'',true),'''')::uuid");
    expect(fix).toContain('replace(d,old_cast,new_cast)');
    expect(fix).toContain('WHERE id=true');
    expect(fix).not.toMatch(
      /DELETE FROM|UPDATE public\.(?:ca_club_data_pacific_fact|wallet_transactions|rake_records)\b/i
    );
    expect(read(native)).toContain('original fact/hand empty-context callback defect reproduced');
    expect(read(native)).toContain(
      'fixed empty-context fact and hand callbacks create no UUID failures'
    );
  });
});
