import {
  admitOpponentMemoryRead,
  opponentMemoryFailureKind,
  opponentMemoryLatencyEdge,
  queryError,
} from './HorseOpponentMemory.js';
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
import { noteFire } from '../engine/BrainTelemetry.js';

/**
 * RECEIPTS (2026-11-07). This read serves every completed hand that carries
 * its original speed/ante domain (every live hand since #9693), so it leaves
 * the same proof the legacy reader leaves, under its own names:
 *   horse_exact_memory_read_ok            a validated exact-domain result
 *   horse_exact_memory_read_ms_{le50|le100|le250|le500|le1000|gt1000}
 *   horse_exact_memory_read_{failed|timeout|busy}   transport or admission
 *   horse_exact_memory_read_invalid       the response failed receipt validation
 * Without these, horse_exact_profiles was read and written for hours while
 * the flush showed horse_opponent_memory_read_ok = 0 and the proof kit called
 * memory reads absent.
 */
const INVALID = 'exact public memory unavailable';
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
  const startedAt = Date.now();
  let data: unknown;
  try {
    data = await admitOpponentMemoryRead(async () => {
      const response = await supabase
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
        );
      if (response.error) throw queryError(INVALID, response.error);
      return response.data;
    });
  } catch (error) {
    // The admission refusal keeps its own identity so callers can still log a
    // busy refusal as one throttled line; a query error carries only its class.
    const kind = opponentMemoryFailureKind(error);
    if (kind === 'timeout') noteFire('horse_exact_memory_read_timeout');
    else if (kind === 'busy') noteFire('horse_exact_memory_read_busy');
    else noteFire('horse_exact_memory_read_failed');
    throw error;
  }
  if (
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
  ) {
    noteFire('horse_exact_memory_read_invalid');
    throw Error(INVALID);
  }
  noteFire('horse_exact_memory_read_ok');
  noteFire(`horse_exact_memory_read_ms_${opponentMemoryLatencyEdge(Date.now() - startedAt)}`);
  return data;
}
