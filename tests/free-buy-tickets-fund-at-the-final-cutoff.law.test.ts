import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Owner ruling 2026-11-05 14:24 CT: five Free Buy tickets per user per day;
// a ticket covers the first entry; rebuys and add-ons are paid from the
// wallet; nothing is credited to a prize pool until every window has closed;
// guaranteed P = max(G, C), U = max(0, G - C); otherwise P = V + C, U = V;
// U comes from the Midway promo wallet at the cutoff; no tournament-ID
// exceptions. The money paths are executed in
// scripts/ci/test-free-buy-tickets.py; this pins the shape that test proves.
const DIR = 'supabase/migrations';
const CANDIDATE = `${DIR}/20261105204917_free_buy_tickets_and_guarantees_fund_at_the_final_cutoff.sql`;
const WATCH = `${DIR}/20261105204918_midway_free_buy_watch_reads_the_schedule_not_event_ids.sql`;
const OLD_WATCH = `${DIR}/20261105183114_midway_free_buy_rotation_and_promo_runway_watch.sql`;
const sql = readFileSync(CANDIDATE, 'utf8');
const code = sql.replace(/--[^\n]*/g, ' ');

describe('Free Buy tickets fund at the final cutoff', () => {
  it('grants five tickets per user per tournament day, exactly once, moving no chips', () => {
    expect(code).toContain('tickets smallint NOT NULL DEFAULT 5 CHECK (tickets = 5)');
    expect(code).toContain('PRIMARY KEY (user_id, ticket_day)');
    expect(code).toMatch(/FROM public\.profiles p\s+ON CONFLICT \(user_id, ticket_day\) DO NOTHING/);
    expect(code).toContain("cron.schedule('free-buy-daily-tickets'");
    const grant = code.slice(code.indexOf('fn_ca_grant_daily_free_buy_tickets(p_day date'));
    expect(grant.slice(0, grant.indexOf('$f$;'))).not.toMatch(/chip_balance|promo_wallet|chip_ledger/);
  });

  it('puts the 12:30 AM Free Buy on the previous day through the daily window policy', () => {
    expect(code).toContain(
      'SELECT ((p_at AT TIME ZONE p.time_zone) - p.window_start)::date\n    FROM smarter_private.daily_window_policy p'
    );
  });

  it('spends one ticket per user per event and at most five per day, under a lock', () => {
    expect(code).toContain('UNIQUE (tournament_id, user_id)');
    expect(code).toMatch(/ticket_day = v_day FOR UPDATE/);
    expect(code).toContain('IF v_used >= 5 THEN');
    expect(code).toContain('free_buy_ticket_already_used');
  });

  it('books no prize chip at the till and only the bounty share of a ticket entry', () => {
    expect(code).toContain('v_split.charge:=0; v_split.rake:=0; v_split.prize:=0;');
    expect(code).toContain("v_prize:=0;                                        ");
    expect(sql).toContain("CASE WHEN f.g THEN 0 WHEN f.fmt='pko' THEN 1 WHEN f.fmt='mystery' THEN 0.50 ELSE 0 END");
  });

  it('computes the owner formulas in one place', () => {
    expect(code).toContain('prize_pool := GREATEST(g, c);');
    expect(code).toContain('promo_support := GREATEST(0, g - c);');
    expect(code).toContain('prize_pool := promo_support + c;');
  });

  it('funds at the cutoff inside fn_apply_prize_guarantee, before the core, from the promo wallet only', () => {
    expect(code).toContain("v_anchor constant text := E'    v_result:=public.fn_ca_apply_prize_guarantee_core(\\n'");
    expect(code).toContain('PERFORM public.fn_ca_free_buy_fund_at_cutoff(p_tournament_id);');
    const fund = code.slice(code.indexOf('CREATE FUNCTION public.fn_ca_free_buy_fund_at_cutoff'));
    const body = fund.slice(0, fund.indexOf('$f$;'));
    expect(body).toContain('promo_wallet=promo_wallet-v_move');
    expect(body).not.toMatch(/chip_balance|chip_treasury|bounty_pool\s*=/);
    expect(body).toContain('IF COALESCE(t.prize_pool_finalized,false) THEN');
  });

  it('keeps every pre-ticket registration through an auditable compatibility record', () => {
    expect(code).toContain("'rollout_compat', 'redeemed'");
    expect(code).toContain("x.status = 'redeemed' AND x.kind = 'ticket'");
  });

  it('names no tournament id anywhere in the candidate or the watch', () => {
    const uuids = (s: string) =>
      (s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []).filter(
        (u) =>
          u !== 'fade0000-0000-0000-0000-000000000001' && // the Midway Union
          u !== '2d1cd6c3-5700-4af9-a271-d4863fdab20d' // the system actor
      );
    expect(uuids(code)).toEqual([]);
    expect(uuids(readFileSync(WATCH, 'utf8').replace(/--[^\n]*/g, ' '))).toEqual([]);
  });

  it('retires the id-exempting watch file instead of installing it', () => {
    expect(readFileSync(OLD_WATCH, 'utf8').split('\n')[0]).toMatch(/^-- SUPERSEDED BY 20261105204918\b/);
    expect(readdirSync(DIR).some((f) => f.startsWith('20261105204918_'))).toBe(true);
  });
});
