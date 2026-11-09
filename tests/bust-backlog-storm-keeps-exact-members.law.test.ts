import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    __dirname,
    '../supabase/migrations/20261108171208_bust_backlog_storm_closes_with_its_exact_members.sql'
  ),
  'utf8'
);

describe('bust backlog storm resolution', () => {
  it('routes the source transition to its own capped incident and requires exact versioned links', () => {
    const patch = migration
      .split('new_scope constant text')[1]
      .split('old_reason constant text')[0];
    expect(patch).toContain(
      "NEW.source IN ('Tournament.atomic_finish_refused','fn_ca_bust_backlog_page')"
    );
    expect(patch).toContain("i.dedupe_key='storm:financial_alerts:' || NEW.source");
    expect(patch).toContain('count(DISTINCT a.id)=count(*)');
    expect(patch).toContain("e.detail->'financial_member_version'='1'::jsonb");
    expect(patch).toContain("e.detail->>'source'='financial_alerts:' || NEW.source");
  });

  it('requires the full original resolved cohort before closing the historical storm', () => {
    const original = migration.split('DO $original$')[1];
    expect(original).toContain("id='a0f3b0ed-fce0-4f9a-b17f-31c25174af4a'");
    expect(original).toContain("a.resolved AND a.source='fn_ca_bust_backlog_page'");
    expect(original).toContain(
      'original.occurrences=18 AND member_count=18 AND distinct_alerts=18 AND all_resolved'
    );
    expect(original).toContain("closure_basis='verified_remeasured'");
  });
});
