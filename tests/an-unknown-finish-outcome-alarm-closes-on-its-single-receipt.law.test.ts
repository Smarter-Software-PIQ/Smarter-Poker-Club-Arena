/**
 * AN UNKNOWN FINISH OUTCOME ALARM CLOSES ON ITS SINGLE RECEIPT (2026-11-07)
 *
 * Tournament.atomic_finish_outcome_unknown is raised when the atomic finish
 * cannot resolve the receipt of a completion it may already have committed.
 * Nothing closed it: class 6 admits only a PROVEN refusal and says so on
 * purpose. fn_resolve_settled_financial_alerts class 7 closes one of these
 * only on evidence that the finish committed EXACTLY ONCE - one terminal
 * receipt, counted, written at or after the alarm, whose pools equal the
 * tournament's on both sides, with the payout rows conserving the prize pool
 * to the cent and the escrow terminally closed at zero. The risk here is a
 * double commit, so a second receipt or a broken conservation must keep the
 * alarm open.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20261107140719_an_unknown_finish_outcome_alarm_closes_on_its_single_receipt.sql',
  'utf8'
);
const start = sql.indexOf('-- CLASS 7:');
const body = sql.slice(start, sql.indexOf('INTO v_unk_ids FROM changed;', start));
const preview = body.slice(
  body.indexOf('  SELECT COALESCE(array_agg(id)'),
  body.indexOf('IF p_apply THEN')
);
const update = body.slice(body.indexOf('WITH changed AS'));

const EXACTLY_ONE_RECEIPT =
  'AND (SELECT count(*) FROM public.tournament_terminal_settlements r2\n' +
  '             WHERE r2.tournament_id = t.id) = 1';
const PRIZE_CONSERVED =
  'AND round(COALESCE((SELECT sum(p.amount) FROM public.tournament_payouts p\n' +
  '                            WHERE p.tournament_id = t.id), 0), 2)\n' +
  '             = round(COALESCE(t.prize_pool, 0), 2)';

describe('an unknown finish outcome alarm closes on its single receipt', () => {
  it('reads only the unknown-outcome source, and only with the flag set', () => {
    const sources = new Set(body.match(/'Tournament\.[a-z_]+'/g));
    expect(sources).toEqual(new Set(["'Tournament.atomic_finish_outcome_unknown'"]));
    for (const slice of [preview, update]) {
      expect(slice).toContain("a.source = 'Tournament.atomic_finish_outcome_unknown'");
      expect(slice).toContain(
        "lower(COALESCE(a.context->>'outcome_unknown', '')) IN ('true', 't', '1')"
      );
      // class 6's flag is not this class's evidence, and this class must not
      // reach for it: these alarms all carry proven_refusal false.
      expect(slice).not.toContain('proven_refusal');
    }
  });

  it('requires every evidence clause in the preview AND again under the update', () => {
    for (const clause of [
      "t.status = 'COMPLETED'",
      't.satellite_target_id IS NULL',
      'e.tournament_id = t.id',
      'e.terminal_closed_at IS NOT NULL',
      'e.terminal_closed_at >= a.created_at',
      'COALESCE(e.prize_balance, 0) = 0',
      'COALESCE(e.bounty_balance, 0) = 0',
      'r.tournament_id = t.id',
      'r.settled_at IS NOT NULL',
      'r.settled_at >= a.created_at',
      'round(COALESCE(r.prize_pool, 0), 2) = round(COALESCE(t.prize_pool, 0), 2)',
      'round(COALESCE(r.bounty_pool, 0), 2) = round(COALESCE(t.bounty_pool, 0), 2)',
      EXACTLY_ONE_RECEIPT,
      PRIZE_CONSERVED,
    ]) {
      expect(preview).toContain(clause);
      expect(update).toContain(clause);
    }
  });

  it('counts the terminal receipts instead of merely asking whether one exists', () => {
    // A second receipt is a double commit. EXISTS cannot tell one from two, so
    // the class may never settle for it here.
    expect(body.split(EXACTLY_ONE_RECEIPT).length - 1).toBe(2);
    expect(body).not.toMatch(/EXISTS\s*\(\s*SELECT 1 FROM public\.tournament_terminal_settlements/);
  });

  it('conserves the money on both sides, and never closes on elapsed time', () => {
    expect(body.split(PRIZE_CONSERVED).length - 1).toBe(2);
    // The bounty side is the receipt's own pool equality, which the receipt
    // table's CHECK (bounty_payout_total = bounty_pool) carries the rest of
    // the way; a bounty ROW sum would refuse every PKO forever.
    expect(
      body.split('round(COALESCE(r.bounty_pool, 0), 2) = round(COALESCE(t.bounty_pool, 0), 2)')
        .length - 1
    ).toBe(2);
    expect(body).not.toMatch(/interval|now\(\)\s*-/);
  });

  it('casts the tournament id only behind a uuid shape check', () => {
    expect(body).not.toMatch(/=\s*\(a\.context->>'tournament_id'\)::uuid/);
    expect(preview).toContain(
      "~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'"
    );
    expect(update).toContain(
      "~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'"
    );
  });

  it('installs only over the exact preimage and reads back the exact postimage', () => {
    expect(sql).toContain("md5(v_actual) <> 'edc04fde4628a061caa34d9967dee310'");
    expect(sql).toContain("md5(v_post) <> 'dcbc68f86ca771e9c97f86add77b2ccd'");
    expect(sql).toContain('pg_get_functiondef(v_oid) IS DISTINCT FROM v_post');
    expect(sql).toContain('fn_ca_break_window_refuses_migrations(now())');
  });

  it('adds a class and loosens nothing: classes 1-6 are still in the postimage', () => {
    for (const marker of [
      '-- ── CLASS 1:',
      '-- ── CLASS 2:',
      '-- CLASS 3:',
      '-- CLASS 4 / STAGE 1 (PARTIAL):',
      '-- CLASS 5:',
      '-- CLASS 6:',
    ]) {
      expect(sql).toContain(marker);
    }
    // class 6 still closes only a PROVEN refusal
    expect(sql).toContain(
      "lower(COALESCE(a.context->>'proven_refusal', '')) IN ('true', 't', '1')"
    );
    expect(sql).toContain("'unknown_finish_outcome_proven', v_unk,");
    expect(sql).toContain(
      "'total', v_paid + v_overpaid + v_settled + v_released + v_ops + v_fin + v_unk,"
    );
  });
});
