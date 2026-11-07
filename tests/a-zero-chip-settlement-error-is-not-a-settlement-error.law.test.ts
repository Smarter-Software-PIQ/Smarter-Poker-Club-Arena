import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A ZERO-CHIP SETTLEMENT ERROR IS NOT A SETTLEMENT ERROR (2026-11-07).
 *
 * fn_ca_escrow_balance_drift filed 26 of the 46 unresolved drift_incident
 * alerts and every one was false, for two reasons:
 *
 * LAW 1 - THE AMOUNT FILED IS THE AMOUNT TESTED. The detector trips per bank
 *   and files the SUM of the three bank differences, so a prize/fee pair that
 *   disagrees by the same amount with opposite signs filed a 'settlement_error'
 *   of exactly 0.00 chips: 25 of them in one sweep tick on 2026-11-03, every
 *   one a fully refunded CANCELLED Spin whose escrow balances. The guard is on
 *   the measured amount itself (v_diff <> 0), never on an invented tolerance,
 *   and the pre-existing per-bank 0.01 trip test is left exactly as it was so
 *   the change can only ever narrow.
 * LAW 2 - A JOURNAL-BOUND CORRECTION IS ACCOUNTED FOR, NOT DRIFT. The one
 *   owner-authorized bounty/guarantee correction is recognised POSITIVELY by
 *   its corroborating chip_ledger row, as narrowly as the door in
 *   trg_freeze_finalized_tournament_prize_pool admits it, and never by a
 *   hard-coded tournament id or a time window. A correction without its ledger
 *   row, or with any field of it altered, is still a drift.
 * LAW 3 - BOTH ROW IMAGES ARE PINNED. The migration refuses any live body but
 *   the proven preimage, derives the postimage from it by anchored
 *   replacement, refuses any derived text but the proven postimage, and reads
 *   the installed body back byte-identical.
 */
const MIG =
  'supabase/migrations/20261107143600_a_zero_chip_settlement_error_is_not_a_settlement_error.sql';
const sql = readFileSync(MIG, 'utf8');

const PREIMAGE_MD5 = '62bc43d2d2846fd066fc86919eb55598';
const POSTIMAGE_MD5 = '9898d7b3dc17564f522892164c85de65';

/** The body of one dollar-quoted replacement literal, e.g. $b2$...$b2$. */
const lit = (tag: string): string => {
  const d = '$' + tag + '$';
  const from = sql.indexOf(d);
  const to = sql.indexOf(d, from + d.length);
  if (from < 0 || to < 0) throw new Error(`no ${d} literal in ${MIG}`);
  return sql.slice(from + d.length, to);
};

/** The new decision, with its explanatory comments stripped: code only. */
const decision = lit('b2').replace(/\/\*[\s\S]*?\*\//g, ' ');
const predicate = decision.slice(decision.indexOf('IF ('), decision.lastIndexOf('THEN'));

describe('LAW 1: the amount filed is the amount tested', () => {
  it('measures one quantity, the sum of the three banks against the shadow', () => {
    expect(decision).toContain(
      'v_diff := round((r.prize_balance + r.bounty_balance + r.fee_balance) - (e.prize_balance - r.reserve_out + r.reserve_in + e.bounty_balance + e.fee_balance), 2);'
    );
    expect(decision).toContain(
      'v_prize_gap := round(r.prize_balance - (e.prize_balance - r.reserve_out + r.reserve_in), 2);'
    );
  });

  it('files nothing when the measured discrepancy is zero', () => {
    expect(predicate).toContain('AND v_diff <> 0');
  });

  it('guards on the measured amount, not on an invented tolerance', () => {
    // The only numeric literals in the predicate are the three pre-existing
    // per-bank 0.01 comparisons and the round(..., 2) scales. No new threshold.
    const thresholds = predicate.match(/[<>]\s*=?\s*0?\.\d+/g) ?? [];
    expect(thresholds).toEqual(['> 0.01', '> 0.01', '> 0.01']);
    expect(predicate).not.toMatch(/v_diff\s*[<>]\s*[-0-9.]/);
  });

  it('leaves the per-bank trip test byte-for-byte as it was', () => {
    const trip =
      'abs(r.prize_balance - (e.prize_balance - r.reserve_out + r.reserve_in)) > 0.01 OR abs(r.bounty_balance - e.bounty_balance) > 0.01 OR abs(r.fee_balance - e.fee_balance) > 0.01';
    expect(lit('a2')).toContain(trip); // the preimage's test
    expect(predicate).toContain(trip); // and the postimage's, unchanged
  });

  it('files the measured amount itself as the discrepancy', () => {
    expect(lit('a4')).toContain(
      'round((r.prize_balance + r.bounty_balance + r.fee_balance) - (e.prize_balance - r.reserve_out + r.reserve_in + e.bounty_balance + e.fee_balance), 2),'
    );
    expect(lit('b4').trim()).toBe('v_diff,');
    expect(lit('b3').trim()).toBe('v_gap := v_gap + abs(v_diff);');
  });
});

describe('LAW 2: a journal-bound owner correction is accounted for, not drift', () => {
  it('recognises the correction only through a corroborating chip_ledger row', () => {
    expect(predicate).toContain(
      'AND NOT (v_prize_gap = v_diff AND EXISTS (SELECT 1 FROM public.chip_ledger l'
    );
  });

  it('requires every field of the door it mirrors', () => {
    for (const term of [
      'l.tournament_id = r.tournament_id',
      "left(l.idempotency_key, length('tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_')) = 'tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_'",
      "l.category = 'reversal'",
      "l.from_type = 'prize_liability'",
      'l.from_entity_id = r.tournament_id',
      "l.to_type = 'union_bank'",
      'l.to_entity_id IS NOT NULL',
      "l.metadata->>'kind' = 'owner_bounty_guarantee_correction'",
      "jsonb_typeof(l.metadata->'tournament_before') = 'object'",
      "jsonb_typeof(l.metadata->'tournament_after') = 'object'",
      "jsonb_typeof(l.metadata->'owner_instruction') = 'string'",
      'round(l.amount, 2) = - v_diff',
    ])
      expect(predicate).toContain(term);
  });

  it('excuses only a gap that sits wholly in the prize bank the leg left from', () => {
    expect(predicate).toContain('v_prize_gap = v_diff AND EXISTS');
  });

  it('names no tournament id', () => {
    expect(predicate).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('names no interval and no time window', () => {
    expect(predicate).not.toMatch(
      /\binterval\b|make_interval|\bnow\s*\(|current_timestamp|\bage\s*\(|created_at|detected_at|updated_at/i
    );
  });
});

describe('LAW 3: both row images are pinned', () => {
  it('is one transaction', () => {
    const code = sql.replace(/^--[^\n]*$/gm, '');
    expect(code.trimStart().startsWith('BEGIN;')).toBe(true);
    expect(code.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('pins the preimage and the postimage', () => {
    expect(sql).toContain(`v_pre_md5  constant text := '${PREIMAGE_MD5}';`);
    expect(sql).toContain(`v_post_md5 constant text := '${POSTIMAGE_MD5}';`);
    expect(sql).toContain("RAISE EXCEPTION 'escrow zero drift guard: unexpected live body %'");
    expect(sql).toContain('is not the proven postimage');
    expect(sql).toContain(
      "RAISE EXCEPTION 'escrow zero drift guard: exact postimage readback failed'"
    );
    expect(sql).toMatch(
      /@live-proof: \(SELECT md5\(pg_get_functiondef\('public\.fn_ca_escrow_balance_drift\(integer\)'::regprocedure\)\)\) = '9898d7b3dc17564f522892164c85de65'/
    );
  });

  it('refuses in the break window and is idempotent on the postimage', () => {
    expect(sql).toContain('public.fn_ca_break_window_refuses_migrations(now())');
    expect(sql).toContain('IF md5(v_src) = v_post_md5 THEN');
  });

  it('checks every anchor was found', () => {
    for (const n of [1, 2, 3, 4]) expect(sql).toContain(`escrow zero drift guard: anchor ${n}`);
  });

  it('keeps the detector authority and the service-role-only grant', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_escrow_balance_drift\(integer\) FROM PUBLIC, anon, authenticated;/
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_ca_escrow_balance_drift\(integer\) TO service_role;/
    );
    expect(sql).toContain("ARRAY['search_path=public']::text[]");
    expect(sql).toContain("'{postgres=X/postgres,service_role=X/postgres}'");
    expect(sql).toContain('escrow zero drift guard: authority drift after');
  });

  it('resolves no alert of its own', () => {
    expect(sql).not.toMatch(/UPDATE\s+public\.financial_alerts/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.ca_drift_incidents/i);
    expect(sql).not.toMatch(/\bfn_resolve_settled_financial_alerts\b/);
  });
});
