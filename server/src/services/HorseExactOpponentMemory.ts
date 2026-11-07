import { admitOpponentMemoryRead } from './HorseOpponentMemory.js';
import { supabase } from './supabase.js';
import {
  memoryVariant,
  validOpponentProfile,
  type DurableOpponentProfile,
  type MemoryMode,
  type MemorySize,
} from '../engine/HorseOpponentMemory.js';
import {
  publicMemoryDomainIsValid,
  publicMemoryDomainKey,
} from '../engine/HorsePublicMemoryDomain.js';
/** Saved-only exact context read. No legacy fallback, initializer or background IO. */
export async function readExactHorseOpponentProfiles(
  userIds: string[],
  variant: string,
  mode: MemoryMode,
  size: MemorySize,
  domain: unknown,
  signal?: AbortSignal
): Promise<DurableOpponentProfile[]> {
  if (!publicMemoryDomainIsValid(domain) || !memoryVariant(variant)) return [];
  const ids = [...new Set(userIds)].sort();
  if (!ids.length || ids.length > 10) throw Error('invalid exact public memory roster');
  const { data, error } = await admitOpponentMemoryRead(async () =>
    supabase
      .rpc('fn_horse_exact_profiles_read', {
        p_user_ids: ids,
        p_variant: variant,
        p_mode: mode,
        p_size: size,
        p_speed: domain.speed,
        p_ante: domain.ante,
      })
      .abortSignal(
        signal ? AbortSignal.any([signal, AbortSignal.timeout(1500)]) : AbortSignal.timeout(1500)
      )
  );
  if (
    error ||
    !Array.isArray(data) ||
    data.length > ids.length ||
    new Set(data.map((p) => p?.user_id)).size !== data.length ||
    data.some(
      (p) =>
        !validOpponentProfile(p) ||
        !ids.includes(p.user_id) ||
        p.variant !== variant ||
        p.mode !== mode ||
        p.size !== size ||
        publicMemoryDomainKey(p.public_memory_domain) !== publicMemoryDomainKey(domain)
    )
  )
    throw Error('exact public memory unavailable');
  return data;
}
