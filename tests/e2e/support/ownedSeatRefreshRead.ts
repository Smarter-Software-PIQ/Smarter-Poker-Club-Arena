/**
 * The account's live-seat read that MultiTablePage sends on visibility and
 * online recovery (requestSeatResync): GET table_seats selecting
 * `table_id,joined_at` with `user_id=eq.<owner>` and `left_at=is.null`.
 *
 * Match the read by its role, not by a column list frozen in time. #10887
 * added `joined_at` (one tournament, one chair), and the exact
 * `select=table_id` pin then waited out the whole test budget for a request the
 * app no longer sends (Post-Deploy E2E run 43668583397, chromium and
 * webkit-footer). The seat ids still lead the select and `joined_at` must be
 * present. tests/unit/ownedSeatRefreshRead.test.ts pins the app's select string
 * against this predicate, so the next column change fails at PR time instead of
 * after deploy.
 */
export function isOwnedLiveSeatRead(method: string, url: URL, ownerId: string): boolean {
  const columns = (url.searchParams.get('select') ?? '').split(',').map((column) => column.trim());
  return (
    method === 'GET' &&
    url.pathname.endsWith('/table_seats') &&
    columns[0] === 'table_id' &&
    columns.includes('joined_at') &&
    url.searchParams.get('user_id') === `eq.${ownerId}` &&
    url.searchParams.get('left_at') === 'is.null'
  );
}
