/**
 * LAW: weekly rakeback sends ONE transfer per hierarchy edge, and what an agent
 * wallet owes its players is reserved from round 2 until round 3 pays them
 * (lead decision under the owner's money grant, CLAUDE.md 10.9, 2026-11-11).
 *
 * THE CAUSES THIS PINS.
 *  1. Round 2 sent each edge its commission and, in the round 3 unit, the
 *     funding cascade sent the same edge a second leg with the pass-through
 *     (bank -> SA 84 and 50, SA -> AG 30 and 50 in the real-runner board).
 *     Round 2 now carries both in one leg whose metadata records the split, and
 *     the funding step refuses to send anything for a week round 2 carried.
 *  2. Moving the funding into round 2 opened a window (3 h 48 m on 2026-11-09)
 *     in which nothing stopped an agent spending the chips its players are owed,
 *     and one short wallet stalls round 3 for the whole union. One BEFORE trigger
 *     on public.agents now refuses any debit below the reserve, with no bypass
 *     setting: round 3 lowers the reserve by what it pays before it debits.
 *
 * This file reads source only. The behaviour runs on PostgreSQL 17 in the four
 * cascade harnesses named below, which the required check "Weekly refusal
 * receipt cover" runs on every migration change.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = 'supabase/migrations';
const VERSION = '20261111132447';
const file = readdirSync(MIGRATIONS).find((name) => name.startsWith(`${VERSION}_`));
const sql = file ? readFileSync(`${MIGRATIONS}/${file}`, 'utf8') : '';
/** SQL with whole-line comments removed, so prose cannot satisfy a pin. */
const code = sql
  .split('\n')
  .filter((line) => !/^\s*--/.test(line))
  .join('\n');
/** The body of one CREATE [OR REPLACE] FUNCTION, up to its closing tag. */
const body = (name: string): string => {
  const start = code.indexOf(`FUNCTION ${name}(`);
  expect(start, `${name} is not defined in ${VERSION}`).toBeGreaterThan(-1);
  const rest = code.slice(start);
  const open = rest.match(/AS (\$[A-Za-z_]*\$)/);
  expect(open, `${name} has no dollar-quoted body`).not.toBeNull();
  const from = open!.index! + open![0].length;
  return rest.slice(from, rest.indexOf(open![1], from));
};
/** The replacement text of every anchor patch in one DO block. */
const patch = (label: string): string => {
  const start = code.indexOf(`DO $patch_${label}$`);
  expect(start, `patch ${label} is missing`).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf(`END $patch_${label}$`, start));
};

const HARNESSES = [
  'scripts/ci/test-rakeback-cascade-real-runner-postgres.py',
  'scripts/ci/test-rakeback-cascade-real-guards-postgres.py',
  'scripts/ci/test-rakeback-cascade-funding-postgres.py',
  'scripts/ci/test-owner-routing-wallet-postgres.py',
];

describe('one transfer per edge', () => {
  it('exists, is one transaction, and installs at merge under a one second lock timeout', () => {
    expect(file, `migration ${VERSION} is missing`).toBeDefined();
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(code).toContain("SET LOCAL lock_timeout='1s';");
    expect(sql).not.toMatch(/^--\s*@install-window/m);
  });

  it('round 2 sends every leg from one merged edge set, commission plus funding', () => {
    const r2 = patch('round2');
    expect(r2).toContain(
      'FOR v_edge IN SELECT g.club_id,g.payer_user,g.payee_user,g.commission+g.funding AS amount'
    );
    expect(r2).toContain('FROM pg_temp._routed_gross g ORDER BY g.sort_order');
    // The merged set has one row per (club, payer, payee): refused before any transfer otherwise.
    const plan = body('smarter_private.rakeback_cascade_round2_plan');
    expect(plan).toMatch(/GROUP BY club_id,payer_user,payee_user HAVING count\(\*\)>1/);
    expect(plan).toContain('rakeback_cascade_round2_edge_ambiguous');
    expect(plan).toContain('smarter_private.rakeback_cascade_plan(p_kind,p_id,p_from,p_to)');
    // A combined leg records its split; commission alone stays in the settlement rows.
    for (const key of [
      'commission_amount',
      'rakeback_funding',
      'rakeback_funding_key',
      'rakeback_funding_version',
    ])
      expect(r2).toContain(`'${key}'`);
    expect(r2).not.toMatch(/agent_commission_settlements/);
  });

  it('the funding step never sends a second leg for an edge round 2 carried', () => {
    const fund = body('smarter_private.weekly_payout_fund_agent_shortfalls');
    expect(fund).toContain("r.result ? 'rakeback_cascade'");
    expect(fund).toContain('rakeback_cascade_round2_left_edge_unfunded');
    expect(fund).toMatch(/l\.amount-COALESCE\(smarter_private\.rakeback_cascade_leg_funding\(/);
    // Steps 1 to 5 are the merged plan, still one certificate per period, the highest id.
    const plan = body('smarter_private.rakeback_cascade_plan');
    expect(plan).toMatch(
      /SELECT\s+DISTINCT\s+ON\s*\(\s*rp\.id\s*\)[\s\S]{0,400}?ORDER\s+BY\s+rp\.id\s*,\s*c\.id\s+DESC/
    );
  });

  it('a settled leg, which carries no split, reads as funding 0 everywhere', () => {
    const leg = body('smarter_private.rakeback_cascade_leg_funding');
    expect(leg).toMatch(/THEN 0::numeric/);
    expect(patch('zero_standalone')).toContain(
      'l.amount=e.amount+smarter_private.rakeback_cascade_leg_funding(l.metadata,l.amount,'
    );
  });
});

describe("the players' share is reserved until round 3 pays it", () => {
  const guard = body('smarter_private.agent_wallet_keeps_weekly_reserve');

  it('one trigger on public.agents judges every update and delete, after every other BEFORE trigger', () => {
    expect(code).toContain(
      'CREATE TRIGGER zzzzz_agent_wallet_keeps_weekly_reserve BEFORE UPDATE OR DELETE ON public.agents FOR EACH ROW'
    );
    expect(guard).toContain('agent_wallet_weekly_rakeback_reserved');
    expect(guard).toContain('smarter_private.weekly_payout_wallet_reserves');
  });

  it('has no bypass: no setting, role or flag lets a debit through', () => {
    expect(guard).not.toMatch(/current_setting|current_user|session_user|auth\.|is_horse/);
    // The reserve itself is lowered, by functions no client role may call.
    for (const fn of ['weekly_payout_reserve_release', 'weekly_payout_reserve_close'])
      expect(code).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION smarter_private\\.${fn}\\([^)]*\\) FROM PUBLIC,anon,authenticated,service_role;`
        )
      );
    expect(code).toContain(
      'REVOKE ALL ON TABLE smarter_private.weekly_payout_wallet_reserves FROM PUBLIC,anon,authenticated,service_role;'
    );
  });

  it('round 3 releases a reserve before the wallet it reserves is debited', () => {
    const r3 = patch('round3');
    const release = r3.indexOf(
      'PERFORM smarter_private.weekly_payout_reserve_release(r.period_id,r.club_id,g.wallet_user,amount);'
    );
    const debit = r3.indexOf(
      'SELECT agent_wallet_balance INTO payer_before FROM public.agents WHERE club_id=r.club_id AND user_id=g.wallet_user;',
      release
    );
    expect(release, 'round 3 does not release the reserve').toBeGreaterThan(-1);
    expect(debit, 'the release does not come before the debit').toBeGreaterThan(release);
    expect(r3).toContain('PERFORM smarter_private.weekly_payout_reserve_close(r.period_id);');
    expect(r3).toContain(
      'PERFORM smarter_private.weekly_payout_reserve_close(prior_item.period_id);'
    );
  });

  it('round 2 reserves what each paying wallet owes, and finalize refuses a run that left one', () => {
    expect(body('smarter_private.rakeback_cascade_round2_settle')).toContain(
      "smarter_private.weekly_payout_reserve_players_share(p_kind,p_id,p_from,p_to,'round2')"
    );
    expect(body('smarter_private.rakeback_cascade_plan')).toMatch(
      /WHERE l\.route IN\('agent','owner'\) AND l\.owed>0/
    );
    expect(patch('finalize')).toContain('weekly_payout_reserve_not_released');
  });

  it('is not a repair path and adds no schedule', () => {
    expect(code).not.toMatch(
      /cron\.schedule|_repair_|_backpay_|_redrive_|_sweep_|_catchup_|_heal_/i
    );
    expect(code).not.toMatch(/is_horse/);
  });

  it('keeps the four PostgreSQL 17 harnesses that execute it', () => {
    for (const harness of HARNESSES) {
      expect(existsSync(harness), harness).toBe(true);
      const text = readFileSync(harness, 'utf8');
      expect(text, `${harness} does not install ${VERSION}`).toContain(VERSION);
    }
    const between = readFileSync(
      'scripts/ci/fixtures/rakeback-cascade-real-runner/between-rounds.py',
      'utf8'
    );
    for (const door of [
      'fn_agent_wallet_send_core_20260830',
      'fn_agent_wallet_self_stake',
      'business_balance',
    ])
      expect(between).toContain(door);
    expect(
      readFileSync('scripts/ci/fixtures/rakeback-cascade-real-runner/cases.py', 'utf8')
    ).toContain('ONE LEG PER EDGE');
  });
});
