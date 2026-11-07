/**
 * ===========================================================================
 *  A FALSE ESCROW DRIFT ALERT CLOSES ON A RE-MEASUREMENT (2026-11-07)
 * ===========================================================================
 *
 * fn_ca_escrow_balance_drift filed 26 alerts that were false, 25 of them in a
 * single sweep tick, and nothing on this platform could ever retire them: the
 * 26 escrow rows are all terminally closed, and 35,479 escrow rows are newer
 * than the oldest of them, so the sweep's own 5,000-row window can never see
 * them again. Migration 20261107165633 adds CLASS 8 to
 * fn_resolve_settled_financial_alerts to retire them on re-measured evidence.
 *
 * The danger this law exists for is not that the closer closes too little. It
 * is that the easy closure was sitting right there: all 26 twin
 * ca_drift_incidents rows were ALREADY resolved with closure_basis
 * 'aged_out_unverified' - retired because the detector went quiet. Across the
 * drift_incident:* family on 2026-11-07 there were 42 closed twins of which
 * only 3 were verified_remeasured and 39 were aged_out_unverified. A closer
 * that read the twin, or read elapsed time, would have shut 39 alerts on
 * nothing at all and looked exactly like a closer that had proven something.
 *
 * So this law pins, in the migration itself:
 *   1. class 8 reads ONE source and no other;
 *   2. its alert predicate never touches the twin incident, its closure_basis,
 *      its resolved_at, or any clock arithmetic - it re-measures instead;
 *   3. the class A term is the measured total being exactly zero;
 *   4. the class B term is bound to a chip_ledger row carrying every required
 *      field, with an amount equal to the measured gap;
 *   5. the predicate is the DETECTOR's predicate, character for character, so
 *      the two cannot drift apart without this test failing;
 *   6. the preimage and postimage md5s are the ones that were proven against
 *      production;
 *   7. classes 1-7 are byte-for-byte what they were before.
 *
 * If this law refuses your change, the change is wrong. Silence is never the
 * evidence.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const CLOSER = '20261107165633_a_false_escrow_drift_alert_closes_on_a_re_measurement.sql';
const PRIOR = '20261107140719_an_unknown_finish_outcome_alarm_closes_on_its_single_receipt.sql';
const DETECTOR = '20261107143600_a_zero_chip_settlement_error_is_not_a_settlement_error.sql';

const closer = readFileSync(join(DIR, CLOSER), 'utf8');
const prior = readFileSync(join(DIR, PRIOR), 'utf8');
const detector = readFileSync(join(DIR, DETECTOR), 'utf8');

/** The function body a migration of this family embeds as its postimage. */
function embeddedBody(sql: string): string {
  const open = sql.indexOf('$post$');
  const close = sql.lastIndexOf('$post$');
  expect(open, 'the migration embeds a $post$-quoted postimage').toBeGreaterThan(-1);
  expect(close, 'the postimage is closed').toBeGreaterThan(open);
  return sql.slice(open + '$post$'.length, close);
}

const PRE_MD5 = 'dcbc68f86ca771e9c97f86add77b2ccd';
const POST_MD5 = '35fa1bb339f52b4411302d52b979c538';

const preimage = embeddedBody(prior);
const postimage = embeddedBody(closer);

/** The one measured quantity, exactly as the detector writes it. */
const V_DIFF =
  '(r.prize_balance + r.bounty_balance + r.fee_balance) - ' +
  '(e.prize_balance - r.reserve_out + r.reserve_in + e.bounty_balance + e.fee_balance)';
/** The part of it sitting in the prize bank. */
const V_PRIZE_GAP = 'r.prize_balance - (e.prize_balance - r.reserve_out + r.reserve_in)';

const CLASS8_START = '  -- CLASS 8: an escrow DRIFT ALERT that a fresh re-measure refutes.';
/** Where class 8 ends: the pre-existing class 3 apply block it was spliced in front of. */
const AFTER_CLASS8 =
  '  IF p_apply THEN\n    UPDATE public.financial_alerts a\n' +
  '       SET resolved = true, resolved_at = now(),\n' +
  "           context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(\n" +
  "             'resolution', 'the post-commit envelope for this hand has been applied;";

function class8(): string {
  const from = postimage.indexOf(CLASS8_START);
  expect(from, 'class 8 is in the postimage, under its own banner').toBeGreaterThan(-1);
  const to = postimage.indexOf(AFTER_CLASS8, from);
  expect(to, 'class 8 ends where the pre-existing class 3 apply block begins').toBeGreaterThan(
    from
  );
  return postimage.slice(from, to);
}

/** Class 8 up to the twin upgrade: everything that decides whether an ALERT closes. */
function alertDecision(): string {
  const whole = class8();
  const i = whole.indexOf('WITH twins AS (');
  expect(i, 'class 8 upgrades the twin in a clearly separated block').toBeGreaterThan(-1);
  return whole.slice(0, i);
}

const squash = (s: string) => s.replace(/\s+/g, ' ');

/**
 * NOTE ON ASSERTING THE NEGATIVE (the same device
 * tests/an-open-alert-silences-only-its-own-finding.law.test.ts uses): class 8
 * EXPLAINS in its comments the twin fields it refuses to read, so every scan
 * for a forbidden read runs on a copy with SQL comments blanked.
 */
function codeOnly(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

describe('a false escrow drift alert closes on a re-measurement', () => {
  it('the postimage is the proven one and the preimage is the live body it replaces', () => {
    // md5 over the embedded text, which is what the migration itself checks.
    const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');
    expect(md5(preimage), 'the class 7 migration still embeds the preimage').toBe(PRE_MD5);
    expect(md5(postimage), 'the closer embeds the postimage proven in production').toBe(POST_MD5);
    expect(closer).toContain(`md5(v_post) <> '${POST_MD5}'`);
    expect(closer).toContain(`md5(v_actual) <> '${PRE_MD5}'`);
    expect(closer).toContain(`@live-proof:`);
    expect(closer).toContain(POST_MD5);
  });

  it('classes 1-7 are byte-for-byte unchanged', () => {
    // Undo class 8 and nothing else, then the postimage must BE the preimage.
    const DECLS =
      "  v_drift     integer := 0;\n  v_drift_ids uuid[] := '{}';\n  v_twins     integer := 0;\n";
    const NEW_KEYS =
      "    'escrow_drift_false_positive_closed', v_drift,\n" +
      "    'escrow_drift_incident_twins_upgraded', v_twins,\n";
    const NEW_TOTAL =
      "    'total', v_paid + v_overpaid + v_settled + v_released + v_ops + v_fin + v_unk + v_drift,";
    const OLD_TOTAL =
      "    'total', v_paid + v_overpaid + v_settled + v_released + v_ops + v_fin + v_unk,";
    for (const piece of [DECLS, NEW_KEYS, NEW_TOTAL]) {
      expect(postimage.split(piece).length - 1, `exactly one ${piece.slice(0, 32)}...`).toBe(1);
    }
    const undone = postimage
      .replace(DECLS, '')
      .replace(class8(), '')
      .replace(NEW_KEYS, '')
      .replace(NEW_TOTAL, OLD_TOTAL);
    expect(
      undone,
      'class 8 may only ADD: removing its declarations, its body and its return ' +
        'keys must leave the previous live body exactly as it was'
    ).toBe(preimage);
  });

  it('class 8 reads one source and no other', () => {
    const decision = alertDecision();
    const sources = [...decision.matchAll(/a\.source\s*=\s*'([^']+)'/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThan(0);
    expect([...new Set(sources)]).toEqual(['drift_incident:fn_ca_escrow_balance_drift']);
    expect(decision).not.toMatch(/a\.source\s+IN\s*\(/);
  });

  it('it re-measures instead of reading the twin, and never reads a clock', () => {
    const decision = codeOnly(alertDecision());
    // The twin's closure is not evidence and is not even in scope here. The
    // incident table is not joined, so none of its columns can be read: not
    // resolved, not resolved_at, not closure_basis.
    for (const forbidden of [
      'ca_drift_incidents',
      'closure_basis',
      'aged_out_unverified',
      'verified_remeasured',
      'resolved_at >',
      'resolved_at <',
      'a.created_at >',
      'a.created_at <',
    ]) {
      expect(
        decision.includes(forbidden),
        `the alert decision must not read ${forbidden}: an age-out is "I could not tell"`
      ).toBe(false);
    }
    // No time window anywhere in the migration, in SQL or in prose.
    expect(closer).not.toMatch(/\binterval\b/i);
    expect(closer).not.toContain('now() -');
    expect(closer).not.toMatch(/make_interval|age\s*\(|extract\s*\(\s*epoch/i);
    // It does re-measure, from the live row and the shadow, twice - once for the
    // preview and once again verbatim under the UPDATE.
    expect(decision.split(V_DIFF).length - 1).toBeGreaterThanOrEqual(2);
    expect(decision).toContain('public.fn_ca_tournament_escrow(r.tournament_id)');
    // Only a terminally closed escrow can be measured once and for all.
    expect(decision.split('r.terminal_closed_at IS NOT NULL').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('class A closes only on a measured total of exactly zero', () => {
    const decision = codeOnly(alertDecision());
    expect(decision).toContain(`round(${V_DIFF}, 2) AS v_diff`);
    expect(decision).toContain('g.v_diff = 0');
    // Not a tolerance, and not a per-bank test: the amount filed is the amount
    // tested. Nothing here may admit a near-zero.
    expect(decision).not.toMatch(/abs\(\s*g\.v_diff\s*\)\s*<[^>]/);
    expect(decision).not.toMatch(/g\.v_diff\s*(<|>)=?\s*0\.0/);
  });

  it('class B closes only on a chip_ledger row that carries every required field', () => {
    const decision = codeOnly(alertDecision());
    expect(decision).toContain(`round(${V_PRIZE_GAP}, 2) AS v_prize_gap`);
    expect(decision).toContain('g.v_diff <> 0');
    expect(decision).toContain('g.v_prize_gap = g.v_diff');
    for (const term of [
      'FROM public.chip_ledger l',
      'l.tournament_id = r.tournament_id',
      "':owner_bounty_guarantee_'",
      "l.category = 'reversal'",
      "l.from_type = 'prize_liability'",
      'l.from_entity_id = r.tournament_id',
      "l.to_type = 'union_bank'",
      'l.to_entity_id IS NOT NULL',
      "l.metadata->>'kind' = 'owner_bounty_guarantee_correction'",
      "jsonb_typeof(l.metadata->'tournament_before') = 'object'",
      "jsonb_typeof(l.metadata->'tournament_after') = 'object'",
      "jsonb_typeof(l.metadata->'owner_instruction') = 'string'",
      'round(l.amount, 2) = - g.v_diff',
    ]) {
      expect(decision.includes(term), `class B must require ${term}`).toBe(true);
    }
    // No tournament id may be hard-coded into the predicate: the door is the
    // ledger row's shape, not one event's name.
    const uuids = codeOnly(alertDecision()).match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
    );
    expect(uuids, 'the predicate names no specific tournament').toBe(null);
  });

  it('the closer and the detector measure the same thing, character for character', () => {
    // There is deliberately no shared helper function: the detector re-reads its
    // escrow row immediately before the shadow so both reads are milliseconds
    // apart, and a helper would also have to name the shadow chips function,
    // which would park tests/attention-items-close-at-their-roots.law.test.ts on
    // one of these files. They are pinned to each other textually instead.
    expect(detector).toContain(V_DIFF);
    expect(detector).toContain(V_PRIZE_GAP);
    const decision = alertDecision();
    const from = decision.indexOf('EXISTS (SELECT 1 FROM public.chip_ledger l');
    const to = decision.indexOf('round(l.amount, 2) = - g.v_diff', from);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const mine = squash(decision.slice(from, to + 'round(l.amount, 2) = - g.v_diff'.length));
    expect(
      squash(detector).includes(mine.replace('- g.v_diff', '- v_diff')),
      'class 8 owner-correction door must be the detector door, term for term. ' +
        'If you changed one, change the other in the same commit.'
    ).toBe(true);
  });

  it('an aged-out closure is replaced by evidence, never inherited from', () => {
    const whole = class8();
    const twins = whole.slice(whole.indexOf('WITH twins AS ('));
    expect(twins).toContain("closure_basis = 'verified_remeasured'");
    expect(twins).toContain("d.closure_basis = 'aged_out_unverified'");
    expect(twins).toContain("correction_ref = 'verified: re-measured by");
    // The superseded wording survives, so nothing is destroyed.
    expect(twins).toContain("'superseded_closure_basis', d.closure_basis");
    expect(twins).toContain("'superseded_correction_ref', d.correction_ref");
    expect(twins).toContain("'superseded_resolution', d.resolution");
    // Bound to alerts this run actually closed, and re-measured again here.
    expect(twins).toContain('a.id = ANY(v_drift_ids)');
    expect(twins).toContain('a.resolved IS TRUE');
    expect(twins).toContain('r.terminal_closed_at IS NOT NULL');
    expect(twins).toContain('g.v_diff = 0');
    // status and resolved_at stay put, so no closure can propagate from here:
    // zz_ca_incident_resolution_reaches_the_alerts is AFTER UPDATE OF status.
    const setList = codeOnly(twins).slice(
      twins.indexOf("SET closure_basis = 'verified_remeasured'"),
      twins.indexOf('FROM public.financial_alerts a,')
    );
    expect(setList.length).toBeGreaterThan(100);
    expect(setList, 'the twin upgrade must not write status').not.toMatch(/\bstatus\s*=/);
    expect(setList, 'the twin upgrade must not write resolved_at').not.toMatch(/\bresolved_at\s*=/);
    expect(setList, 'the twin upgrade must not write resolved').not.toMatch(/\bresolved\s*=/);
  });

  it('this migration moves no chips and names no shadow it does not define', () => {
    expect(closer).not.toMatch(/INSERT INTO public\.chip_ledger/i);
    expect(closer).not.toMatch(
      /UPDATE public\.(chip_ledger|tournament_escrow|wallets|club_members|union_wallets)\b/i
    );
    // Naming the shadow chips function here would move
    // tests/attention-items-close-at-their-roots.law.test.ts onto this file,
    // which does not define the shadow and cannot carry its clause.
    expect(closer).not.toContain('fn_ca_tournament_escrow_chips');
  });
});
