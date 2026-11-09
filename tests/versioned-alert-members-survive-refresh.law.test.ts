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

  it('checks exact receipt evidence for both original groups, in either deployment order', () => {
    const historical = migration.split('DO $original$')[1];
    expect(historical).toContain("'97937ff2-fcad-42ba-9a92-0c004626dec7'::uuid,2");
    expect(historical).toContain("'a7359e4a-062d-4f4b-b203-56e20a6e90a7'::uuid,1");
    expect(historical).toContain("t.status='COMPLETED' AND t.current_players=0");
    expect(historical).toContain('s.receipt_version=3 AND s.settled_at>=a.created_at');
    expect(historical).toContain('s.source_escrow_closed_at=e_escrow.terminal_closed_at');
    expect(historical).toContain('AND distinct_alerts=expected.occurrences AND all_resolved');
  });
});
