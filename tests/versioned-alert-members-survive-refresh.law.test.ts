import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    __dirname,
    '../supabase/migrations/20261108185135_versioned_original_alerts_close_their_own_incident.sql'
  ),
  'utf8'
);

describe('financial incident membership survives an alert refresh', () => {
  it('admits exact versioned originals without changing the legacy hash route', () => {
    const selection = migration.split('$new$')[1];
    expect(selection).toContain('md5(public.fn_ca_normalize_alert_text');
    expect(selection).toContain(
      "i.dedupe_key='fa:' || NEW.source || ':' || right(i.dedupe_key,32)"
    );
    expect(selection).toContain("e.detail->'financial_member_version'='1'::jsonb");
    expect(selection).toContain("e.detail->>'source'=i.source");
    expect(selection).toContain("lower(e.detail->>'alert_id')=NEW.id::text");
    expect(migration).toContain("count(DISTINCT lower(detail->>'alert_id'))");
  });

  it('requires both original terminal receipts for the already stranded boundary incident', () => {
    const historical = migration.split('DO $original$')[1];
    expect(historical).toContain("id='97937ff2-fcad-42ba-9a92-0c004626dec7'");
    expect(historical).toContain("a.context->>'receipt_proven_tournament_completion'='true'");
    expect(historical).toContain(
      'original.occurrences=2 AND member_count=2 AND distinct_alerts=2 AND all_resolved'
    );
  });
});
