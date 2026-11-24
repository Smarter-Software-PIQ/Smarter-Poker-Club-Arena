/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CLUB ID RESOLVER — Smart UUID vs Integer Club ID Detection
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The clubs table has two ID columns:
 *   - `id`      (UUID, primary key)  — used internally
 *   - `club_id` (INTEGER, unique)    — the human-readable 6-digit club code
 *
 * URL route params may contain EITHER format. This utility detects which one
 * was provided and builds the correct Supabase query filter.
 */

import { supabase } from '../lib/supabase';
import { KINGS_CLUB_UUID } from '../lib/constants';
import { reportError } from './errorReporter';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns true if the value looks like a UUID.
 */
export function isUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Returns the correct column name and typed value for querying the clubs table.
 *
 * @example
 *   const { column, value } = resolveClubIdFilter(clubId);
 *   supabase.from('clubs').select('id, name').eq(column, value).maybeSingle();
 */
export function resolveClubIdFilter(clubIdParam: string): {
  column: 'id' | 'club_id' | 'slug';
  value: string | number;
} {
  if (clubIdParam.toLowerCase() === 'shark-club' || clubIdParam.toLowerCase() === 'kings-club') {
    return { column: 'id', value: KINGS_CLUB_UUID };
  }
  if (isUUID(clubIdParam)) {
    return { column: 'id', value: clubIdParam };
  }
  if (/^\d+$/.test(clubIdParam)) {
    return { column: 'club_id', value: Number(clubIdParam) };
  }
  return { column: 'slug', value: clubIdParam };
}

// ─── Resolved-UUID cache: memory + localStorage ────────────────────────────
//
// The club_id -> UUID mapping is immutable (both columns are set at club
// creation and never change), so it is safe to persist across sessions. This
// removes an entire serial network roundtrip from the front of EVERY wallet
// and lobby mount that arrives with an integer club code in the URL.
//
// A SLUG IS NOT IMMUTABLE (2026-11-14). club-jaqk became the-felt-society, and
// the rename trigger (20261114235607) frees an old slug for another club. So
// only the six-digit code is persisted; a slug answer lives in memory for this
// tab, and a former slug's answer (club_slug_history) is never cached at all,
// so the clubs table is asked first every time and the club holding a slug
// now always wins over the club that held it before.
//
// The persisted map lives under ONE localStorage key (not one key per club)
// and is purged on sign-out by clearUserCaches — the set of clubs a person
// has visited is their data.
export const CLUB_UUID_MAP_KEY = 'club_arena_uuid_map_v1';
const MAX_PERSISTED_MAPPINGS = 200;
const IMMUTABLE_CLUB_KEY = /^\d+$/;

// PostgreSQL insufficient_privilege: club_slug_history grants no read to anon.
const HISTORY_CLOSED_TO_THIS_CALLER = '42501';

const uuidCache = new Map<string, string>();
let persistedLoaded = false;

function loadPersistedMap(): void {
  if (persistedLoaded) return;
  persistedLoaded = true;
  try {
    const raw = localStorage.getItem(CLUB_UUID_MAP_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (
          IMMUTABLE_CLUB_KEY.test(k) &&
          typeof v === 'string' &&
          UUID_REGEX.test(v) &&
          !uuidCache.has(k)
        ) {
          uuidCache.set(k, v);
        }
      }
    }
  } catch {
    /* corrupt or unavailable — memory cache still works */
  }
}

function persistMap(): void {
  try {
    const entries = Array.from(uuidCache.entries())
      .filter(([k]) => IMMUTABLE_CLUB_KEY.test(k))
      .slice(-MAX_PERSISTED_MAPPINGS);
    localStorage.setItem(CLUB_UUID_MAP_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* best-effort */
  }
}

/**
 * Synchronous resolution attempt: returns the UUID immediately when the input
 * already is one, or when the mapping is cached (memory or localStorage).
 * Returns null when a network lookup is required — callers then fall back to
 * resolveClubUUID. This lets wallet surfaces start their data fetch in the
 * same tick they mount instead of waiting a roundtrip.
 */
export function resolveClubUUIDSync(clubIdParam: string): string | null {
  if (isUUID(clubIdParam)) return clubIdParam;
  loadPersistedMap();
  return uuidCache.get(clubIdParam) ?? null;
}

/**
 * Resolves any club ID (UUID or integer) to its actual UUID.
 * If the provided ID is already a UUID, returns it immediately.
 * If it's an integer, queries the clubs table to find the UUID.
 * Results are cached for the lifetime of the session.
 *
 * @example
 *   const uuid = await resolveClubUUID('25450');
 *   // Returns the UUID like 'abc123-...'
 *   supabase.from('tables').select('*').eq('club_id', uuid);
 */
/**
 * Drop the in-memory map. `clearUserCaches` removes the persisted copy on
 * sign-out, but this module kept its Map and its `persistedLoaded` flag, so
 * the first write after the NEXT sign-in serialised the previous account's
 * visited clubs straight back to localStorage and undid the purge.
 * walletCache exports `clearWalletMemoryCache` for exactly this reason.
 */
export function clearClubUUIDCache(): void {
  uuidCache.clear();
  persistedLoaded = false;
}

/**
 * The club that formerly held `clubIdParam` as its slug, from the rename
 * history; null when no rename recorded it. Ask the clubs table first: a slug
 * a club holds now always wins. A failed read throws, so a strict caller never
 * mistakes it for "no such club".
 *
 * The history is readable by signed-in callers only (no anon grant). With no
 * signed-in session it is not asked at all: the old slug simply does not
 * resolve for a signed-out visitor, nothing is reported, and the same link
 * resolves (and SlugEnforcer rewrites it) once they sign in. A session that
 * lapses between that check and the read is refused with 42501, which is the
 * same answer and is equally quiet.
 */
export async function readFormerSlugClubId(
  clubIdParam: string,
  signal?: AbortSignal
): Promise<string | null> {
  if ((await hasSignedInSession()) === false) return null;
  const former = supabase
    .from('club_slug_history')
    .select('club_id')
    .eq('former_slug', clubIdParam);
  const { data: formerRow, error: formerError } = await (
    signal ? former.abortSignal(signal) : former
  ).maybeSingle();
  if (formerError) {
    if ((formerError as { code?: string }).code === HISTORY_CLOSED_TO_THIS_CALLER) return null;
    throw formerError;
  }
  const formerClubId = (formerRow as { club_id?: unknown } | null)?.club_id;
  return typeof formerClubId === 'string' && isUUID(formerClubId) ? formerClubId : null;
}

/** true or false when the client can say; null when it cannot tell. */
async function hasSignedInSession(): Promise<boolean | null> {
  const auth = (supabase as { auth?: { getSession?: unknown } }).auth;
  if (typeof auth?.getSession !== 'function') return null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return Boolean(data?.session);
  } catch {
    return null;
  }
}

/**
 * The slug a club holds now when `clubIdParam` is a slug it held before, so an
 * old link can be rewritten to the current one (SlugEnforcer); null for a
 * current slug, an id, a club code or a slug nobody ever held. A current slug
 * costs nothing once this tab has resolved it. Former slugs are never cached,
 * so a cached answer is a club that held the slug, as its CURRENT slug, when
 * this tab asked (memory only, for the life of the tab); it is not re-checked
 * against a later rename in the same tab.
 */
export async function currentSlugForFormerClubSlug(clubIdParam: string): Promise<string | null> {
  if (resolveClubIdFilter(clubIdParam).column !== 'slug') return null;
  if (resolveClubUUIDSync(clubIdParam)) return null;
  const clubUUID = await resolveClubUUID(clubIdParam);
  // resolveClubUUID caches what the clubs table answered and never what the
  // history answered, so a cache entry now means the clubs table answered:
  // the slug is a current one, not a former one.
  if (!isUUID(clubUUID) || resolveClubUUIDSync(clubIdParam)) return null;
  const { data, error } = await supabase
    .from('clubs')
    .select('slug')
    .eq('id', clubUUID)
    .maybeSingle();
  if (error) {
    reportError(error, 'clubIdResolver.currentSlugForFormerClubSlug', { clubIdParam });
    return null;
  }
  const slug = (data as { slug?: unknown } | null)?.slug;
  return typeof slug === 'string' && slug !== '' && slug !== clubIdParam ? slug : null;
}

export async function resolveClubUUID(clubIdParam: string, signal?: AbortSignal): Promise<string> {
  // Already a UUID — return as-is
  if (isUUID(clubIdParam)) return clubIdParam;

  // Check cache (memory, hydrated from localStorage on first call)
  const cached = resolveClubUUIDSync(clubIdParam);
  if (cached) return cached;

  const filter = resolveClubIdFilter(clubIdParam);

  // Query clubs table to get the UUID
  const query = supabase.from('clubs').select('id').eq(filter.column, filter.value);
  const { data, error } = await (signal ? query.abortSignal(signal) : query).maybeSingle();

  /* A FAILED READ IS NOT "NO SUCH CLUB". The error used to be dropped, so an
     RLS refusal, a PostgREST 400 or a dropped connection was indistinguishable
     from a club that does not exist - and the fallback below then handed a
     6-digit integer string to callers that feed it into `.eq('club_id', uuid)`,
     producing Postgres 22P02 "invalid input syntax for type uuid" on every
     downstream query, a long way from the cause. Reporting it does not change
     the return contract, but it makes the real failure findable. */
  if (error) reportError(error, 'clubIdResolver.resolveClubUUID', { clubIdParam });

  if (data?.id) {
    uuidCache.set(clubIdParam, data.id);
    persistMap();
    return data.id;
  }

  // A RENAMED CLUB KEEPS ITS OLD SLUG (2026-11-14). club-jaqk became
  // the-felt-society and every /clubs/club-jaqk link stopped resolving. A slug
  // no club holds now is looked up in the rename history (club_slug_history,
  // 20261114235606), which the renaming statement itself writes. The answer is
  // NOT cached: if a club later takes the freed slug, the next lookup must
  // find that club in the query above. A table read, not an RPC: this
  // resolver sits in front of 100+ callers and must not add a call to their
  // own RPC sequences.
  if (!error && filter.column === 'slug') {
    try {
      const formerClubId = await readFormerSlugClubId(clubIdParam, signal);
      if (formerClubId) return formerClubId;
    } catch (formerError) {
      reportError(formerError, 'clubIdResolver.formerSlug', { clubIdParam });
    }
  }

  // Fallback: return as-is (will fail downstream, but that's the existing behavior)
  console.warn(`[clubIdResolver] Could not resolve club UUID for: ${clubIdParam}`);
  return clubIdParam;
}

/**
 * Resolve a route-facing club identifier for authorization-sensitive reads.
 *
 * The legacy resolver deliberately preserves its original string fallback for
 * hundreds of older call sites. Guards and workspace permissions cannot use
 * that permissive contract: passing a slug or numeric code into a UUID column
 * turns a lookup problem into a misleading membership denial. This strict
 * variant keeps the compatibility surface while giving trust boundaries an
 * explicit, fail-closed result.
 */
export async function resolveClubUUIDStrict(
  clubIdParam: string,
  signal?: AbortSignal
): Promise<string> {
  const resolvedId = await resolveClubUUID(clubIdParam, signal);
  if (!isUUID(resolvedId)) {
    throw new Error(`Club identity could not be resolved for "${clubIdParam}".`);
  }
  return resolvedId;
}
