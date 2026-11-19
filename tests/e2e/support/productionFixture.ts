/**
 * productionFixture.ts - a production check names the KIND of table it needs,
 * and says "could not test" only when production really has none of that kind.
 *
 * WHY (2026-11-19)
 *
 * The production specs find their subjects in live production. On one day:
 *
 *   - the 6+9 layout proof kept the busiest tables and never reached a
 *     nine-seat one while three were dealing (fixed in #11405);
 *   - the seat-move proof needed a second destination table;
 *   - the live-table lane printed "required live-table coverage is incomplete:
 *     an already-running SPIN table ..." while every SPIN was REGISTERING;
 *   - earlier, "The fixture club exposed no occupied (2+ players), running
 *     cash table" turned a quiet lobby into a red.
 *
 * Two different states hide behind one empty candidate list, and only an
 * independent read can tell them apart:
 *
 *   absent  production has no table of the needed kind. Nothing was observed,
 *           so nothing is certified and nothing is condemned. The spec throws
 *           `PRODUCTION_LACKS_FIXTURE <kind>`; the workflow classifies it as a
 *           NON-VERDICT (scripts/ci/classify-fixture-absence.mjs, or the
 *           live-table coverage gate), never a pass and never a defect report.
 *   missed  the tables catalogue AND the engine both show a dealing table of
 *           that kind that the selector never considered. That is a selector
 *           defect and it stays red as `SELECTOR_MISSED_FIXTURE <kind>`.
 *
 * An absence that could not be proved (the catalogue was unreadable) is not an
 * absence: it stays red as `FIXTURE_ABSENCE_UNPROVEN <kind>`. A selector bug
 * must never be swallowed into a non-verdict.
 */

export const PRODUCTION_LACKS_FIXTURE = 'PRODUCTION_LACKS_FIXTURE';
export const SELECTOR_MISSED_FIXTURE = 'SELECTOR_MISSED_FIXTURE';
export const FIXTURE_ABSENCE_UNPROVEN = 'FIXTURE_ABSENCE_UNPROVEN';

export type FixtureFormat = 'cash' | 'mtt' | 'spin' | 'sng';

/** The attributes a proof needs from its table: never "the first N". */
export interface FixtureRequirement {
  format: FixtureFormat;
  /** Physical seat count of the table, when the proof is about a layout. */
  capacity?: number;
  /** Seated players a table needs before it can be observed at all. */
  minSeated: number;
  /** Cash cluster mode, when the proof is about a cluster rule. */
  clusterMode?: 'must_move';
  /** Fixture scope: a table's club_id must be one of these. */
  clubIds: readonly string[];
}

/** One row of the tables catalogue, normalized from whichever read supplied it. */
export interface CatalogueTable {
  id: string;
  clubId: string | null;
  format: FixtureFormat | null;
  status: string | null;
  capacity: number | null;
  seated: number | null;
  clusterMode: string | null;
}

export function fixtureKind(requirement: FixtureRequirement): string {
  return [
    requirement.format,
    requirement.capacity ? `${requirement.capacity}-seat` : null,
    requirement.clusterMode ?? null,
    `${requirement.minSeated}+seated`,
    'running',
  ]
    .filter(Boolean)
    .join('/');
}

/** Does this catalogue row have every attribute the proof needs? */
export function matchesFixture(row: CatalogueTable, requirement: FixtureRequirement): boolean {
  return (
    row.format === requirement.format &&
    row.status === 'running' &&
    row.clubId !== null &&
    requirement.clubIds.includes(row.clubId) &&
    (requirement.capacity === undefined || row.capacity === requirement.capacity) &&
    (requirement.clusterMode === undefined || row.clusterMode === requirement.clusterMode) &&
    typeof row.seated === 'number' &&
    row.seated >= requirement.minSeated
  );
}

export type FixtureProof =
  | { verdict: 'absent'; kind: string; detail: string; catalogueMatches: string[] }
  | { verdict: 'missed'; kind: string; detail: string; missed: string[] }
  | { verdict: 'unproven'; kind: string; detail: string };

/**
 * Was there truly no table of this kind, or did the selector miss one?
 *
 * catalogue   the independent read of the tables catalogue (null: unreadable).
 * certifiable the catalogue matches the ENGINE also reports as dealing (null:
 *             no engine read; every catalogue match then counts as dealing).
 * considered  every table id the selector actually looked at.
 *
 * Absent only when no catalogue table of the kind is dealing, or every one
 * that is was considered by the selector and refused by the case's own rules.
 */
export function proveFixtureAbsence(input: {
  requirement: FixtureRequirement;
  catalogue: readonly CatalogueTable[] | null;
  catalogueError?: string | null;
  certifiable?: ReadonlySet<string> | null;
  considered: ReadonlySet<string>;
}): FixtureProof {
  const kind = fixtureKind(input.requirement);
  if (!input.catalogue)
    return {
      verdict: 'unproven',
      kind,
      detail: `the tables catalogue could not be read (${input.catalogueError || 'no rows'})`,
    };
  const matches = input.catalogue
    .filter((row) => matchesFixture(row, input.requirement))
    .map((row) => row.id);
  if (matches.length === 0)
    return {
      verdict: 'absent',
      kind,
      detail: `the tables catalogue lists no ${kind} table in fixture scope ${input.requirement.clubIds.join('/')}`,
      catalogueMatches: [],
    };
  const certifiable = input.certifiable;
  const dealing = certifiable ? matches.filter((id) => certifiable.has(id)) : matches;
  if (dealing.length === 0)
    return {
      verdict: 'absent',
      kind,
      detail: `the tables catalogue lists ${matches.length} ${kind} table(s) and the engine reports none of them dealing`,
      catalogueMatches: matches,
    };
  const missed = dealing.filter((id) => !input.considered.has(id));
  if (missed.length > 0)
    return {
      verdict: 'missed',
      kind,
      detail: `the tables catalogue and the engine show ${missed.length} dealing ${kind} table(s) the selector never considered: ${missed.join(', ')}`,
      missed,
    };
  return {
    verdict: 'absent',
    kind,
    detail: `every dealing ${kind} table (${dealing.length}) was considered and refused by this case's own requirements`,
    catalogueMatches: matches,
  };
}

export class ProductionLacksFixture extends Error {
  constructor(
    readonly kind: string,
    detail: string,
    readonly evidence: Record<string, unknown> = {}
  ) {
    super(`${PRODUCTION_LACKS_FIXTURE} ${kind}: ${detail}`);
    this.name = 'ProductionLacksFixture';
  }
}

/** The error a missing fixture throws: a non-verdict only when absence was proved. */
export function missingFixtureError(
  proof: FixtureProof,
  evidence: Record<string, unknown> = {}
): Error {
  if (proof.verdict === 'absent')
    return new ProductionLacksFixture(proof.kind, proof.detail, { ...evidence, proof });
  const marker = proof.verdict === 'missed' ? SELECTOR_MISSED_FIXTURE : FIXTURE_ABSENCE_UNPROVEN;
  return new Error(`${marker} ${proof.kind}: ${proof.detail}`);
}

function embedded(row: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = row[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Rows from the client's own cash catalogue read (ClubHomePage `tables` select). */
export function catalogueFromLobbyRows(rows: readonly unknown[]): CatalogueTable[] {
  return rows.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string') return [];
    const cluster = embedded(row, 'cluster');
    return [
      {
        id: row.id,
        clubId: typeof row.club_id === 'string' ? row.club_id : null,
        format: 'cash' as const,
        status: typeof row.status === 'string' ? row.status : null,
        capacity: typeof row.max_players === 'number' ? row.max_players : null,
        seated: typeof row.current_players === 'number' ? row.current_players : null,
        clusterMode: typeof cluster?.cluster_mode === 'string' ? cluster.cluster_mode : null,
      },
    ];
  });
}

const TOURNAMENT_TYPES: Record<string, FixtureFormat> = { MTT: 'mtt', SPIN: 'spin', SNG: 'sng' };

/** Rows from the service-role catalogue read in `readFixtureCatalogue`. */
export function catalogueFromServiceRows(
  rows: readonly unknown[],
  seatedByTable: ReadonlyMap<string, number>
): CatalogueTable[] {
  return rows.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string') return [];
    const tournament = embedded(row, 'tournament');
    const format: FixtureFormat | null = row.tournament_id
      ? (TOURNAMENT_TYPES[String(tournament?.tournament_type ?? '').toUpperCase()] ?? null)
      : 'cash';
    const cluster = embedded(row, 'cluster');
    return [
      {
        id: row.id,
        clubId: typeof row.club_id === 'string' ? row.club_id : null,
        format,
        status: typeof row.status === 'string' ? row.status : null,
        capacity: typeof row.max_players === 'number' ? row.max_players : null,
        seated: seatedByTable.get(row.id) ?? 0,
        clusterMode: typeof cluster?.cluster_mode === 'string' ? cluster.cluster_mode : null,
      },
    ];
  });
}

type CatalogueResult = { data: unknown[] | null; error: { message: string } | null };
/** The minimal read surface of a supabase-js client this module uses. */
export interface CatalogueQuery extends PromiseLike<CatalogueResult> {
  select(columns: string): CatalogueQuery;
  eq(column: string, value: unknown): CatalogueQuery;
  in(column: string, values: readonly unknown[]): CatalogueQuery;
  is(column: string, value: null): CatalogueQuery;
  gt(column: string, value: number): CatalogueQuery;
  not(column: string, operator: string, value: unknown): CatalogueQuery;
  or(filters: string): CatalogueQuery;
  limit(count: number): CatalogueQuery;
}
export interface CatalogueReader {
  from(table: string): CatalogueQuery;
}

/**
 * The independent read: running tables of the needed format in fixture scope,
 * with seated players counted from table_seats (left_at null, stack > 0),
 * through the service role. Never the lobby DOM and never the engine, which
 * are what the selector itself read.
 */
export async function readFixtureCatalogue(
  db: CatalogueReader,
  requirement: FixtureRequirement
): Promise<{ catalogue: CatalogueTable[] | null; error: string | null }> {
  let query = db
    .from('tables')
    .select(
      'id,club_id,status,max_players,tournament_id,' +
        'cluster:cash_games!tables_cluster_id_fkey(cluster_mode),' +
        'tournament:tournaments!tables_tournament_id_fkey(tournament_type)'
    )
    .in('club_id', requirement.clubIds)
    .eq('status', 'running')
    .or('is_deleted.is.null,is_deleted.eq.false')
    .limit(1000);
  query =
    requirement.format === 'cash'
      ? query.is('tournament_id', null)
      : query.not('tournament_id', 'is', null);
  if (requirement.capacity !== undefined) query = query.eq('max_players', requirement.capacity);
  const tables = await query;
  if (tables.error || !tables.data)
    return { catalogue: null, error: tables.error?.message ?? 'no rows' };
  const ids = tables.data
    .map((row) => (row as Record<string, unknown>)?.id)
    .filter((id): id is string => typeof id === 'string');
  const seated = new Map<string, number>();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const seats = await db
      .from('table_seats')
      .select('table_id')
      .in('table_id', ids.slice(offset, offset + 200))
      .is('left_at', null)
      .gt('stack', 0)
      .limit(10_000);
    if (seats.error || !seats.data)
      return { catalogue: null, error: seats.error?.message ?? 'no seats' };
    for (const seat of seats.data) {
      const id = (seat as Record<string, unknown>)?.table_id;
      if (typeof id === 'string') seated.set(id, (seated.get(id) ?? 0) + 1);
    }
  }
  return { catalogue: catalogueFromServiceRows(tables.data, seated), error: null };
}

/**
 * Seat-move destinations by kind: a distinct table whose recorded role is
 * 'main' (the must-move destination), and a distinct named non-main table
 * (the seat-change destination whose own name is announced).
 */
export function selectSeatMoveDestinations<T extends { id: string; name: string }>(
  catalogue: readonly T[],
  sourceId: string,
  isMain: (table: T) => boolean
): { main: T; other: T } | null {
  const main = catalogue.find((table) => table.id !== sourceId && isMain(table));
  const other = catalogue.find(
    (table) => table.id !== sourceId && table.id !== main?.id && !isMain(table) && table.name.trim()
  );
  return main && other ? { main, other } : null;
}

/**
 * The independent count behind a missing seat-move destination: the proof
 * needs a role=main table and a distinct named non-main table besides its
 * subject.
 */
export function proveSeatMoveDestinationAbsence<T extends { id: string; name: string }>(
  catalogue: readonly T[],
  sourceId: string,
  isMain: (table: T) => boolean
): FixtureProof {
  const kind = 'cash/second-destination-table';
  const others = catalogue.filter((table) => table.id !== sourceId);
  const mains = new Set(others.filter((table) => isMain(table)).map((table) => table.id));
  const nonMains = new Set(
    others.filter((table) => !isMain(table) && table.name.trim()).map((table) => table.id)
  );
  if (mains.size === 0 || nonMains.size === 0)
    return {
      verdict: 'absent',
      kind,
      detail: `the cash catalogue lists ${mains.size} role=main table(s) and ${nonMains.size} named non-main table(s) besides the subject; the proof needs one of each`,
      catalogueMatches: [...new Set([...mains, ...nonMains])],
    };
  return {
    verdict: 'missed',
    kind,
    detail: `the cash catalogue lists ${mains.size} role=main table(s) and ${nonMains.size} named non-main table(s) besides the subject, yet no main/other pair was chosen`,
    missed: [...new Set([...mains, ...nonMains])],
  };
}

/**
 * The independent read behind a missing cash subject: the client's own cash
 * catalogue (status, current_players and the cluster join), not the lobby
 * cards the selector read. A null catalogue (the read was not observed) is an
 * unproven absence and stays red.
 */
export function proveCashSubjectAbsence(
  candidateIds: Iterable<string>,
  lobbyRows: readonly unknown[] | null,
  clusterMode?: 'must_move'
): FixtureProof {
  const catalogue = lobbyRows ? catalogueFromLobbyRows(lobbyRows) : null;
  const clubIds = [
    ...new Set(
      (catalogue ?? []).map((row) => row.clubId).filter((id): id is string => Boolean(id))
    ),
  ];
  return proveFixtureAbsence({
    requirement: { format: 'cash', minSeated: 2, clubIds, ...(clusterMode ? { clusterMode } : {}) },
    catalogue,
    catalogueError: lobbyRows ? null : 'the client cash catalogue read was not observed',
    considered: new Set(candidateIds),
  });
}

/** The classic hero proofs need a must-move cluster table, running with 2+ seated. */
export function proveClassicCashSourceAbsence(
  candidates: readonly { id: string }[],
  lobbyRows: readonly unknown[]
): FixtureProof {
  return proveCashSubjectAbsence(
    candidates.map((candidate) => candidate.id),
    lobbyRows,
    'must_move'
  );
}
