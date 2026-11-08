import {
  declaredInstallBudgetSeconds,
  DEFAULT_INSTALL_BUDGET_MS,
} from './migration-install-budget.mjs';

// Supavisor can replace startup application_name. Bind the existing installer
// identity on the backend that owns this transaction, without changing source
// bytes recorded in migration history or exempting any other session.
export function bindMigrationSession(sql, transactionBudgetMs = null) {
  if (
    transactionBudgetMs !== null &&
    (!Number.isSafeInteger(transactionBudgetMs) || transactionBudgetMs <= 0)
  )
    throw new Error('Invalid migration transaction budget');
  const bound = sql.replace(
    /^([ \t]*BEGIN[ \t]*;)/im,
    "$1\nSET LOCAL application_name = 'apply-recorded-migration';" +
      (transactionBudgetMs === null
        ? ''
        : `\nSET LOCAL transaction_timeout = '${transactionBudgetMs}ms';`)
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
