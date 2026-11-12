/**
 * The missing-memory-domain signal (2026-11-12, HVH2D-EXE-002).
 *
 * `logHandHistory` is the storage boundary for `hand_history.public_memory_domain`:
 * it writes the column when the producer's value passes
 * `publicMemoryDomainIsValid` and omits it otherwise. The consumer is the
 * database trigger `fn_horse_exact_accept_hand` (migration 20261106091733),
 * which returns without learning when the stored domain is not valid. An
 * omission was therefore silent on both sides. This module classifies the same
 * inputs the row is built from and counts the hand once, after the atomic
 * commit has accepted it. It reads; it never changes what is written.
 *
 * WHAT IS EXEMPT, FROM SOURCE. The trigger also returns early when
 * `game_variant` is not one of the nine learner variants (MEMORY_VARIANTS
 * mirrors that list). A hand of such a variant can never be learned, with or
 * without a domain, so its missing domain is `unsupported_variant`, kept out
 * of the alert's numerator and denominator. No other exemption is established
 * here: at this boundary a `null` from a producer whose rules were unknown
 * (`publicMemoryDomainFromRules` returns null) and a `null` from a producer
 * that lost its controller are the same value, so both count as `absent`.
 */
import { publicMemoryDomainIsValid } from '../../engine/HorsePublicMemoryDomain.js';
import { memoryVariant } from '../../engine/HorseOpponentMemory.js';
import {
  handMemoryDomainLoggedTotal,
  handMemoryDomainMissingTotal,
  type HAND_MEMORY_DOMAIN_LEARNER_SCOPES,
  type HAND_MEMORY_DOMAIN_MISSING_REASONS,
  type HAND_MEMORY_DOMAIN_MODES,
  type HAND_MEMORY_DOMAIN_SHOWDOWN,
} from '../../observability/engineInstruments.js';

export interface HandMemoryDomainSignalInput {
  publicMemoryDomain?: unknown;
  gameVariant: unknown;
  tournamentId?: string | null;
  showdownReveal?: readonly unknown[] | null;
}

export interface HandMemoryDomainClass {
  mode: (typeof HAND_MEMORY_DOMAIN_MODES)[number];
  reached_showdown: (typeof HAND_MEMORY_DOMAIN_SHOWDOWN)[number];
  learner_scope: (typeof HAND_MEMORY_DOMAIN_LEARNER_SCOPES)[number];
  /** null when the row carries a valid domain. */
  missing: (typeof HAND_MEMORY_DOMAIN_MISSING_REASONS)[number] | null;
}

/** Pure: the labels of one logged hand, from the facts its row is built from. */
export function classifyHandMemoryDomain(
  input: HandMemoryDomainSignalInput
): HandMemoryDomainClass {
  const supported = memoryVariant(input.gameVariant) !== null;
  const domain = input.publicMemoryDomain;
  return {
    mode: input.tournamentId ? 'tournament' : 'cash',
    reached_showdown: input.showdownReveal?.length ? 'true' : 'false',
    learner_scope: supported ? 'supported' : 'unsupported_variant',
    missing: publicMemoryDomainIsValid(domain)
      ? null
      : !supported
        ? 'unsupported_variant'
        : domain === null || domain === undefined
          ? 'absent'
          : 'invalid',
  };
}

/**
 * Count one ACCEPTED hand. Called exactly once per successful `logHandHistory`
 * call, after `insertHandHistoryRow` resolves: its identical-request retries
 * all happen inside that one await, and a refused or unproved commit throws
 * before this line. Never throws into settlement.
 */
export function countLoggedHandMemoryDomain(input: HandMemoryDomainSignalInput): void {
  try {
    const { mode, reached_showdown, learner_scope, missing } = classifyHandMemoryDomain(input);
    handMemoryDomainLoggedTotal.inc(1, { mode, reached_showdown, learner_scope });
    if (missing) handMemoryDomainMissingTotal.inc(1, { mode, reached_showdown, reason: missing });
  } catch {
    /* a signal must never endanger an accepted hand */
  }
}
