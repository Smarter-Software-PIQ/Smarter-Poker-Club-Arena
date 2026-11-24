let cashRakePolicyVersionInFlight: Promise<0 | 1 | 2 | 3 | null> | null = null;

/** Serving runtime capability, never inferred from a merged client or database row. */
export async function readCashRakePolicyVersion(): Promise<0 | 1 | 2 | 3 | null> {
  if (cashRakePolicyVersionInFlight) return cashRakePolicyVersionInFlight;
  const base =
    import.meta.env.VITE_GAME_SERVER_URL ||
    (import.meta.env.PROD ? 'https://engine.smarter.poker' : 'http://localhost:8080');
  const pending = (async (): Promise<0 | 1 | 2 | 3 | null> => {
    try {
      const response = await fetch(`${base}/health`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      const health = await response.json();
      if (!health || typeof health.version !== 'string') return null;
      if (
        health.cashRakePolicyVersion === 1 ||
        health.cashRakePolicyVersion === 2 ||
        health.cashRakePolicyVersion === 3
      )
        return health.cashRakePolicyVersion;
      // A reachable older engine explicitly lacks this new contract.
      if (health.cashRakePolicyVersion === undefined) return 0;
      return null;
    } catch {
      return null;
    }
  })().finally(() => {
    if (cashRakePolicyVersionInFlight === pending) cashRakePolicyVersionInFlight = null;
  });
  cashRakePolicyVersionInFlight = pending;
  return pending;
}

/** Test seam: forget any in-flight /health probe. */
export function _resetCashRakePolicyVersionForTests(): void {
  cashRakePolicyVersionInFlight = null;
}
