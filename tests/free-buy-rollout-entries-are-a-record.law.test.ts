import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Owner rules 2026-11-05/06: entries made before Free Buy tickets went live
// keep their promo-funded first entry, are recorded, and only the recorded
// entries are exempt from the ticket check. Executed in
// scripts/ci/test-guarantee-funding-watch.py; this pins the shape.
const MIG =
  'supabase/migrations/20261106205705_free_buy_rollout_entries_are_recorded_and_exempt_from_ticket.sql';
const code = readFileSync(MIG, 'utf8').replace(/--[^\n]*/g, ' ');

describe('Free Buy rollout entries are a record, not a clock', () => {
  it('records only pre-install entries that hold their legacy promo head and no ticket', () => {
    expect(code).toContain("c_tickets_live constant timestamptz := '2026-11-05 23:18:46.9654+00'");
    expect(code).toContain(
      "JOIN public.chip_ledger l ON l.idempotency_key = 'tourney:' || t.id::text || ':promo_head:' || p.id::text"
    );
    expect(code).toContain('AND p.registered_at < c_tickets_live');
    expect(code).toMatch(/registered_at >= c_tickets_live;\s+IF v_late <> 0 THEN RAISE EXCEPTION/);
  });

  it('the watch exempts the recorded registrations, not a time window', () => {
    expect(code).toContain('FROM smarter_private.free_buy_rollout_entries g');
    expect(code).toContain(
      "E'       AND p.registered_at >= c_tickets_live AND p.registered_at < v_grace\\n'"
    );
    expect(code).toMatch(/b constant text := E' {7}AND p\.registered_at < v_grace\\n'/);
  });

  it('the record is append-only and moves no chips', () => {
    expect(code).toMatch(
      /REVOKE ALL ON smarter_private\.free_buy_rollout_entries FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(code).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[^;]*free_buy_rollout_entries/);
    expect(code).not.toMatch(/chip_balance|promo_wallet\s*[-+=]|INSERT INTO public\.chip_ledger/);
  });
});
