/** Keep the terminal authority's 45-second SQL ceiling inside its HTTP deadline. */
export const DEFAULT_MAINTENANCE_CLIENT_TIMEOUT_MS = 50_000;
export const MAX_MAINTENANCE_CLIENT_TIMEOUT_MS = 2_147_483_647;

export function resolveMaintenanceClientTimeoutMs(
  env: { MAINTENANCE_SUPABASE_TIMEOUT_MS?: string } = process.env
): number {
  const raw = Number(env.MAINTENANCE_SUPABASE_TIMEOUT_MS ?? DEFAULT_MAINTENANCE_CLIENT_TIMEOUT_MS);
  // Match the ordinary client's invalid-config fallback, while retaining the
  // established five-second headroom. Node timers overflow above signed int32.
  return Number.isFinite(raw) &&
    raw >= DEFAULT_MAINTENANCE_CLIENT_TIMEOUT_MS &&
    raw <= MAX_MAINTENANCE_CLIENT_TIMEOUT_MS
    ? raw
    : DEFAULT_MAINTENANCE_CLIENT_TIMEOUT_MS;
}
