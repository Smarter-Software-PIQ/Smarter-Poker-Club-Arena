/**
 * The incident's four files and two synthetic ones, rebuilt from this tree, for
 * the DDL-guard proofs (tests/unit/aMigrationPassesProductionsDdlGuardsBeforeMerge.pg.test.ts
 * on native PostgreSQL, and .github/workflows/ddl-guards-self-test.yml on a copy
 * of production's real schema). Each case names the outcome production's
 * guards gave, or would give, the file.
 *
 *   rake-original   #11256's merged 20261118034950 (md5 64b1b59e): refused,
 *                   applier stale-pin guard (55000)
 *   rake-relanded   #11270's file, the pin declared: passes
 *   bank-original   #11266's merged 20261118071728 (md5 d85aab85): refused,
 *                   fn_ca_money_rpc_registry_guard (42501)
 *   bank-fixed      #11288's head (md5 05761e57): passes
 *   money-unregistered / money-registered
 *                   a new function that writes club_wallets.chip_balance, without
 *                   and with its registry row: refused / passes. A brand-new
 *                   function installs on today's production schema, so these two
 *                   exercise the exact half there.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RAKE =
  '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall.sql';
export const BANK =
  '20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on.sql';
export const MONEY = '20991231235958_ddl_guard_self_test_money_rpc.sql';

/** #11288's change, byte for byte: the registry row above the CREATE FUNCTION. */
export const BANK_FIX_BLOCK =
  "-- A function that can move money is registered before it exists\n-- (fn_ca_money_rpc_registry_guard). Production refused this file without it\n-- on 2026-11-18 13:30 UTC (42501); nothing installed.\nINSERT INTO public.ca_money_rpc_registry (proname, status, notes) VALUES\n  ('fn_ca_bank_pending_hand_obligations', 'approved',\n   'Incident 075013fd: banks a hand''s stored BBJ drop and insurance legs (hand_bank_obligation_pending) through the same bbj_record_contribution / record_insurance_transaction calls the envelope used to make, argument for argument. Engine-only (fn_caller_is_engine). Never waits on a shared row: try-lock on the union pool key and insurance-bank key, pool and wallet rows NOWAIT, 250 ms budget. Journaled by the callees; the pending row is deleted in the same transaction and the felt tally (zy_ca_tally_balance_move / zz_ca_balance_has_its_ledger_row) proves the movement. Inserts a bbj_pools row only where the envelope would have.');\n\n";
const CREATE_BANKER = 'CREATE FUNCTION public.fn_ca_bank_pending_hand_obligations(';

const MONEY_FN = `CREATE FUNCTION public.fn_ca_ddl_guard_self_test_pay(p_club uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  UPDATE public.club_wallets SET chip_balance = chip_balance WHERE club_id = p_club;
END $fn$;
`;

export function cases(root) {
  const mig = (n) => readFileSync(join(root, 'supabase/migrations', n), 'utf8');
  const rake = mig(RAKE);
  const bankOnMain = mig(BANK);
  const bankOriginal = bankOnMain.replace(BANK_FIX_BLOCK, '');
  return {
    'rake-original': {
      file: RAKE,
      sql: rake.replace(/-- STALE PIN, DECLARED[\s\S]*?\n-- @stale-pin-ok:[^\n]*\n\n/, ''),
      md5: '64b1b59e893ec26624c77bed021d4d52',
      refused: 'applier stale-pin guard',
    },
    'rake-relanded': { file: RAKE, sql: rake, refused: null },
    'bank-original': {
      file: BANK,
      sql: bankOriginal,
      md5: 'd85aab854b945f9095a26b4f9793db48',
      refused: 'fn_ca_money_rpc_registry_guard',
    },
    'bank-fixed': {
      file: BANK,
      sql: bankOnMain.includes(BANK_FIX_BLOCK)
        ? bankOnMain
        : bankOriginal.replace(CREATE_BANKER, BANK_FIX_BLOCK + CREATE_BANKER),
      md5: '05761e575e41920cc7de82e07fc4e4ba',
      refused: null,
    },
    'money-unregistered': {
      file: MONEY,
      sql: `BEGIN;\n${MONEY_FN}COMMIT;\n`,
      refused: 'fn_ca_money_rpc_registry_guard',
    },
    'money-registered': {
      file: MONEY,
      sql: `BEGIN;\nINSERT INTO public.ca_money_rpc_registry (proname, status, notes) VALUES ('fn_ca_ddl_guard_self_test_pay', 'approved', 'self-test');\n${MONEY_FN}COMMIT;\n`,
      refused: null,
    },
  };
}

// CLI: node scripts/ci/ddl-guard-cases.mjs <case> <out-dir>  -> writes the file, prints its name and expectation
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [name, out] = process.argv.slice(2);
  const c = cases(process.cwd())[name];
  if (!c || !out) {
    console.error(
      `usage: ddl-guard-cases.mjs <${Object.keys(cases(process.cwd())).join('|')}> <out-dir>`
    );
    process.exit(2);
  }
  writeFileSync(join(out, c.file), c.sql);
  process.stdout.write(`${c.file}\t${c.refused ?? ''}\n`);
}
