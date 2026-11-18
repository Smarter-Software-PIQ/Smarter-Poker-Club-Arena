import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20261109152239_governance_eco_incidents_keep_their_original_week.sql',
  'utf8'
);

describe('governance ECO incidents keep their original week', () => {
  it('requires finalized original books and exact ECO evidence', () => {
    expect(migration).toContain("r.status='complete' AND r.result->>'success'='true'");
    expect(migration).toContain("r.result->>'accounting_version'='3'");
    expect(migration).toContain('e.period_start=v_week_start AND e.period_end=v_week_end');
    expect(migration).toContain('public.fn_ca_governance_eco_proven(i.metadata)');
    expect(migration).toContain("'prior_resolution',to_jsonb(original)");
    expect(migration).not.toMatch(
      /UPDATE\s+(?:public\.)?(?:union_eco_ledger|union_accounting_runs|chip_ledger|club_members)\b/i
    );
  });

  it('runs the PostgreSQL regression in the existing qualification workflow', () => {
    const workflow = readFileSync('.github/workflows/weekly-refusal-cover.yml', 'utf8');
    expect(workflow).toContain(
      'python3 -B scripts/ci/test-governance-eco-original-week-postgres.py --pg-bin "$PG_BIN" --scratch "$RUNNER_TEMP"'
    );
    const native = readFileSync('scripts/ci/test-governance-eco-original-week-postgres.py', 'utf8');
    expect(native).toContain('false_closure_reproduced');
    expect(native).toContain('running_and_rollover_refused');
    expect(native).toContain('partial_club_books_refused');
    expect(native).toContain('refreshed_metadata_retains_original');
  });

  it('qualifies the actual activity-record detector and sweep through required accounting CI', () => {
    const driver = readFileSync('scripts/dev/test-dual-eco.sh', 'utf8');
    expect(driver).toContain('tests/fixtures/dual-eco/governance-before.json');
    expect(driver).toContain('tests/fixtures/dual-eco/governance-bootstrap.sql');
    expect(readFileSync('tests/fixtures/dual-eco/regression.sql', 'utf8')).toContain(
      '\\ir governance-regression.sql'
    );
    const native = readFileSync('tests/fixtures/dual-eco/governance-regression.sql', 'utf8');
    expect(native).toContain('baseline reproduces false missing ECO');
    expect(native).toContain('mixed sweep captures only genuinely missing original union');
    expect(native).toContain('wrong immutable component identity remains visible');
    expect(native).toContain('wrong exact DST period remains visible');
    expect(native).toContain('refresh never deletes an existing original obligation');
  });
});
