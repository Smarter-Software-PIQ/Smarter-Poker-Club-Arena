import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    __dirname,
    '../supabase/migrations/20261108171801_terminal_receipts_resolve_satellite_and_recovery_alerts.sql'
  ),
  'utf8'
);
const receiptClass = migration.split('$class$')[1];

describe('terminal receipts resolve tournament alerts', () => {
  it('requires completion after the original alert and zero escrow', () => {
    expect(receiptClass).toContain("t.status='COMPLETED' AND t.current_players=0");
    expect(receiptClass).toContain('e.terminal_closed_at>=a.created_at');
    expect(receiptClass).toContain('e.prize_balance=0 AND e.bounty_balance=0 AND e.fee_balance=0');
    expect(receiptClass).toContain('s.source_escrow_closed_at=e.terminal_closed_at');
    expect(receiptClass).toContain('f.escrow_closed_at=e.terminal_closed_at');
  });

  it('requires the original qualifier cohort and applies only to proven alert IDs', () => {
    expect(receiptClass).toContain("jsonb_typeof(a.context->'qualifier_ids')='array'");
    expect(receiptClass).toContain(
      "jsonb_array_length(a.context->'qualifier_ids')=cardinality(s.qualifier_ids)"
    );
    expect(receiptClass).toContain("(a.context->'qualifier_ids') @> to_jsonb(s.qualifier_ids)");
    expect(receiptClass).toContain("to_jsonb(s.qualifier_ids) @> (a.context->'qualifier_ids')");
    expect(receiptClass).toContain('WHERE a.id=ANY(v_receipted_ids) AND a.resolved IS NOT TRUE');
  });
});
