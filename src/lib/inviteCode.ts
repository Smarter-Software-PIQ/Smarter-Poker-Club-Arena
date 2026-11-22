/**
 * The Share & Invite code format, in one pure module with no client imports,
 * so link builders (handHistoryLive, share) and route guards can validate
 * invite codes, cluster ids, hold tokens, and return paths without loading the
 * Supabase client. ClubInviteService re-exports normalizeInviteCode; there is
 * one rule. Seven characters from an alphabet without 0/O/1/I (fn_club_invite_link).
 */
export const INVITE_CODE_RE = /^[A-HJ-NP-Z2-9]{7}$/;

export function normalizeInviteCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toUpperCase();
  return INVITE_CODE_RE.test(v) ? v : null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return UUID_RE.test(v) ? v : null;
}

export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{4,128}$/;

export function normalizeInviteToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return INVITE_TOKEN_RE.test(v) ? v : null;
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
const ENCODED_TRAVERSAL_RE = /%(?:2e|2f|5c)/i;
const ALLOWED_NEXT_PATH_RE =
  /^\/(?:table|lightning|tournaments)\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WEB_PREFIX = '/hub/club-arena';

/**
 * Validate an internal Club Arena return path (`?next=`) carried across an
 * invite join flow. Accepts only `/table/:id`, `/lightning/:id`, and
 * `/tournaments/:id` (with optional query params and optional `/hub/club-arena`
 * prefix), rejecting open redirects, schemes, backslashes, path traversal, and
 * control characters.
 */
export function safeInviteNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (hasControlChar(raw)) return null;
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return null;
  }
  const rawPathname = trimmed.split(/[?#]/, 1)[0];
  if (
    rawPathname.includes('..') ||
    ENCODED_TRAVERSAL_RE.test(rawPathname) ||
    rawPathname.split('/').some((seg) => seg === '.' || seg === '..')
  ) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed, 'https://club-arena.local');
  } catch {
    return null;
  }
  if (parsed.origin !== 'https://club-arena.local') return null;

  let pathname = parsed.pathname;
  if (pathname.startsWith(`${WEB_PREFIX}/`)) {
    pathname = pathname.slice(WEB_PREFIX.length);
  }
  if (
    pathname.includes('..') ||
    pathname.includes('\\') ||
    hasControlChar(pathname) ||
    !ALLOWED_NEXT_PATH_RE.test(pathname)
  ) {
    return null;
  }

  try {
    const decodedPath = decodeURIComponent(pathname);
    if (
      decodedPath.includes('..') ||
      decodedPath.includes('\\') ||
      hasControlChar(decodedPath) ||
      !ALLOWED_NEXT_PATH_RE.test(decodedPath)
    ) {
      return null;
    }
  } catch {
    return null;
  }

  if (hasControlChar(parsed.search)) return null;
  return `${pathname}${parsed.search}`;
}

/**
 * Append a validated `?next=` return path to an in-app Club Arena route (e.g.
 * `/invite/:clubId?i=CODE`). Leaves the destination untouched if `nextPath` is
 * absent or rejected by `safeInviteNextPath`.
 */
export function appendInviteNextParam(
  inAppPath: string,
  nextPath: string | null | undefined
): string {
  const safe = safeInviteNextPath(nextPath);
  if (!safe) return inAppPath;
  const parsed = new URL(inAppPath, 'https://club-arena.local');
  parsed.searchParams.set('next', safe);
  return `${parsed.pathname}${parsed.search}`;
}
