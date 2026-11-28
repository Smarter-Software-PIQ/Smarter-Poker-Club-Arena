import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Production Alerts fleet, 2026-11-20 (operational_alert_events 446169):
// ca-free-buy-funding-watch-15m was cancelled at its 60 s statement timeout
// three runs in a row. The gtd CTE was referenced once, so Postgres inlined it
// and re-evaluated fn_ca_guarantee_funding at every g.f reference in finding
// (41 s for 433 events, against 25 s evaluated once). The fix is to compute
// each event's funding once: the CTE is MATERIALIZED. The job's timeout is
// never widened to hide the cost.
// Migration 20261122155311 (first written as 20261120055128, never merged;
// re-reserved 2026-11-22 after 20261121154220 changed the live pre-image).

const DIR = 'supabase/migrations';
const DEF = /CREATE (OR REPLACE )?FUNCTION public\.fn_ca_free_buy_funding_watch\(\)/;

function newestDefinition(): { file: string; body: string } {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const sql = readFileSync(`${DIR}/${files[i]}`, 'utf8');
    const at = sql.search(DEF);
    if (at < 0) continue;
    const rest = sql.slice(at);
    const end = rest.indexOf('$function$;');
    return { file: files[i], body: end > 0 ? rest.slice(0, end) : rest };
  }
  throw new Error('no migration defines public.fn_ca_free_buy_funding_watch()');
}

describe('the Free Buy funding watch reads each guarantee once', () => {
  const { file, body } = newestDefinition();
  const code = body.replace(/--[^\n]*/g, ' ');

  it('materializes the per-event guarantee funding before finding reads it', () => {
    expect(file >= '20261122155311', `newest definition is ${file}`).toBe(true);
    expect(code).toMatch(/WITH gtd AS MATERIALIZED \(\s*SELECT t\.id, t\.name, public\.fn_ca_guarantee_funding\(t\.id\) AS f/);
    expect(code).not.toMatch(/WITH gtd AS \(/);
  });

  it('keeps every finding kind and never moves chips', () => {
    for (const kind of [
      'guarantee_overfunded',
      'guarantee_underfunded',
      'voucher_overfunded',
      'voucher_underfunded',
      'ticket_day_mismatch',
      'ticket_without_entry',
      'ticket_on_cancelled_event',
      'entry_without_ticket',
      'early_prize_promo',
      'free_buy_without_format',
    ]) {
      expect(code).toContain(`'${kind}'`);
    }
    expect(code).not.toMatch(/chip_balance|chip_treasury|INSERT INTO public\.chip_ledger/);
  });

  it('keeps the lock and statement limits every fn_ca_%_watch carries (20261121154220)', () => {
    // CREATE OR REPLACE resets a function's SET clauses to the ones it names.
    // 20261121154220 gave every watch lock_timeout 2s and statement_timeout 30s
    // and its live proof requires lock_timeout on each one, so a redefinition
    // that omitted them would silently strip that guard.
    expect(code).toMatch(/SET lock_timeout TO '2s'/);
    expect(code).toMatch(/SET statement_timeout TO '30s'/);
  });

  it('does not buy headroom by widening the job timeout', () => {
    const later = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql') && f >= '20261122155311')
      .map((f) => readFileSync(`${DIR}/${f}`, 'utf8'))
      .join('\n');
    expect(later).not.toMatch(/ca-free-buy-funding-watch-15m[\s\S]{0,200}statement_timeout\s*=\s*'(?:[7-9]\d|\d{3,})s'/);
  });
});
