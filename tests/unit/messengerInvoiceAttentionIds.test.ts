import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* The Messenger main inbox reads a window (World Hub). An invoice that still
   requires action must never fall outside it, so one bounded read returns
   every such thread for the caller. */
const sql = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20261119014500_messenger_invoice_attention_ids.sql'
  ),
  'utf8'
);

describe('fn_messenger_private_invoice_attention_ids', () => {
  it('is a service-role-only definer function with a pinned search path', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.fn_messenger_private_invoice_attention_ids\(\s*p_user_id uuid\s*\)\s*RETURNS uuid\[\]/
    );
    expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path TO 'public', 'pg_temp'/);
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_messenger_private_invoice_attention_ids(uuid) FROM PUBLIC, anon, authenticated;'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_messenger_private_invoice_attention_ids(uuid) TO service_role;'
    );
  });

  it('keeps the installed reader rule: active membership and an invoice still open', () => {
    expect(sql).toContain("cm.membership_lifecycle_status = 'active'");
    expect(sql).toContain("i.status IN ('pending', 'generated', 'overdue')");
    expect(sql).toContain("i.invoice_type IS DISTINCT FROM 'cashier_cashout'");
    expect(sql).toContain('ac.recipient_id = p_user_id');
  });

  it('replaces nothing that exists and writes nothing', () => {
    expect(sql).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM|DROP|ALTER TABLE)\b/);
    expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
  });
});
