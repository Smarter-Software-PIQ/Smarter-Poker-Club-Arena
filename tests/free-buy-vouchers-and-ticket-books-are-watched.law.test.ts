import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Owner rules 2026-11-05: guarantee funding H = max(0, G - C), zero once
// C >= G; a Free Buy without a guarantee is funded H = V (one promo chip per
// first entry); five tickets per player per gaming day, one per event.
// Executed in scripts/ci/test-guarantee-funding-watch.py; this pins the shape.
const MIG =
  'supabase/migrations/20261106194903_free_buy_vouchers_and_ticket_books_are_watched_and_every_fun.sql';
const sql = readFileSync(MIG, 'utf8');
const code = sql.replace(/--[^\n]*/g, ' ');
const fn = code.slice(
  code.indexOf('CREATE FUNCTION public.fn_ca_free_buy_funding_watch'),
  code.indexOf('$function$;')
);

describe('Free Buy vouchers and ticket books are watched', () => {
  it('reads guarantee funding from fn_ca_guarantee_funding and vouchers against first entries', () => {
    expect(fn).toContain('public.fn_ca_guarantee_funding(t.id)');
    expect(fn).toContain('public.fn_ca_midway_free_buy_format(t.id)');
    expect(fn).toContain(
      '(SELECT count(*) FROM public.tournament_players p WHERE p.tournament_id = fb.id) AS v'
    );
    expect(fn).toContain('WHERE abs(v.p - v.v) > 0.01');
  });

  it('watches every ticket book defect', () => {
    for (const kind of [
      'ticket_day_mismatch',
      'ticket_without_entry',
      'ticket_on_cancelled_event',
      'entry_without_ticket',
      'free_buy_without_format',
    ]) {
      expect(fn).toContain(`'${kind}'`);
    }
  });

  it('alerts once per finding, resolves it when it clears, and never moves chips', () => {
    expect(fn).toContain('public.fn_raise_server_financial_alert(');
    expect(fn).toContain("f.kind || ':' || f.subject");
    expect(fn).toMatch(/UPDATE public\.financial_alerts a\s+SET resolved = true/);
    expect(fn).not.toMatch(/chip_balance|chip_treasury|promo_wallet\s*[-+=]|INSERT INTO public\.chip_ledger/);
    expect(code).toContain("cron.schedule('ca-free-buy-funding-watch-15m'");
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_free_buy_funding_watch\(\) FROM PUBLIC, anon, authenticated;/
    );
  });
});
