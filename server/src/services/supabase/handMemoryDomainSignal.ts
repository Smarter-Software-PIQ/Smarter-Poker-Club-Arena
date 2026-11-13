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
 *
 * THREE BOUNDARIES WRITE AN ACCEPTED HAND, ONE COUNT EACH (2026-11-12, the
 * verifier's follow-up to #10640). The trigger fires on every
 * `hand_atomic_commits` insert, and all three reach it through the one door
 * `fn_ca_commit_hand_settlement`:
 *   1. `logHandHistory` (a physical cash or tournament table):
 *      `countLoggedHandMemoryDomain`, mode cash | tournament.
 *   2. `fn_lightning_settle_hand` (a Lightning pool hand, whose row
 *      `LightningHandHost.handRow` builds and never passes through
 *      `logHandHistory`): `countStoredHandMemoryDomain(row, 'lightning')` in
 *      `LightningHandBackend.settle`, mode lightning. The trigger files such a
 *      hand under its own profile partition (domain speed `lightning`).
 *   3. `fn_ca_resume_hand_submission` when a replacement engine's call is the
 *      one that commits a retained original (`financial_handoff`): the
 *      original engine's `logHandHistory` threw before its count, so
 *      `resumeRetainedHandSubmission` reads the four stored columns back
 *      (handMemoryDomainReadback.ts) and calls
 *      `countStoredHandMemoryDomain(row)`, mode cash | tournament.
 * No hand passes two of them: a Lightning hand is never retained, and a
 * resume that finds the hand already committed answers
 * `financial_handoff: false` and is not counted again.
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
  /** A Lightning pool hand: its own `mode`, whatever its tournament_id. */
  lightning?: boolean;
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
    mode: input.lightning ? 'lightning' : input.tournamentId ? 'tournament' : 'cash',
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

/**
 * Count one ACCEPTED hand from the row that was stored: the `hand_history`
 * columns `public_memory_domain`, `game_variant`, `tournament_id` and
 * `showdown`, exactly what the trigger reads. For the two boundaries that do
 * not pass through `logHandHistory` (see the header). The caller owns "once
 * per accepted hand"; anything that is not a row counts nothing. Never throws.
 */
export function countStoredHandMemoryDomain(
  row: unknown,
  speed: 'table' | 'lightning' = 'table'
): void {
  try {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    const stored = row as Record<string, unknown>;
    countLoggedHandMemoryDomain({
      publicMemoryDomain: stored.public_memory_domain,
      gameVariant: stored.game_variant,
      tournamentId: typeof stored.tournament_id === 'string' ? stored.tournament_id : null,
      showdownReveal: Array.isArray(stored.showdown) ? stored.showdown : null,
      lightning: speed === 'lightning',
    });
  } catch {
    /* a signal must never endanger an accepted hand */
  }
}
