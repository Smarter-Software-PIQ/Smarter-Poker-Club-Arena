/** Independent HTTP provenance for the complete lobby board, not ancillary reads. */
export interface ObservedLobbyScope {
  unionId: string | null;
  clubIds: string[];
}

export function tournamentBoardScope(url: URL, clubId: string): ObservedLobbyScope | undefined {
  if (!url.pathname.endsWith('/tournaments')) return undefined;
  const selected = new Set(
    (url.searchParams.get('select') || '').split(',').map((key) => key.trim())
  );
  const required = [
    'id',
    'format_contract',
    'club_id',
    'union_id',
    'is_private',
    'game_type',
    'buy_in_amount',
    'buy_in_fee',
    'current_players',
    'max_players',
    'start_time',
    'status',
    'variant',
    'blind_structure',
  ];
  const statuses = (url.searchParams.get('status') || '')
    .match(/^in\.\(([^)]+)\)$/)?.[1]
    .split(',')
    .sort();
  const expected = ['REGISTERING', 'RUNNING', 'LATE_REG', 'STARTING_SOON', 'BAGGED'].sort();
  const horizon = url.searchParams.get('start_time') || '';
  const limit = Number(url.searchParams.get('limit'));
  // A club-only count, feature lookup, freeroll offer or point lifecycle read
  // cannot establish the authority of the separate union-visible board census.
  if (
    !required.every((key) => selected.has(key)) ||
    JSON.stringify(statuses) !== JSON.stringify(expected) ||
    !horizon.startsWith('lte.') ||
    !Number.isFinite(Date.parse(horizon.slice(4))) ||
    url.searchParams.get('order') !== 'start_time.asc' ||
    !Number.isInteger(limit) ||
    limit <= 0 ||
    limit > 500 ||
    ['id', 'name', 'format_contract', 'offset'].some((key) => url.searchParams.has(key))
  )
    return undefined;

  const uuid = /^[0-9a-f-]{36}$/i;
  const id = clubId.toLowerCase();
  const expression = url.searchParams.get('or')?.replace(/^\((.*)\)$/, '$1');
  if (expression) {
    const union =
      /^union_id\.eq\.([0-9a-f-]{36}),and\(club_id\.eq\.([0-9a-f-]{36}),is_private\.eq\.true\)$/i.exec(
        expression
      );
    if (union && union[2].toLowerCase() === id && !url.searchParams.has('club_id'))
      return { unionId: union[1].toLowerCase(), clubIds: [id] };
    throw new Error('The complete tournament board query has an unrecognized membership scope');
  }
  const filter = url.searchParams.get('club_id');
  const clubs =
    filter?.startsWith('in.(') && filter.endsWith(')')
      ? filter
          .slice(4, -1)
          .split(',')
          .map((value) => value.replace(/^"|"$/g, '').trim().toLowerCase())
      : filter?.startsWith('eq.')
        ? [filter.slice(3).toLowerCase()]
        : [];
  if (clubs.length && clubs.every((value) => uuid.test(value)) && clubs.includes(id))
    return { unionId: null, clubIds: [...new Set(clubs)].sort() };
  throw new Error('The complete tournament board query has an unrecognized membership scope');
}
