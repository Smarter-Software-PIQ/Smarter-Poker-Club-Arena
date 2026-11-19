import { createHash } from 'node:crypto';
import {
  declaredInstallBudgetSeconds,
  DEFAULT_INSTALL_BUDGET_MS,
} from './migration-install-budget.mjs';

// The applier's atomic history row (apply-recorded-migration.mjs,
// historyStatement): version, name and the exact source bytes between the
// reserved $ca_file_history_<version>$ delimiters, which the applier refuses
// inside a source file.
const HISTORY_ROW =
  /INSERT INTO supabase_migrations\.schema_migrations\(version,name,statements\)\s*VALUES \('([0-9A-Za-z_]+)','([A-Za-z0-9_.-]+)',ARRAY\[(\$ca_file_history_\1\$)([\s\S]*?)\3::text\]\);/g;

/**
 * The live-table guard's applier claim (migration 20261119053515, incident
 * 075013fd): the first thing the owning transaction does is claim the exact
 * history it will record. The database binds the claim to this backend and
 * this transaction, refuses it for a migration already recorded, and refuses
 * the COMMIT unless that history row was written with these bytes. Before the
 * claim function exists (the guard's own install, and fixtures without it)
 * the block does nothing. A transaction without exactly one history row is
 * not a migration install and gets no claim.
 */
export function applierClaimSQL(sql) {
  const rows = [...String(sql).matchAll(HISTORY_ROW)];
  if (rows.length !== 1) return '';
  const [, version, name, , bytes] = rows[0];
  const md5 = createHash('md5').update(bytes, 'utf8').digest('hex');
  return (
    '\nDO $ca_applier_claim$ BEGIN' +
    " IF to_regprocedure('smarter_private.fn_ca_migration_applier_claim(text,text,text)') IS NOT NULL THEN" +
    ` PERFORM smarter_private.fn_ca_migration_applier_claim('${version}', '${name}', '${md5}');` +
    ' END IF; END $ca_applier_claim$;'
  );
}

// Supavisor can replace startup application_name. Bind the existing installer
// identity on the backend that owns this transaction, without changing source
// bytes recorded in migration history or exempting any other session.
export function bindMigrationSession(sql, transactionBudgetMs = null) {
  if (
    transactionBudgetMs !== null &&
    (!Number.isSafeInteger(transactionBudgetMs) || transactionBudgetMs <= 0)
  )
    throw new Error('Invalid migration transaction budget');
  if (String(sql).includes('$ca_applier_claim$'))
    throw new Error('migration conflicts with the reserved applier-claim delimiter');
  const claim = applierClaimSQL(sql);
  const bound = sql.replace(
    /^([ \t]*BEGIN[ \t]*;)/im,
    (begin) =>
      begin +
      "\nSET LOCAL application_name = 'apply-recorded-migration';" +
      (transactionBudgetMs === null
        ? ''
        : `\nSET LOCAL transaction_timeout = '${transactionBudgetMs}ms';`) +
      claim
  );
  if (bound === sql) throw new Error('Migration transaction has no initial BEGIN statement');
  return bound;
}

// The original installer owns the whole transaction budget. A migration may
// shorten it, but must not silently turn it off or extend it during live play.
// capMs is the budget the installer binds: exactly DEFAULT_INSTALL_BUDGET_MS
// (12 s), or the declared budget of a file ordinaryMigrationBudgetMs admitted
// (migration-install-budget.mjs). Any other pairing is refused, so a larger cap
// can never reach a file that did not declare it and pass the offline check.
export function assertOrdinaryMigrationBudget(sql, capMs) {
  const declared = declaredInstallBudgetSeconds(sql);
  if (declared === null ? capMs !== DEFAULT_INSTALL_BUDGET_MS : capMs !== declared * 1000)
    throw new Error(
      declared === null
        ? `ordinary migration budget must be the installer's ${DEFAULT_INSTALL_BUDGET_MS} ms unless the file declares an admitted install budget`
        : `ordinary migration budget ${capMs} ms is not the file's admitted declared install budget`
    );
  const code = String(sql)
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (
    /\bRESET\s+(?:ALL|transaction_timeout)\b/i.test(code) ||
    /\bset_config\s*\(\s*'transaction_timeout'/i.test(code)
  )
    throw new Error('ordinary migration must preserve the installer transaction budget');
  for (const match of code.matchAll(
    /\bSET\s+(?:(?:LOCAL|SESSION)\s+)?transaction_timeout\s*(?:=|TO)\s*([^;]+);/gi
  )) {
    const value = /^\s*'?\s*(\d+(?:\.\d+)?)\s*(ms|s|min)?\s*'?\s*$/i.exec(match[1]);
    const ms = value
      ? Number(value[1]) * { ms: 1, s: 1000, min: 60000 }[(value[2] || 'ms').toLowerCase()]
      : NaN;
    if (!Number.isFinite(ms) || ms <= 0 || ms > capMs)
      throw new Error(
        'ordinary migration cannot disable or extend the installer transaction budget'
      );
  }
}
