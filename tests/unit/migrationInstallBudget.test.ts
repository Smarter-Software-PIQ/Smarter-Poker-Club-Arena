/**
 * AN OFFLINE MIGRATION MAY DECLARE A LONGER INSTALL BUDGET (2026-11-07).
 * See scripts/ci/migration-install-budget.mjs. Owner instruction 2026-11-07
 * 21:14 CT: change the 12 s limit that refused 20261108011659 three times,
 * safely - live play and money keep exactly 12 s.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// @ts-expect-error plain ESM helper shared with the installer
import * as budget from '../../scripts/ci/migration-install-budget.mjs';
// @ts-expect-error plain ESM helper shared with the installer
import { assertOrdinaryMigrationBudget } from '../../scripts/ci/migration-session-identity.mjs';

const {
  ordinaryMigrationBudgetMs,
  declaredInstallBudgetSeconds,
  installTouches,
  offlineScopeCheckSQL,
  DEFAULT_INSTALL_BUDGET_MS,
  INSTALL_BUDGET_CAP_SECONDS,
} = budget;

const ROOT = resolve(__dirname, '../..');
const DIR = join(ROOT, 'supabase/migrations');
const FILE = '20261108120000_fixture_offline_certification.sql';

const offline = (
  body: string,
  head = '-- @install-budget-seconds: 45',
  lock = "SET LOCAL lock_timeout = '2s';"
) =>
  `-- fixture\n${head}\nBEGIN;\n${lock}\nSET LOCAL statement_timeout = '60s';\n${body}\nCOMMIT;\n`;

const ADMITTED_BODY = `
CREATE OR REPLACE FUNCTION public.fn_gto_v31_fixture(p integer) RETURNS integer
 LANGUAGE plpgsql AS $function$
BEGIN
  INSERT INTO public.gto_v31_fixture_rows(id) VALUES (p);
  UPDATE public.solver_fixture_jobs j SET state = 'done' WHERE j.id = p;
  RETURN p;
END $function$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_fixture(integer) FROM PUBLIC, anon, authenticated;
DO $check$ BEGIN
  PERFORM public.fn_gto_v31_fixture(1);
  DELETE FROM public.gto_v31_fixture_rows WHERE id = 1;
END $check$;
ALTER TABLE public.gto_v31_fixture_rows DROP CONSTRAINT c, ADD CONSTRAINT c CHECK (id > 0) NOT VALID;
ALTER TABLE public.gto_v31_fixture_rows VALIDATE CONSTRAINT c;
CREATE INDEX IF NOT EXISTS gto_v31_fixture_rows_id ON public.gto_v31_fixture_rows (id);
COMMENT ON TABLE public.solver_fixture_jobs IS 'offline';
GRANT SELECT ON TABLE public.gto_v31_fixture_rows TO service_role;
SELECT 1 FROM public.club_members LIMIT 1; -- a plain read of a live table takes ACCESS SHARE only
`;

describe('a declared install budget is admitted only for offline migrations', () => {
  it('admits a file that touches only offline relations and functions, with lock_timeout <= 2 s', () => {
    const sql = offline(ADMITTED_BODY);
    expect(ordinaryMigrationBudgetMs(FILE, sql)).toBe(45_000);
    expect(() => assertOrdinaryMigrationBudget(sql, 45_000)).not.toThrow();
    expect(installTouches(sql).relations).toEqual([
      'public.gto_v31_fixture_rows',
      'public.solver_fixture_jobs',
    ]);
  });

  it('admits the hard cap itself', () => {
    const sql = offline(ADMITTED_BODY, `-- @install-budget-seconds: ${INSTALL_BUDGET_CAP_SECONDS}`);
    expect(ordinaryMigrationBudgetMs(FILE, sql)).toBe(INSTALL_BUDGET_CAP_SECONDS * 1000);
  });

  it.each([
    [
      'a live table written at top level',
      "UPDATE public.club_members SET role = 'x' WHERE id = 1;",
      /public\.club_members/,
    ],
    [
      'a live table written inside a DO block',
      'DO $x$ BEGIN DELETE FROM public.chip_ledger WHERE id = 0; END $x$;',
      /public\.chip_ledger/,
    ],
    [
      'a live table written inside a function body',
      'CREATE FUNCTION public.fn_gto_v31_pay() RETURNS void LANGUAGE sql AS $f$ INSERT INTO public.payouts(id) VALUES (1) $f$;',
      /public\.payouts/,
    ],
    [
      'a live table altered',
      'ALTER TABLE public.tournament_payouts VALIDATE CONSTRAINT c;',
      /public\.tournament_payouts/,
    ],
    ['a live table locked', 'LOCK TABLE public.table_seats IN SHARE MODE;', /public\.table_seats/],
    [
      'a foreign key to a live table',
      'ALTER TABLE public.gto_v31_x ADD CONSTRAINT f FOREIGN KEY (u) REFERENCES public.profiles(id);',
      /public\.profiles/,
    ],
    [
      'a trigger on a live table',
      'CREATE TRIGGER t AFTER INSERT ON public.hand_history FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_t();',
      /public\.hand_history/,
    ],
    ['an unqualified live table', 'INSERT INTO clubs(id) VALUES (1);', /public\.clubs/],
    [
      'an offline-looking name in another schema',
      'INSERT INTO smarter_private.gto_v31_x(id) VALUES (1);',
      /smarter_private\.gto_v31_x/,
    ],
    [
      'a second table in a TRUNCATE list',
      'TRUNCATE public.gto_v31_a, public.chip_ledger;',
      /public\.chip_ledger/,
    ],
    [
      'a live function replaced',
      'CREATE OR REPLACE FUNCTION public.fn_settle_payout() RETURNS void LANGUAGE sql AS $f$ SELECT $f$;',
      /function public\.fn_settle_payout/,
    ],
    [
      'a live function granted',
      'GRANT EXECUTE ON FUNCTION public.fn_gto_v31_a(integer), public.fn_cash_out(uuid) TO service_role;',
      /function public\.fn_cash_out/,
    ],
    [
      'row locks',
      'DO $x$ BEGIN PERFORM 1 FROM public.gto_v31_a FOR UPDATE; END $x$;',
      /FOR UPDATE/,
    ],
    ['DROP ... CASCADE', 'DROP TABLE public.gto_v31_a CASCADE;', /CASCADE/],
  ])('refuses %s', (_name, body, reason) => {
    expect(() => ordinaryMigrationBudgetMs(FILE, offline(ADMITTED_BODY + body))).toThrow(reason);
  });

  it('refuses a budget over the hard cap', () => {
    const sql = offline(
      ADMITTED_BODY,
      `-- @install-budget-seconds: ${INSTALL_BUDGET_CAP_SECONDS + 1}`
    );
    expect(() => ordinaryMigrationBudgetMs(FILE, sql)).toThrow(/exceeds the hard cap of 60 s/);
  });

  it.each([
    ['no lock_timeout at all', ''],
    ['a lock_timeout over 2 s', "SET LOCAL lock_timeout = '3s';"],
    ['lock_timeout disabled', 'SET LOCAL lock_timeout = 0;'],
    ['lock_timeout set only after other work', "SELECT 1;\nSET LOCAL lock_timeout = '1s';"],
  ])('refuses %s', (_name, lock) => {
    expect(() => ordinaryMigrationBudgetMs(FILE, offline(ADMITTED_BODY, undefined, lock))).toThrow(
      /lock_timeout/
    );
  });

  it.each([
    ["SET lock_timeout = '1s';", /only be SET LOCAL/],
    ["DO $x$ BEGIN SET LOCAL lock_timeout = '30s'; END $x$;", /not within/],
    ['RESET lock_timeout;', /resets/],
    ["SELECT set_config('lock_timeout', '0', true);", /resets or set_config/],
  ])('refuses a file that later raises or removes its lock_timeout: %s', (body, reason) => {
    expect(() => ordinaryMigrationBudgetMs(FILE, offline(ADMITTED_BODY + body))).toThrow(reason);
  });

  it.each([
    ['-- @install-budget-seconds: 30s', /malformed/],
    ['-- @install-budget-seconds: forty', /malformed/],
    ['-- @install-budget-seconds:', /malformed/],
    ['-- @install-budget-seconds 30', /malformed/],
    ['-- @install-budget-seconds: 12', /not above the ordinary 12 s/],
    ['-- @install-budget-seconds: 30\n-- @install-budget-seconds: 30', /more than once/],
  ])('refuses a malformed declaration: %s', (head, reason) => {
    expect(() => ordinaryMigrationBudgetMs(FILE, offline(ADMITTED_BODY, head))).toThrow(reason);
    expect(() =>
      assertOrdinaryMigrationBudget(offline(ADMITTED_BODY, head), DEFAULT_INSTALL_BUDGET_MS)
    ).toThrow();
  });

  it('refuses a declaration on a file older than the stale-pin snapshot the runtime check reads', () => {
    expect(() =>
      ordinaryMigrationBudgetMs('20261107120000_old.sql', offline(ADMITTED_BODY))
    ).toThrow(/needs a file from 20261108000000 on/);
  });
});

describe('an undeclared migration keeps exactly 12 s', () => {
  it('returns exactly the ordinary budget, whatever the file touches', () => {
    expect(DEFAULT_INSTALL_BUDGET_MS).toBe(12_000);
    for (const body of [ADMITTED_BODY, "UPDATE public.club_members SET role = 'x' WHERE id = 1;"]) {
      const sql = offline(body, '-- no declaration');
      expect(declaredInstallBudgetSeconds(sql)).toBeNull();
      expect(ordinaryMigrationBudgetMs(FILE, sql)).toBe(12_000);
      expect(() => assertOrdinaryMigrationBudget(sql, 12_000)).not.toThrow();
    }
  });

  it('assertOrdinaryMigrationBudget refuses a larger cap for an undeclared file, and a mismatched one for a declared file', () => {
    expect(() => assertOrdinaryMigrationBudget('BEGIN;\nSELECT 1;\nCOMMIT;', 45_000)).toThrow(
      /12000 ms/
    );
    expect(() => assertOrdinaryMigrationBudget(offline(ADMITTED_BODY), 12_000)).toThrow(/declared/);
    expect(() => assertOrdinaryMigrationBudget(offline(ADMITTED_BODY), 60_000)).toThrow(/declared/);
  });

  it('a declared file still cannot SET its own transaction_timeout past its admitted budget', () => {
    const sql = offline(ADMITTED_BODY + "SET LOCAL transaction_timeout = '50s';");
    expect(() => assertOrdinaryMigrationBudget(sql, 45_000)).toThrow(/budget/);
  });
});

describe('the installer binds the admitted budget and re-checks what the transaction holds', () => {
  const door = readFileSync(join(ROOT, 'scripts/ci/apply-recorded-migration.mjs'), 'utf8');
  it('binds the admitted budget on both the session and the owning transaction', () => {
    expect(door).toContain('ordinaryBudgetMs = ordinaryMigrationBudgetMs(file, sql);');
    expect(door).toContain('assertOrdinaryMigrationBudget(sql, ordinaryBudgetMs);');
    expect(door).toContain('ordinaryTransaction ? ordinaryBudgetMs : null');
    expect(door).toContain("`SET transaction_timeout = '${ordinaryBudgetMs}ms'`");
  });
  it('splices the runtime scope check, before the history row, only for a declared file', () => {
    expect(door).toContain(
      "(declaredBudget ? offlineScopeCheckSQL() : '') +\n    historyStatement +"
    );
    expect(door).toContain('only an ordinary install honours');
    const check = offlineScopeCheckSQL();
    expect(check).toContain("l.mode <> 'AccessShareLock'");
    expect(check).toContain("LIKE ANY (ARRAY['gto\\_v31\\_%','solver\\_%']::text[])");
    expect(check).toContain("current_setting('ca.stale_pin_before')");
    expect(check).toContain('fn\\_gto\\_v31\\_%');
  });
  it('every committed migration that declares a budget is admitted at merge time', () => {
    for (const f of readdirSync(DIR).filter((x) => x.endsWith('.sql'))) {
      const sql = readFileSync(join(DIR, f), 'utf8');
      if (declaredInstallBudgetSeconds(sql) === null) continue;
      expect(() => ordinaryMigrationBudgetMs(f, sql), f).not.toThrow();
    }
  });
});
