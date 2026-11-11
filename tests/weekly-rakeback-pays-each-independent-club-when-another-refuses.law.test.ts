/**
 * LAW: inside a union, the weekly payout pays every independently valid, fully
 * funded club when another club refuses (owner decision, Dan, 2026-11-11).
 *
 * Dan: "pay independently valid, fully funded clubs when another club refuses,
 * where their allocations can be established independently ... If the refusal
 * makes the shared allocation itself uncertain, fail closed for the affected
 * scope and explain why; never invent allocations, borrow another club's funds
 * or mark the whole union complete prematurely."
 *
 * THE CAUSE THIS PINS. The weekly runner paid a union as one unit per round,
 * and rounds 2 and 3 and the funding step raised on the first club that
 * refused, so one club's shortfall rolled back every club's payment every
 * minute for 24 hours.
 *
 * WHAT IT REQUIRES.
 *  - Round 1 (the union's shared rake pool and retained share) stays one unit.
 *  - In the runner's owned union unit only, a club whose own plan or funding
 *    refuses is recorded (smarter_private.weekly_payout_club_rounds, one
 *    critical financial_alerts row) and left out; the other clubs are paid.
 *    Every other caller keeps the whole-scope refusal.
 *  - A refusal that names an upline recorded in another club holds both.
 *  - A pass that holds a club writes no union settlement run row and no round
 *    receipt; the runner retries one held unit per tick; finalize refuses while
 *    any club is held.
 *
 * This file reads source only. The behaviour runs on PostgreSQL 17 in
 * scripts/ci/test-rakeback-cascade-real-runner-postgres.py (fixtures
 * club-isolation.py), which the required check "Weekly refusal receipt cover"
 * runs on every migration change.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = 'supabase/migrations';
const VERSION = '20261111174403';
const file = readdirSync(MIGRATIONS).find((name) => name.startsWith(`${VERSION}_`));
const sql = file ? readFileSync(`${MIGRATIONS}/${file}`, 'utf8') : '';
/** SQL with whole-line comments removed, so prose cannot satisfy a pin. */
const code = sql
  .split('\n')
  .filter((line) => !/^\s*--/.test(line))
  .join('\n');
const body = (name: string): string => {
  const start = code.indexOf(`FUNCTION ${name}(`);
  expect(start, `${name} is not defined in ${VERSION}`).toBeGreaterThan(-1);
  const rest = code.slice(start);
  const open = rest.match(/AS (\$[A-Za-z_]*\$)/);
  expect(open, `${name} has no dollar-quoted body`).not.toBeNull();
  const from = open!.index! + open![0].length;
  return rest.slice(from, rest.indexOf(open![1], from));
};
const patch = (label: string): string => {
  // Read from the raw file: a replacement may itself begin or end on a comment line.
  const start = sql.indexOf(`DO $patch_${label}$`);
  expect(start, `patch ${label} is missing`).toBeGreaterThan(-1);
  const block = sql.slice(start, sql.indexOf(`END $patch_${label}$`, start));
  // Only the replacement text of each anchor ($n$...$n$), in order.
  return [...block.matchAll(/\$n\$([\s\S]*?)\$n\$/g)].map((m) => m[1]).join('\n');
};
const HARNESS = 'scripts/ci/test-rakeback-cascade-real-runner-postgres.py';
const CASES = 'scripts/ci/fixtures/rakeback-cascade-real-runner/club-isolation.py';

describe('club isolation inside a union week', () => {
  it('is one transaction on exactly the postimages of 20261111132447, installed at merge', () => {
    expect(file, `migration ${VERSION} is missing`).toBeDefined();
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(code).toContain("SET LOCAL lock_timeout='1s';");
    expect(sql).not.toMatch(/^--\s*@install-window/m);
    for (const preimage of [
      'a854bfbd9fcddb4143c6ead5f61c8141', // round 2 after 20261111132447
      '471233c06fb2fe9cd2c0928756ba4b82', // round 3
      '255ebe71d6f04fa072a87798d20a7c56', // the funding step
      '5ec42349ea8afcff0697873cf317ff93', // finalize
      '332b762a004a779e32dc3fd2d1aef60d', // the runner
      'e90ddb3808272e0563c17b3f3d367528', // the cascade plan (left unchanged)
    ]) {
      expect(code).toContain(`'${preimage}'`);
    }
    expect(sql.match(/^-- @live-proof: /gm)).toHaveLength(8);
  });

  it("applies only in the runner's owned union unit; every other caller keeps the whole-scope refusal", () => {
    expect(body('smarter_private.weekly_payout_club_isolated')).toContain(
      "p_kind='union' AND smarter_private.weekly_payout_owns_round(p_kind,p_id,p_from,p_to,p_round)"
    );
    const refuse = body('smarter_private.weekly_payout_club_refuse');
    expect(refuse).toMatch(
      /IF NOT smarter_private\.weekly_payout_club_isolated\([^)]*\) THEN\s+RAISE EXCEPTION '%',p_message USING ERRCODE='23514';/
    );
    // The funding step runs inside the owned unit, so it holds a club instead of stopping the union.
    const run = patch('runner');
    expect(run.indexOf('round_no=EXCLUDED.round_no;')).toBeLessThan(
      run.indexOf('IF rnd=3 THEN funding:=smarter_private.weekly_payout_fund_agent_shortfalls(')
    );
  });

  it('round 1, the shared union pool, is never split by club', () => {
    expect(code).not.toContain('fn_union_weekly_rakeback_close');
    expect(code).not.toContain('fn_bank_standalone_week_rake');
  });

  it('plans club by club and holds both clubs of a cross-club upline', () => {
    const plan = body('smarter_private.weekly_payout_club_plan');
    expect(plan).toContain(
      'PERFORM smarter_private.rakeback_cascade_plan(p_kind,p_id,p_from,p_to,c);'
    );
    expect(plan).toMatch(/EXCEPTION WHEN check_violation THEN/);
    expect(plan).toContain("IF msg NOT LIKE 'rakeback_cascade_%' THEN RAISE; END IF;");
    expect(plan).toContain("det::jsonb->'clubs'");
    const one = patch('plan_one_club');
    expect(one).toContain('AND x.club_id=p_club;');
    expect(one).toMatch(/recorded in club %'[\s\S]*DETAIL=jsonb_build_object\('clubs'/);
  });

  it('round 2 decides each club before anything moves and completes only when every club is paid', () => {
    const r2 = patch('round2');
    expect(r2.indexOf('weekly_payout_round2_clubs(')).toBeLessThan(
      r2.indexOf('_routed_prior_discharge_context(')
    );
    expect(r2).toContain('IF club_partial IS NOT NULL THEN RETURN club_partial; END IF;');
    // A club an earlier pass paid is never paid again: its settlements are its own.
    expect(r2).toContain(
      'cs.settlement_ref=run_key AND EXISTS(SELECT 1 FROM smarter_private.weekly_payout_club_rounds w'
    );
    const clubs = body('smarter_private.weekly_payout_round2_clubs');
    expect(clubs).toContain("'routed_commission_source_changed_after_payment'");
    for (const code_ of [
      'rakeback_cascade_club_cannot_afford_week',
      'routed_commission_club_funding_shortfall',
      'rakeback_cascade_agent_wallet_missing',
    ]) {
      expect(clubs).toContain(code_);
    }
  });

  it('round 3 and the funding step hold a club round 2 has not paid or that cannot pay its own players', () => {
    const r3 = patch('round3');
    expect(r3).toContain('weekly_payout_round3_clubs(');
    expect(r3.indexOf('weekly_payout_round3_funding_holds(')).toBeLessThan(
      r3.indexOf('FOR NO KEY UPDATE;', r3.indexOf('weekly_payout_round3_funding_holds('))
    );
    expect(r3.indexOf('IF club_partial IS NOT NULL THEN RETURN')).toBeLessThan(
      r3.indexOf('INSERT INTO public.accounting_routed_settlement_runs')
    );
    expect(patch('funding')).toContain(
      'smarter_private.weekly_payout_club_plan(p_kind,p_id,p_from,p_to,3)'
    );
    expect(patch('funding')).toContain('weekly_payout_fund_club_holds(');
    expect(body('smarter_private.weekly_payout_round3_clubs')).toContain(
      'weekly_payout_club_round2_not_paid'
    );
  });

  it('a held club leaves its round open, is retried by the runner, and keeps finalize closed', () => {
    const run = patch('runner');
    expect(run).toContain("res->>'partial'='true'");
    expect(run).toContain("'stage','round_clubs_held'");
    expect(run).toContain('CONTINUE WHEN smarter_private.weekly_payout_unit_waits(');
    const partial = run.slice(
      run.indexOf("res->>'partial'='true'"),
      run.indexOf("'stage','round_clubs_held'")
    );
    expect(partial).not.toContain('weekly_payout_round_receipts');
    expect(partial).not.toContain('union_settlement_rounds');
    expect(patch('finalize')).toContain('weekly_payout_club_still_held');
    expect(body('smarter_private.weekly_payout_club_round_close')).toContain("'partial',true");
  });

  it('every refusal reaches a reader once, with no em dash, and nothing is scheduled', () => {
    const refuse = body('smarter_private.weekly_payout_club_refuse');
    expect(refuse).toContain(
      'INSERT INTO public.financial_alerts(severity,source,message,context)'
    );
    expect(refuse).toContain("'weekly_payout_club_refused'");
    expect(refuse).toContain('IF w.alert_id IS NULL');
    expect(body('smarter_private.weekly_payout_club_round_close')).toContain(
      'UPDATE public.financial_alerts a SET resolved=true'
    );
    expect(sql).not.toContain('—');
    expect(code).not.toMatch(/cron\.(schedule|alter_job)/);
  });

  it('is executed by the real runner harness, week by week', () => {
    expect(readFileSync(HARNESS, 'utf8')).toContain("glob('20261111174403_*.sql')");
    expect(readFileSync(HARNESS, 'utf8')).toContain("exec((F/'club-isolation.py').read_text())");
    const cases = readFileSync(CASES, 'utf8');
    for (const pinned of [
      'round 1 killed at its club O credit',
      'routed_commission_club_funding_shortfall',
      'rakeback_cascade_parent_outside_club',
      'rakeback_cascade_upline_deleted_after_funding',
      'weekly_payout_club_still_held',
      "'rounds_busy'",
    ]) {
      expect(cases).toContain(pinned);
    }
  });
});
