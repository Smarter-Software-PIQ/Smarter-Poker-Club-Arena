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
export function assertOrdinaryMigrationBudget(sql, capMs) {
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
