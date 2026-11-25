import {
  readPersistedTournamentFormatContract,
  normalizePersistedTournamentMaxPlayers,
  type TournamentFormatContract,
  type PersistedTournamentEntryCapacitySubject,
} from '../../server/src/tournament/tournamentEntryCapacity';
import { satelliteStartsWhenFull } from './satelliteQualification';

/** Presentation can show an unresolved historical row without inventing its format. */
export function readTournamentFormat(row: unknown): TournamentFormatContract | null {
  try {
    return readPersistedTournamentFormatContract(row);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export function isKnownTournamentFormat(row: unknown): boolean {
  return readTournamentFormat(row) !== null;
}

export function isUnlimitedTournamentFormat(row: unknown): boolean {
  const format = readTournamentFormat(row);
  return format === 'mtt-v1' || format === 'mtt-v2';
}

/** NULL means no displayable denominator, including unresolved historical formats. */
export function getTournamentEntryCapacity(row: unknown): number | null {
  return isKnownTournamentFormat(row)
    ? normalizePersistedTournamentMaxPlayers(row as PersistedTournamentEntryCapacitySubject)
    : null;
}

export function tournamentClosingStatus(
  status: unknown
): 'Completing' | 'Completed' | 'Cancelled' | null {
  switch (String(status ?? '').toUpperCase()) {
    case 'COMPLETING':
      return 'Completing';
    case 'COMPLETED':
    case 'FINISHED':
      return 'Completed';
    case 'CANCELLED':
    case 'ABORTED':
      return 'Cancelled';
    default:
      return null;
  }
}

/** A missing marker never authorizes registration, waitlisting or a seat purchase. */
export function isTournamentEntryUnavailable(row: unknown, entrants: number): boolean {
  if (!isKnownTournamentFormat(row) || !Number.isSafeInteger(entrants) || entrants < 0) return true;
  const status = String((row as { status?: unknown }).status ?? '').toUpperCase();
  if (tournamentClosingStatus(status)) return true;
  // Multi-day, between days: entries are closed (the registration core admits
  // nobody into a BAGGED event), though the event is not over.
  if (status === 'BAGGED') return true;
  if (isUnlimitedTournamentFormat(row)) return false;
  const capacity = getTournamentEntryCapacity(row);
  return capacity === null || entrants >= capacity;
}

export function isSeatFirstTournamentFormat(row: unknown): boolean {
  const format = readTournamentFormat(row);
  const capacity = getTournamentEntryCapacity(row);
  if (capacity === null) return false;
  if (format === 'spin-v1' || format === 'seat-first-satellite-v1') return true;
  return format === 'sng-v1' && capacity === 2;
}

export function getTournamentFormatKind(row: unknown): 'mtt' | 'sng' | 'spin' | 'unknown' {
  switch (readTournamentFormat(row)) {
    case 'mtt-v1':
    case 'mtt-v2':
      return 'mtt';
    case 'seat-first-satellite-v1':
    case 'sng-v1':
      return 'sng';
    case 'spin-v1':
      return 'spin';
    default:
      return 'unknown';
  }
}

const STARTS_WHEN_FULL_LABELS = new Set([
  'spin',
  'sng',
  'hu_sng',
  'heads_up',
  'sit_and_go',
  'sit-and-go',
  'spin_and_go',
  'spin-and-go',
]);

const SCHEDULED_MTT_LABELS = new Set([
  'mtt',
  'xmtt',
  'satellite',
  'freezeout',
  'bounty',
  'progressive',
  'progressive_bounty',
  'pko',
  'mystery',
  'mystery_bounty',
  'rebuy',
  'reentry',
  'mtt_freezeout',
  'mtt_free_buy',
  'mtt_rebuy',
  'mtt_reentry',
  'freeroll',
  'cash',
]);

function normalizedFormatLabel(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Single authoritative start-mode predicate for client presentation.
 *
 * Returns true for ANY Spin, ANY Sit & Go (Heads-Up, 6-max, 9-max, and SNG
 * satellites), and recorded fixed-field satellites - and false for scheduled
 * MTTs (including scheduled MTT satellites). Also supports mapped client rows
 * carrying `kind`, `type`, `variant`, `tournament_type`, or `tournamentType`
 * when no persisted `format_contract` is attached, while never producing false
 * positives on scheduled MTTs.
 */
export function tournamentStartsWhenFull(row: unknown): boolean {
  if (!row || typeof row !== 'object') return false;
  const formatKind = getTournamentFormatKind(row);
  if (formatKind === 'spin' || formatKind === 'sng') return true;
  if (formatKind === 'mtt') return false;
  if (satelliteStartsWhenFull(row)) return true;

  const candidate = row as {
    kind?: unknown;
    type?: unknown;
    variant?: unknown;
    tournament_type?: unknown;
    tournamentType?: unknown;
  };

  const kind = normalizedFormatLabel(candidate.kind);
  if (kind === 'spin' || kind === 'sng') return true;
  if (kind === 'mtt' || kind === 'cash') return false;

  const explicitType = normalizedFormatLabel(
    candidate.tournament_type ?? candidate.tournamentType ?? candidate.type
  );
  if (STARTS_WHEN_FULL_LABELS.has(explicitType)) return true;
  if (SCHEDULED_MTT_LABELS.has(explicitType)) return false;

  const variant = normalizedFormatLabel(candidate.variant);
  return STARTS_WHEN_FULL_LABELS.has(variant);
}
