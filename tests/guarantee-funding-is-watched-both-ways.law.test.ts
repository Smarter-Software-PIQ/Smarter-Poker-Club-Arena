import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Owner rule 2026-11-05: house/promo funding of a guaranteed event is
// H = max(0, G - C) in total, with C the players' full payments (places +
// bounty + rake), zero once C >= G, on every path including legacy jobs.
// Executed in scripts/ci/test-guarantee-funding-watch.py; this pins the shape.
const MIG = 'supabase/migrations/20261105233808_guarantee_funding_is_watched_both_ways.sql';
const sql = readFileSync(MIG, 'utf8');
const code = sql.replace(/--[^\n]*/g, ' ');

describe('guarantee funding is watched both ways', () => {
  it('no role can run the legacy back-pay, and its body is not redefined', () => {
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_backpay_guarantee_shortfalls\(boolean,integer\)\s+FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(code).not.toMatch(/FUNCTION public\.fn_ca_backpay_guarantee_shortfalls[^;]*\bAS\b/);
    expect(code).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_ca_backpay_guarantee_shortfalls/
    );
  });

  it('the guarantee check counts rake toward the guarantee', () => {
    expect(sql).toContain(
      'CONTINUE WHEN round(r.paid + r.rake, 2) >= round(r.guaranteed_prize, 2);'
    );
  });

  it('records over- and under-funding from fn_ca_guarantee_funding without moving chips', () => {
    const body = code.slice(
      code.indexOf('CREATE FUNCTION public.fn_ca_guarantee_funding_variance_scan')
    );
    const fn = body.slice(0, body.indexOf('$function$;'));
    expect(fn).toContain('public.fn_ca_guarantee_funding(t.id)');
    expect(fn).toContain(
      "abs((f->>'house_posted')::numeric - (f->>'house_required')::numeric) > 0.01"
    );
    expect(fn).not.toMatch(/chip_balance|chip_treasury|promo_wallet|chip_ledger|financial_alerts/);
    expect(code).toContain("cron.schedule('ca-guarantee-funding-variance-15m'");
  });
});
