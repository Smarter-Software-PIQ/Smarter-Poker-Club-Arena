/** Public original-hand rules only. Missing historical rules stay unknown. */
export interface HorsePublicMemoryDomain {
  readonly version: 1;
  readonly speed: 'table' | 'lightning';
  readonly ante: 'none' | 'individual' | 'big_blind';
}
export function publicMemoryDomainIsValid(value: unknown): value is HorsePublicMemoryDomain {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).sort().join(',') === 'ante,speed,version' &&
    v.version === 1 &&
    ['table', 'lightning'].includes(v.speed as string) &&
    ['none', 'individual', 'big_blind'].includes(v.ante as string)
  );
}
export function publicMemoryDomainKey(value: unknown): string | null {
  return publicMemoryDomainIsValid(value) ? `${value.speed}:${value.ante}` : null;
}
export function publicMemoryDomainFromRules(
  speed: 'table' | 'lightning',
  ante: unknown,
  bigBlindAnte: unknown
): HorsePublicMemoryDomain | null {
  if (
    typeof ante !== 'number' ||
    !Number.isFinite(ante) ||
    ante < 0 ||
    typeof bigBlindAnte !== 'boolean'
  )
    return null;
  return {
    version: 1,
    speed,
    ante: ante === 0 ? 'none' : bigBlindAnte ? 'big_blind' : 'individual',
  };
}
