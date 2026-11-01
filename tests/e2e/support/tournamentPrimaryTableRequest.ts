/** The actual supabase-js POST shape, restricted to one selected event. */
export function isTournamentPrimaryTableRequest(
  request: { url(): string; method(): string; postDataJSON(): unknown },
  tournamentId: string
): boolean {
  try {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tournamentId) ||
      request.method() !== 'POST' ||
      new URL(request.url()).pathname !== '/rest/v1/rpc/fn_tournament_primary_table'
    )
      return false;
    const body = request.postDataJSON();
    return (
      body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      (body as Record<string, unknown>).p_tournament_id === tournamentId
    );
  } catch {
    return false;
  }
}
