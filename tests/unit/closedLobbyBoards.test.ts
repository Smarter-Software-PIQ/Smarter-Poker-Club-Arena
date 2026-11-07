import { expect, it } from 'vitest';
import { closedBoardEvidence, observedLobbyCatalog } from '../e2e/support/closedLobbyBoards';

const catalog = [{ format_contract: 'mtt-v2' }];
const at = (hour: string) => new Date('2026-11-07T' + hour + ':00-06:00');

it.each(['spins', 'sng'])('certifies an empty %s board only within the Chicago closure', (mode) => {
  expect(closedBoardEvidence(mode, catalog, at('02:59'))).toBeNull();
  for (const time of ['03:00', '04:14', '05:59']) {
    expect(closedBoardEvidence(mode, catalog, at(time))).toMatchObject({
      outcome: 'scheduled-closure',
      catalogRows: 1,
      formatRows: 0,
    });
  }
  expect(closedBoardEvidence(mode, catalog, at('06:00'))).toBeNull();
  expect(
    closedBoardEvidence(
      mode,
      [{ format_contract: mode === 'spins' ? 'spin-v1' : 'sng-v1' }],
      at('04:14')
    )
  ).toBeNull();
});

it('preserves positive checks for other formats and refuses incomplete catalog evidence', async () => {
  expect(closedBoardEvidence('mtt', catalog, at('04:14'))).toBeNull();
  expect(() => closedBoardEvidence('spins', [{}], at('04:14'))).toThrow('Unclassified tournament');
  await expect(observedLobbyCatalog([])).rejects.toThrow('Missing first scoped');
});
