import { createHash } from 'node:crypto';

/**
 * Event-specific random permutation, stable through one hour and independent
 * of input paging order. Rotating one ID-sorted ring had only N possible
 * queues: different events could select exactly the same contiguous cohort.
 * Each random event UUID now seeds every Horse's position independently.
 */
export function orderHorseTournamentCandidates<T extends { id: string }>(
  horses: readonly T[],
  tournamentId: string,
  hourUTC: number
): T[] {
  if (!tournamentId) throw new Error('Tournament identity is required for Horse selection');
  return horses
    .map((horse) => ({
      horse,
      key: createHash('sha256')
        .update(`${tournamentId}:horse-candidates-v1:${hourUTC}:${horse.id}`)
        .digest('hex'),
    }))
    .sort((a, b) =>
      a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : a.horse.id < b.horse.id
            ? -1
            : a.horse.id > b.horse.id
              ? 1
              : 0
    )
    .map(({ horse }) => horse);
}
