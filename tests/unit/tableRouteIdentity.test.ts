import { describe, expect, it } from 'vitest';
import { tableRouteIdentity } from '../e2e/support/tableRouteIdentity';

const table = 'https://smarter.poker/hub/club-arena/table/e78717a2-294d-4b8f-a6ce-d42ec54b237f';

describe('a spectator stays on the same table route', () => {
  it('accepts the existing tableQuery display hints after Close Lobby', () => {
    expect(tableRouteIdentity(`${table}?name=nlh+1%2F2&stakes=1%2F2&code=NLH`)).toBe(table);
    expect(tableRouteIdentity(`${table}?code=NLH&name=Updated&stakes=2%2F4`)).toBe(table);
  });

  it.each([
    table.replace('e78717a2', 'e78717a3'),
    table.replace('smarter.poker', 'example.invalid'),
    table.replace('/table/', '/tournaments/'),
    `${table}?followPlayer=another-player`,
    `${table}?watch=1`,
    `${table}#another-surface`,
  ])('rejects a changed table, origin, page or navigation intent: %s', (changed) => {
    expect(tableRouteIdentity(changed)).not.toBe(tableRouteIdentity(table));
  });

  it('preserves existing watch intent when adding display hints', () => {
    const watched = `${table}?followTournament=event&followPlayer=player`;
    expect(tableRouteIdentity(`${watched}&name=NLH&code=NLH`)).toBe(tableRouteIdentity(watched));
    expect(tableRouteIdentity(`${table}?followTournament=event&followPlayer=other`)).not.toBe(
      tableRouteIdentity(watched)
    );
  });
});
