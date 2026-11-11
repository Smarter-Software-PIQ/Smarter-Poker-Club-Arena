/**
 * LAW: a superseded rakeback certificate never funds anybody, and an owner
 * routing wallet never earns (owner-approved weekly cascade, 2026-11-09).
 *
 * THE CAUSE THIS PINS. Before round 3 the weekly runner calls
 * smarter_private.weekly_payout_fund_agent_shortfalls. Its installed body
 * joined EVERY row of accounting_rakeback_period_calculations for a period,
 * so each superseded certificate version was funded again on top of the
 * latest one. On the week of 2026-11-02 that sent 326.91 too much from a club
 * bank to one agent wallet. The fix is in the read, not in a job that takes
 * the difference back: one certificate per pending period, the highest id.
 *
 * The second half exists because the cascade pays an owner's direct players
 * from the owner's agent wallet. The only older way to give an owner a wallet
 * (fn_ensure_agent_row) mints an ACTIVE row at the union minimum commission,
 * which is an earning agreement nobody made. A wallet_only row is a wallet
 * and nothing else.
 *
 * This file reads source only. The behaviour is executed on PostgreSQL 17 by
 * the harnesses the required check "Weekly refusal receipt cover" runs
 * (.github/workflows/weekly-refusal-cover.yml); this law keeps those harnesses
 * wired there and keeps the two causes from being written back.
 */
import { parse } from 'yaml';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lockTargets, windowLocks } from '../scripts/ci/maintenance-window-migrations.mjs';

const MIGRATIONS = 'supabase/migrations';
const migrationFile = (version: string): string => {
  const file = readdirSync(MIGRATIONS).find((name) => name.startsWith(`${version}_`));
  expect(file, `migration ${version} is missing`).toBeDefined();
  return file as string;
};
const migration = (version: string): string =>
  readFileSync(`${MIGRATIONS}/${migrationFile(version)}`, 'utf8');
/** SQL with whole-line comments removed, so prose cannot satisfy a pin. */
const code = (sql: string): string =>
  sql
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
/** The body of one CREATE [OR REPLACE] FUNCTION, up to its closing tag. */
const functionBody = (sql: string, name: string): string => {
  const start = sql.indexOf(`FUNCTION ${name}(`);
  expect(start, `${name} is not defined in this migration`).toBeGreaterThan(-1);
  const rest = sql.slice(start);
  const open = rest.match(/AS (\$[A-Za-z_]*\$)/);
  expect(open, `${name} has no dollar-quoted body`).not.toBeNull();
  const from = open!.index! + open![0].length;
  const end = rest.indexOf(open![1], from);
  expect(end, `${name} body is not closed`).toBeGreaterThan(from);
  return rest.slice(from, end);
};

const WALLET = '20261109231325';
const CASCADE = '20261109231855';
const FUNDER = 'smarter_private.weekly_payout_fund_agent_shortfalls';
const WORKFLOW = '.github/workflows/weekly-refusal-cover.yml';
const HARNESSES = [
  'scripts/ci/test-rakeback-cascade-funding-plan-postgres.py',
  'scripts/ci/test-owner-routing-wallet-postgres.py',
  'scripts/ci/test-rakeback-cascade-funding-postgres.py',
  'scripts/ci/test-rakeback-cascade-real-guards-postgres.py',
  'scripts/ci/test-rakeback-cascade-real-runner-postgres.py',
];

describe('a superseded certificate never funds', () => {
  const sql = migration(CASCADE);
  const funder = code(functionBody(sql, FUNDER));

  it('reads one certificate per pending period, the one with the highest id', () => {
    const reads = funder.match(
      /accounting_rakeback_period_calculations\s+c\s+ON\s+c\.period_id\s*=\s*rp\.id/g
    );
    expect(reads, 'the funder joins a period to its certificates exactly once').toHaveLength(1);
    expect(funder).toMatch(
      /SELECT\s+DISTINCT\s+ON\s*\(\s*rp\.id\s*\)[\s\S]{0,400}?ORDER\s+BY\s+rp\.id\s*,\s*c\.id\s+DESC/
    );
    // Any other read of the certificate table goes by the chosen certificate id.
    const others =
      funder.match(
        /accounting_rakeback_period_calculations\s+(\w+)\s+ON\s+(?!c\.period_id)[^\n]*/g
      ) || [];
    for (const read of others) expect(read).toMatch(/ON\s+\w+\.id\s*=\s*\w+\.calc_id/);
  });

  it('plans from the agreement, not from a wallet balance, and is not a repair path', () => {
    // The old body topped a short wallet up through the cashier door.
    expect(funder).not.toMatch(/fn_club_bank_send\s*\(/);
    expect(funder).toContain('rakeback_cascade_club_cannot_afford_week');
    expect(code(sql)).not.toMatch(/cron\.(schedule|alter_job)/);
    expect(code(sql)).not.toMatch(/is_horse/);
  });

  it('replaces only the installed body it was written against and needs the wallet first', () => {
    expect(sql).not.toMatch(/^-- @install-window:/m);
    expect(code(sql)).toMatch(
      /md5\(pg_get_functiondef\('smarter_private\.weekly_payout_fund_agent_shortfalls\([^']+'::regprocedure\)\)\s+IS DISTINCT FROM\s+'018a0fcbad1fabcf1b5427b9fa454028'/
    );
    expect(code(sql)).toMatch(
      /to_regprocedure\('smarter_private\.ensure_owner_routing_wallet\(uuid\)'\)\s+IS NULL\s+THEN\s+RAISE EXCEPTION\s+'rakeback_cascade_requires_owner_routing_wallet'/
    );
  });
});

describe('a deleted upline is routed around, never funded', () => {
  const funder = code(functionBody(migration(CASCADE), FUNDER));

  it('drops a deleted upline from the path and keeps a deleted direct payer', () => {
    // zzzz_deleted_agent_credit returns a credit to a deleted account's agent
    // wallet to the club bank, so chips sent through one never reach the next
    // hop. The path skips it; depth 0 (the payer itself) is never skipped.
    expect(funder).toMatch(
      /INSERT INTO pg_temp\._rcf_skipped SELECT DISTINCT c\.club_id,c\.user_id FROM pg_temp\._rcf_chain c JOIN public\.profiles p ON p\.id=c\.user_id AND p\.status='deleted' WHERE c\.depth>0;/
    );
    expect(funder).toMatch(
      /DELETE FROM pg_temp\._rcf_chain c USING pg_temp\._rcf_skipped s WHERE s\.club_id=c\.club_id AND s\.user_id=c\.user_id AND c\.depth>0;/
    );
    // The stop it replaces refused the whole scope for one deleted account.
    expect(funder).not.toContain('rakeback_cascade_upline_account_deleted');
  });

  it('refuses the one shape it cannot route before the path is changed', () => {
    const refusal = funder.indexOf('rakeback_cascade_upline_deleted_after_funding');
    const skip = funder.indexOf('DELETE FROM pg_temp._rcf_chain c USING pg_temp._rcf_skipped');
    expect(refusal).toBeGreaterThan(-1);
    expect(skip).toBeGreaterThan(refusal);
  });

  it('keeps the cases that execute it under the production guards', () => {
    const cases = readFileSync('scripts/ci/fixtures/rakeback-cascade-real-guards/cases.py', 'utf8');
    for (const name of [
      'd-1. deleted direct payer',
      'd-2. deleted upline in the middle of the chain',
      'd-3. two consecutive deleted uplines',
      'd-4. deleted top-level upline',
      'd-5. an upline deleted AFTER it passed',
    ])
      expect(cases).toContain(name);
  });
});

describe('the wallet is installed before the cascade that needs it', () => {
  const files = [migrationFile(CASCADE), migrationFile(WALLET)];
  const sqlOf = (file: string): string => readFileSync(`${MIGRATIONS}/${file}`, 'utf8');

  it('installs at merge, before the cascade, under a one second lock timeout', () => {
    // Neither file waits for the daily window: public.agents is not a named
    // hot table, and the cascade locks no table. The merge dispatcher sends
    // files in version order, and the cascade refuses until this file's
    // routing-wallet door exists.
    expect(WALLET < CASCADE).toBe(true);
    for (const file of files) {
      expect(sqlOf(file)).not.toMatch(/^-- @install-window:/m);
      expect(windowLocks(sqlOf(file))).toEqual([]);
    }
    expect(sqlOf(migrationFile(WALLET))).toMatch(/SET LOCAL lock_timeout = '1s';/);
  });

  it('still has its table lock read from the SQL, and the cascade takes none', () => {
    expect(lockTargets(sqlOf(migrationFile(WALLET)))).toEqual([
      { relation: 'public.agents', mode: 'AccessExclusiveLock' },
    ]);
    expect(lockTargets(sqlOf(migrationFile(CASCADE)))).toEqual([]);
  });
});

describe('an owner routing wallet never earns', () => {
  const sql = migration(WALLET);
  const body = code(sql);

  it('holds every rate of a wallet_only row at zero by constraint', () => {
    const check = body.match(
      /ADD CONSTRAINT agents_wallet_only_earns_nothing\s+CHECK\s*\(([\s\S]*?)\);/
    );
    expect(check, 'agents_wallet_only_earns_nothing is not declared').not.toBeNull();
    for (const term of [
      "status <> 'wallet_only'",
      'commission_rate = 0',
      'player_rakeback_rate = 0',
      'parent_agent_id IS NULL',
      'credit_limit = 0',
    ])
      expect(check![1]).toContain(term);
  });

  it('never turns an agreement into a wallet, and only the owner holds one', () => {
    const guard = code(functionBody(sql, 'public.fn_guard_owner_routing_wallet'));
    expect(guard).toContain('owner_routing_wallet_owner_only');
    expect(guard).toContain('owner_routing_wallet_never_replaces_an_agreement');
    expect(guard).toContain('agent_activation_requires_an_agreement');
    expect(body).toMatch(
      /CREATE TRIGGER zz_owner_routing_wallet_guard\s+BEFORE INSERT OR UPDATE OF status ON public\.agents/
    );
  });

  it('creates the wallet with no entitlement and leaves an existing row alone', () => {
    const ensure = code(functionBody(sql, 'smarter_private.ensure_owner_routing_wallet'));
    expect(ensure).toMatch(/'wallet_only',\s*0,\s*0,\s*0,\s*0,\s*0,\s*0,\s*true\)/);
    expect(ensure).not.toMatch(/\bUPDATE\s+public\.agents\b/);
    expect(ensure).not.toContain('fn_ensure_agent_row');
    expect(body).toMatch(
      /REVOKE ALL ON FUNCTION smarter_private\.ensure_owner_routing_wallet\(uuid\) FROM PUBLIC, anon, authenticated, service_role/
    );
  });

  it('is not listed or counted as an agent by the server readers a client mirrors', () => {
    // Each is replaced only from the installed body it was written against.
    for (const [name, preimage, exclusion] of [
      [
        'public.fn_ca_agent_payables',
        '5b86542b4686a504209767ac9a70e1e8',
        "AND coalesce(a.status, 'active') <> 'wallet_only'",
      ],
      [
        'public.get_club_agents',
        '7c4fc71f953f809d1d4e40780c747ac0',
        "AND COALESCE(a.status, 'active') <> 'wallet_only'",
      ],
      [
        'public.fn_club_opening_checklist_complete',
        '0e51fff026d1e37b1c143bbfb1fe021f',
        "AND lower(COALESCE(a.status,'active'))<>'wallet_only'",
      ],
    ]) {
      expect(code(functionBody(sql, name)), name).toContain(exclusion);
      expect(body).toContain(
        `md5(pg_get_functiondef('${name}(uuid)'::regprocedure))\n       IS DISTINCT FROM '${preimage}'`
      );
    }
    // The Payouts tab counts what it lists: both come from the one filtered read.
    const payables = code(functionBody(sql, 'public.fn_ca_agent_payables'));
    expect(payables.match(/FROM agents a\b/g)).toHaveLength(1);
    expect(payables).toMatch(/count\(\*\)::integer,[\s\S]*FROM ranked r;/);
    const wallet = readFileSync(HARNESSES[1], 'utf8');
    for (const name of [
      'the-payouts-tab-and-the-agent-list-leave-the-wallet-out-row-and-count',
      'clubs-with-no-wallet-only-row-answer-exactly-as-before',
      'a-wallet-does-not-finish-the-first-agent-opening-step',
    ])
      expect(wallet).toContain(name);
  });

  it('is not listed or counted as an agent by the client roster', () => {
    const service = readFileSync('src/services/AgentService.ts', 'utf8');
    expect(service).toContain("data.filter((row) => row?.status !== 'wallet_only')");
    // The strict parser still refuses any status nobody defined.
    expect(service).toContain("return malformedAgentPayload('agent.status');");
  });
});

describe('the required weekly check executes both proofs on PostgreSQL 17', () => {
  const workflow = parse(readFileSync(WORKFLOW, 'utf8'));
  const steps: { id?: string; if?: string; run?: string; env?: Record<string, string> }[] =
    workflow.jobs['weekly-refusal-cover'].steps;

  it('names every cascade harness in the job the ruleset requires', () => {
    expect(workflow.jobs['weekly-refusal-cover'].name).toBe('Weekly refusal receipt cover');
    for (const harness of HARNESSES) {
      const step = steps.find((candidate) => candidate.run?.includes(`python3 -B ${harness} `));
      expect(step, `${harness} is not run by ${WORKFLOW}`).toBeDefined();
      // Named directly and never guarded by a file test: a missing harness is
      // a red required check, not a skipped step. A harness that exits 0
      // without its verdict line (it ran nothing) is refused too.
      expect(step!.run).toContain('set -o pipefail');
      expect(step!.run).toContain(
        `python3 -B ${harness} --pg-bin "$PG_BIN" --scratch "\${{ runner.temp }}" | tee "$VERDICT_LOG"`
      );
      expect(step!.run).toContain('tail -n 1 "$VERDICT_LOG" | python3 -c');
      expect(step!.run).toContain('v.get("status")=="passed"');
      expect(step!.run).toContain('v["cases"]>0');
      expect(step!.run).not.toMatch(/\|\|\s*true|\[\s*-[ef]\s/);
      expect(step!.if).toBe("steps.relevant.outputs.run == 'true'");
    }
  });

  it('runs them whenever a migration, a harness or a fixture changes', () => {
    const relevant = steps.find((step) => step.id === 'relevant');
    const paths = relevant!.env!.WEEKLY_COVER_PATHS.split('\n');
    for (const path of [
      'supabase/migrations/**',
      ...HARNESSES,
      'scripts/ci/fixtures/rakeback-cascade*/**',
      'scripts/ci/fixtures/owner-routing-wallet/**',
      'tests/superseded-certificates-never-fund.law.test.ts',
    ])
      expect(paths, `${path} does not start the proofs`).toContain(path);
  });

  it('keeps the cases that reproduce each cause', () => {
    for (const harness of HARNESSES) expect(existsSync(harness), harness).toBe(true);
    expect(readFileSync(HARNESSES[2], 'utf8')).toContain(
      'superseded-certificates-never-contribute-D5'
    );
    const wallet = readFileSync(HARNESSES[1], 'utf8');
    for (const name of [
      'preimage-ensure-agent-row-mints-an-earning-agreement',
      'a-wallet-only-row-cannot-be-created-with-a-rate',
      'commission-rate-cannot-be-raised-while-wallet-only',
    ])
      expect(wallet).toContain(name);
  });
});
