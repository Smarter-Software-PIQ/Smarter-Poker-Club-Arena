import type { Response } from '@playwright/test';
import { spinSngBoardsOpen } from '../../../server/src/maintenance/dailyWindow';
import { readTournamentLobbyWindow } from '../../../src/utils/tournamentLobbyRead';
import { getTournamentFormatKind } from '../../../src/utils/tournamentPresentation';

export function isLobbyCatalogResponse(response: Response) {
  const url = new URL(response.url());
  const query = url.searchParams;
  return (
    url.pathname.endsWith('/rest/v1/tournaments') &&
    query.get('order') === 'id.asc' &&
    query.has('start_time') &&
    query
      .get('select')
      ?.split(',')
      .map((field) => field.trim())
      .includes('format_contract') &&
    (query.has('club_id') || query.has('or'))
  );
}

export async function observedLobbyCatalog(responses: { response: Response; at: Date }[]) {
  const first = responses
    .map(({ response }) => !new URL(response.url()).searchParams.has('id'))
    .lastIndexOf(true);
  if (first < 0) throw new Error('Missing first scoped lobby catalog response');
  const pages = responses.slice(first);
  const scope = new URL(pages[0].response.url());
  scope.searchParams.delete('id');
  const result = await readTournamentLobbyWindow<{ id: string; format_contract: unknown }>(
    async (after) => {
      const page = pages.shift()?.response;
      if (!page || !page.ok()) throw new Error('Missing successful lobby catalog page');
      const url = new URL(page.url());
      const cursor = url.searchParams.get('id');
      url.searchParams.delete('id');
      if (url.href !== scope.href || cursor !== (after ? 'gt.' + after : null))
        throw new Error('Lobby catalog page scope or cursor changed');
      const total = /\/(\d+)$/.exec((await page.headerValue('content-range')) ?? '');
      if (!total) throw new Error('Missing exact lobby catalog count');
      return { data: await page.json(), count: Number(total[1]), error: null };
    }
  );
  if (result.error || !result.data) throw result.error ?? new Error('Incomplete lobby catalog');
  return { rows: result.data, at: responses[first].at };
}

export function closedBoardEvidence(mode: string, rows: unknown[], at: Date) {
  if ((mode !== 'spins' && mode !== 'sng') || spinSngBoardsOpen(at)) return null;
  const kinds = rows.map(getTournamentFormatKind);
  if (kinds.includes('unknown')) throw new Error('Unclassified tournament in scoped lobby catalog');
  if (kinds.includes(mode === 'spins' ? 'spin' : 'sng')) return null;
  return {
    mode,
    outcome: 'scheduled-closure',
    observedAt: at.toISOString(),
    catalogRows: rows.length,
    formatRows: 0,
  };
}
