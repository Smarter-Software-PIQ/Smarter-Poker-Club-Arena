/**
 * How a production proof recognises that the ACCOUNT accepted a preference
 * change (migration 20261105183133).
 *
 * The client no longer writes preference rows. Every change goes through one
 * of three functions, each acting for the signed-in account only:
 *   fn_save_lobby_preferences  { p_club_id, p_changes: [{ field, value, base }] }
 *   fn_save_page_preferences   { p_changes: [{ field, value, base }] }
 *   fn_set_lobby_favorites     { p_changes: [{ kind, game_id, on, base }] }
 * and answers one result per change: `applied`, or `conflict` with the value
 * the account holds. A change is saved when it was applied, or when the
 * account already holds exactly that value (a retried duplicate).
 *
 * Observe only: nothing here issues, routes or retries a request.
 */
import type { Request, Response } from '@playwright/test';

export type PreferenceFunction =
  | 'fn_save_lobby_preferences'
  | 'fn_save_page_preferences'
  | 'fn_set_lobby_favorites';

export interface PreferenceChange {
  field?: unknown;
  value?: unknown;
  base?: unknown;
  kind?: unknown;
  game_id?: unknown;
  on?: unknown;
}

export interface PreferenceCall {
  clubId: string | null;
  changes: PreferenceChange[];
}

/** The decoded body of a call to `fn`, or null when the request is not one. */
export function preferenceCall(request: Request, fn: PreferenceFunction): PreferenceCall | null {
  if (request.method() !== 'POST') return null;
  if (!new URL(request.url()).pathname.endsWith(`/rest/v1/rpc/${fn}`)) return null;
  try {
    const body = request.postDataJSON() as { p_club_id?: unknown; p_changes?: unknown } | null;
    if (!body || typeof body !== 'object' || !Array.isArray(body.p_changes)) return null;
    return {
      clubId: typeof body.p_club_id === 'string' ? body.p_club_id : null,
      changes: body.p_changes as PreferenceChange[],
    };
  } catch {
    return null;
  }
}

/** The account a request was made as: the `sub` of its bearer token. Never logged. */
export async function requestOwner(request: Request): Promise<string | null> {
  const headers = await request.allHeaders();
  const auth = headers.authorization ?? headers.Authorization;
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8'
    );
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

/** jsonb does not keep object key order, so compare canonically. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])])
    );
  return value ?? null;
}
export const samePreference = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const same = samePreference;

/**
 * True when `response` is the owner's own call and the account holds `wanted`
 * for `field` afterwards. `field` is the change's field (`view.tab`,
 * `filters.HOLDEM`, a page key) or, for favorites, `<kind>:<game id>`.
 */
export async function accountAccepted(
  response: Response,
  fn: PreferenceFunction,
  ownerId: string,
  field: string,
  wanted: unknown
): Promise<boolean> {
  if (!response.ok() || !preferenceCall(response.request(), fn)) return false;
  if ((await requestOwner(response.request())) !== ownerId) return false;
  let reply: { results?: unknown } | null;
  try {
    reply = (await response.json()) as { results?: unknown } | null;
  } catch {
    return false;
  }
  const results = Array.isArray(reply?.results)
    ? (reply!.results as Array<Record<string, unknown>>)
    : [];
  const result = results.find((r) => r?.field === field);
  if (!result) return false;
  const held =
    fn === 'fn_set_lobby_favorites' ? result.active === wanted : same(result.value, wanted);
  return (result.status === 'applied' || result.status === 'conflict') && held;
}

/** The change in `call` for `field`, if the call carries one. */
export function changeFor(call: PreferenceCall | null, field: string): PreferenceChange | undefined {
  return call?.changes.find((c) =>
    c.field !== undefined ? c.field === field : `${String(c.kind)}:${String(c.game_id)}` === field
  );
}

export async function lobbySaveAccepted(
  response: Response,
  ownerId: string,
  clubId: string,
  field: string,
  wanted: unknown
): Promise<boolean> {
  const call = preferenceCall(response.request(), 'fn_save_lobby_preferences');
  if (!call || call.clubId !== clubId || !changeFor(call, field)) return false;
  if (!same(changeFor(call, field)!.value, wanted)) return false;
  return accountAccepted(response, 'fn_save_lobby_preferences', ownerId, field, wanted);
}

export async function pageSaveAccepted(
  response: Response,
  ownerId: string,
  key: string,
  wanted: unknown
): Promise<boolean> {
  const call = preferenceCall(response.request(), 'fn_save_page_preferences');
  if (!call || !same(changeFor(call, key)?.value, wanted)) return false;
  return accountAccepted(response, 'fn_save_page_preferences', ownerId, key, wanted);
}

export async function favoriteSaveAccepted(
  response: Response,
  ownerId: string,
  gameId: string,
  on: boolean
): Promise<boolean> {
  const call = preferenceCall(response.request(), 'fn_set_lobby_favorites');
  const change = call?.changes.find((c) => c.game_id === gameId);
  if (!change || change.on !== on) return false;
  return accountAccepted(
    response,
    'fn_set_lobby_favorites',
    ownerId,
    `${String(change.kind)}:${gameId}`,
    on
  );
}

/** Rows of a `fn_my_lobby_favorites` answer, or null when `response` is not one. */
export async function favoritesRead(
  response: Response
): Promise<Array<{ game_id: string; active: boolean; kind: string }> | null> {
  if (
    !response.ok() ||
    response.request().method() !== 'POST' ||
    !new URL(response.url()).pathname.endsWith('/rest/v1/rpc/fn_my_lobby_favorites')
  )
    return null;
  const rows = await response.json();
  return Array.isArray(rows) ? rows : null;
}
