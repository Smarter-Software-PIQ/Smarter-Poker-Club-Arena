/**
 * A SPIN'S PAYMENT PROOF NETS PRIOR PRE-START UNREGISTRATIONS
 * (2026-11-24, BINDING — incident 3c817b04-bc3a-4bc5-aa43-b2eee257584d)
 *
 * Pre-start Spin unregistration (fn_ca_unregister_tournament_player_exact,
 * start_authority = 'spin_actual_start') deletes the tournament_players row,
 * vacates the seat, consumes the tournament_refund_entitlements row via
 * tournament_refund_tranches, and appends a matching 'refund'/'tournament_refund'
 * credit to wallet_transactions. The original 'tournament_buyin' debit row
 * stays forever in the append-only wallet_transactions ledger.
 *
 * On 2026-11-24 two live Spin boards were permanently bricked at 2/3 seats
 * until unfilled expiry cancelled them past the 8400 s ladder envelope,
 * firing critical SpinFleetProducingNothing twice (events 448694 & 448704):
 *   - 3b4c6299 ("5 Chip Deep Stack Spin NLH"): 131 refusals with paid_users=2,
 *     buyin_debits=4 (player unregistered and re-entered), then 45 refusals
 *     with paid_users=3, buyin_debits=5 after a second unregister;
 *   - 935e11b9: 30 refusals with paid_users=3, buyin_debits=4 (and two
 *     spin_seat_first_fill runbook attempts that recorded door_refused with
 *     SQLERRM dropped).
 *
 * Four Spin payment proofs shared the same raw-debit / unrefunded-entry defect
 * and the spin_seat_first_fill runbook dropped SQLERRM on door_refused. This
 * law pins every one of the five fixes against regression across all future
 * migrations, validates the migration's probe/budget/transaction shape, and
 * keeps the native PostgreSQL 17 proof script in place.
 *
 * Registry: docs/laws.d/tests-a-spin-payment-proof-nets-prior-refunds.md
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationCorpus, migrationNames, migrationText } from './helpers/migrationCorpus';
import { migrationTransactionShape } from '../scripts/ci/migration-transaction-shape.mjs';
import { migrationCostRisks } from '../scripts/ci/migration-cost-shape.mjs';
import { missingProbes } from '../scripts/ci/migration-function-probes.mjs';

const ROOT = resolve(__dirname, '..');
const FIX_SUFFIX = '_a_spin_payment_proof_nets_prior_pre_start_unregistrations.sql';

function findFixMigration(): { name: string; sql: string } {
  const name = migrationNames()
    .filter((n) => n.endsWith(FIX_SUFFIX))
    .at(-1);
  if (!name) throw new Error(`missing migration ending in ${FIX_SUFFIX}`);
  return { name, sql: migrationText(name) };
}

/**
 * Resolve the latest effective SQL body of a function from the migration
 * corpus, accounting for both full CREATE [OR REPLACE] FUNCTION declarations
 * and anchored DO-block rewrites (`EXECUTE replace(pg_get_functiondef(...))`).
 */
function effectiveMigrationBlock(
  fnQualified: string,
  sinceVersion: string
): { file: string; snippet: string } {
  const [schema, fn] = fnQualified.split('.');
  const createRe = new RegExp(
    String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+${schema}\.${fn}\s*\(`,
    'i'
  );
  const rewriteRe = new RegExp(
    String.raw`pg_get_functiondef\s*\(\s*'${schema}\.${fn}\([^']*\)'::regprocedure\s*\)`,
    'i'
  );
  let latest: { file: string; snippet: string } | null = null;
  for (const m of migrationCorpus()) {
    const ver = m.name.slice(0, 14);
    if (ver < sinceVersion) continue;
    if (!m.sql.includes(fn)) continue;
    if (createRe.test(m.sql) || (/\bEXECUTE\b/i.test(m.sql) && rewriteRe.test(m.sql))) {
      latest = { file: m.name, snippet: m.sql };
    }
  }
  if (!latest) throw new Error(`no migration >= ${sinceVersion} updates ${fnQualified}`);
  return latest;
}

describe("a Spin's payment proof nets prior pre-start unregistrations", () => {
  const fix = findFixMigration();
  const fixVersion = fix.name.slice(0, 14);

  it('installs as one valid transaction with probes for all five functions and no cost risks', () => {
    expect(migrationTransactionShape(fix.name, fix.sql).ok).toBe(true);
    expect(migrationCostRisks(fix.name, fix.sql)).toEqual([]);
    expect(missingProbes(fix.sql)).toEqual([]);
    expect(fix.sql).toMatch(/^-- @live-proof:/m);
    for (const target of [
      'public.fn_spin_book_entry',
      'public.fn_spin_draw_and_settle',
      'public.fn_prove_played_spin_launch_recovery',
      'public.fn_poker_diamond_prove_played_spin_launch_recovery',
      'smarter_private.reliability_runbook_spin_seat_first_fill',
    ]) {
      expect(fix.sql, target).toContain(`-- @probe-for: ${target}`);
    }
    expect(existsSync(resolve(ROOT, 'scripts/ci/test-spin-entry-net-paid-postgres.py'))).toBe(true);
  });

  it('fn_spin_book_entry and fn_spin_draw_and_settle net refunds and reject non-rostered net balances', () => {
    for (const fn of ['public.fn_spin_book_entry', 'public.fn_spin_draw_and_settle']) {
      const latest = effectiveMigrationBlock(fn, fixVersion);
      // Must net refund/tournament_refund credits against tournament_buyin debits
      expect(latest.snippet, `${fn} in ${latest.file}`).toContain(
        "IN ('refund','tournament_refund')"
      );
      expect(latest.snippet, `${fn} in ${latest.file}`).toContain('ELSE -w.amount END');
      // Must verify net entry count per rostered user (= 1)
      expect(latest.snippet, `${fn} in ${latest.file}`).toMatch(
        /count\(\*\)\s+FILTER\s*\(WHERE w\.type = 'debit' AND lower\(w\.category\) = 'tournament_buyin'\)\s*-\s*count\(\*\)\s+FILTER\s*\(WHERE w\.type = 'credit' AND lower\(w\.category\) IN \('refund','tournament_refund'\)\)\)\s*=\s*1/
      );
      // Must fail closed if any non-rostered user retains non-zero net amount or count
      expect(latest.snippet, `${fn} in ${latest.file}`).toMatch(
        /AND NOT EXISTS \(\s*SELECT 1 FROM public\.tournament_players tp[\s\S]*?HAVING round\(COALESCE\(sum\(CASE[\s\S]*?<> 0/
      );
    }
  });

  it('both chip and Diamond played-Spin recovery proofs exclude refunded pre-start entries', () => {
    const chip = effectiveMigrationBlock('public.fn_prove_played_spin_launch_recovery', fixVersion);
    expect(chip.snippet, chip.file).toContain('public.tournament_refund_tranches tr');
    expect(chip.snippet, chip.file).toContain('public.tournament_tickets tk');
    expect(chip.snippet, chip.file).toContain('payments_by_user AS (');
    expect(chip.snippet, chip.file).toContain("IN ('refund', 'tournament_refund')");

    const diamond = effectiveMigrationBlock(
      'public.fn_poker_diamond_prove_played_spin_launch_recovery',
      fixVersion
    );
    expect(diamond.snippet, diamond.file).toContain("AND rf.kind = 'refund'");
    // Only custodies that were released WITH a recorded refund row may be excluded
    expect(diamond.snippet, diamond.file).toMatch(
      /AND NOT \(\s*c\.state = 'released'\s*AND EXISTS \([\s\S]*?rf\.kind = 'refund'/
    );
  });

  it('reliability_runbook_spin_seat_first_fill preserves SQLERRM as last_error on door_refused', () => {
    const rb = effectiveMigrationBlock(
      'smarter_private.reliability_runbook_spin_seat_first_fill',
      fixVersion
    );
    expect(rb.snippet, rb.file).toContain("jsonb_build_object('last_error', v_res->>'error')");
  });

  it('no subsequent migration re-introduces raw un-netted Spin buyin debit counting', () => {
    const offenders: string[] = [];
    for (const m of migrationCorpus()) {
      const ver = m.name.slice(0, 14);
      if (ver <= fixVersion) continue;
      if (
        !/fn_spin_book_entry|fn_spin_draw_and_settle|fn_prove_played_spin_launch_recovery/.test(
          m.sql
        )
      ) {
        continue;
      }
      // Strip single-quoted v_old anchor strings? No: any new CREATE OR REPLACE FUNCTION
      // redefining one of these three must retain refund netting.
      if (
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(?:fn_spin_book_entry|fn_spin_draw_and_settle)\s*\(/i.test(
          m.sql
        ) &&
        !m.sql.includes('tournament_refund')
      ) {
        offenders.push(`${m.name}: redefines Spin entry/draw without netting tournament_refund`);
      }
      if (
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_prove_played_spin_launch_recovery\s*\(/i.test(
          m.sql
        ) &&
        !m.sql.includes('tournament_refund_tranches')
      ) {
        offenders.push(
          `${m.name}: redefines fn_prove_played_spin_launch_recovery without excluding tournament_refund_tranches`
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it('preserves strict ACLs on all five functions in post-install verification', () => {
    expect(fix.sql).toContain("has_function_privilege('anon', 'public.fn_spin_book_entry(uuid)'");
    expect(fix.sql).toContain(
      "has_function_privilege('service_role', 'public.fn_poker_diamond_prove_played_spin_launch_recovery(uuid)'"
    );
    expect(
      readFileSync(
        resolve(ROOT, 'docs/laws.d/tests-a-spin-payment-proof-nets-prior-refunds.md'),
        'utf8'
      )
    ).toContain('3c817b04-bc3a-4bc5-aa43-b2eee257584d');
  });
});
