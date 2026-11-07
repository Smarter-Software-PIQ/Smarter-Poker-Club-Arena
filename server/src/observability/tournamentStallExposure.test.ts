import { expect, it } from 'vitest';
import { tournamentStallExposure } from './tournamentStallExposure.js';

it('separates satellite impact, planned pauses, unrelated waits and actual held seats', () => {
  const base = {
    tableId: 'a',
    gameFormat: 'mtt' as const,
    seated: 6,
    dealable: 6,
    paused: false,
    msSinceProgress: 60000,
  };
  const lines = tournamentStallExposure(
    [
      base,
      { ...base, tableId: 'b', satellite: true, gameFormat: 'sng', msSinceProgress: 240000 },
      { ...base, tableId: 'c', paused: true, satellite: true },
      { ...base, tableId: 'd', dealable: 0, paused: true, satellite: true },
      { ...base, tableId: 'e', gameFormat: 'cash' },
      { ...base, tableId: 'f', gameFormat: null },
      { ...base, tableId: 'g', gameFormat: 'spin', msSinceProgress: 59999 },
      { ...base, tableId: 'h', gameFormat: 'sng', dealable: 1 },
    ],
    new Map([['d', 130000]])
  );
  expect(lines).toHaveLength(16);
  expect(lines).toContain('poker_tournament_observed_active_tables{format="satellite"} 2');
  expect(lines).toContain('poker_tournament_observed_stalled_tables{format="satellite"} 2');
  expect(lines).toContain('poker_tournament_observed_stalled_seats{format="satellite"} 12');
  expect(lines).toContain('poker_tournament_observed_longest_stall_ms{format="satellite"} 240000');
  expect(lines).toContain('poker_tournament_observed_stalled_tables{format="mtt"} 1');
  expect(lines).toContain('poker_tournament_observed_active_tables{format="sng"} 0');
  expect(lines).toContain('poker_tournament_observed_active_tables{format="spin"} 1');
  expect(lines).toContain('poker_tournament_observed_stalled_tables{format="spin"} 0');
});
