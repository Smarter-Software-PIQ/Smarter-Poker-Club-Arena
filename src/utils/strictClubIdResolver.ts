import { supabase } from '../lib/supabase';
import {
  isUUID,
  readFormerSlugClubId,
  resolveClubIdFilter,
  resolveClubUUIDSync,
} from './clubIdResolver';
import { reportError } from './errorReporter';
import { runRosterReadWithRetry } from './rosterReadReliability';

export class ClubNotFoundError extends Error {
  constructor(clubIdParam: string) {
    super(`Club "${clubIdParam}" was not found.`);
    this.name = 'ClubNotFoundError';
  }
}

export class ClubResolutionError extends Error {
  readonly cause: unknown;

  constructor(clubIdParam: string, cause: unknown) {
    super(`Club identity could not be resolved for "${clubIdParam}".`);
    this.name = 'ClubResolutionError';
    this.cause = cause;
  }
}

/**
 * Network-only half of strict club resolution. Kept behind a dynamic import so
 * route retry machinery is downloaded only when an uncached alias needs it.
 */
export async function resolveClubUUIDStrict(
  clubIdParam: string,
  signal?: AbortSignal
): Promise<string> {
  if (isUUID(clubIdParam)) return clubIdParam;
  const cached = resolveClubUUIDSync(clubIdParam);
  if (cached) return cached;
  const filter = resolveClubIdFilter(clubIdParam);
  let data: { id: string } | null;

  try {
    data = await runRosterReadWithRetry(
      async (signal) => {
        let request = supabase
          .from('clubs')
          .select('id')
          .eq(filter.column, filter.value)
          .maybeSingle();
        if (typeof (request as any).abortSignal === 'function') {
          request = (request as any).abortSignal(signal);
        }
        const result = await request;
        if (result.error) throw result.error;
        return result.data as { id: string } | null;
      },
      { attempts: 3, timeoutMs: 8_000, signal }
    );
  } catch (error) {
    reportError(error, 'clubIdResolver.resolveClubUUIDStrict', { clubIdParam });
    throw new ClubResolutionError(clubIdParam, error);
  }

  if (data?.id && isUUID(data.id)) return data.id;

  // A RENAMED CLUB KEEPS ITS OLD SLUG (2026-11-14): a slug no club holds now
  // is read from the rename history, through the same reader the permissive
  // resolver uses. Its answer is never cached, so a club that later takes the
  // slug wins above. A failed history read is a resolution failure, never
  // "not found".
  if (filter.column === 'slug') {
    let formerClubId: string | null;
    try {
      formerClubId = await readFormerSlugClubId(clubIdParam, signal);
    } catch (error) {
      reportError(error, 'clubIdResolver.resolveClubUUIDStrict.formerSlug', { clubIdParam });
      throw new ClubResolutionError(clubIdParam, error);
    }
    if (formerClubId) return formerClubId;
  }
  throw new ClubNotFoundError(clubIdParam);
}
