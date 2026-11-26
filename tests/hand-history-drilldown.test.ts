import { describe, expect, it } from 'vitest';
import {
  filterHandsByStatsDrilldown,
  readStatsDrilldown,
  statsEvidenceQueryFromDrilldown,
  statsEvidenceWindow,
} from '../src/lib/handHistoryDrilldown';

const hand = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'hand-1',
    played_at: '2026-08-30T12:00:00Z',
    game_type: 'NLH',
    stakes: '0.50 / 1',
    players: [{ user_id: 'player-1', position: 'BTN' }],
    ...overrides,
  }) as any;

describe('Stats to hand-history drilldowns', () => {
  it('reads only supported query parameters', () => {
    const params = new URLSearchParams(
      'source=stats&variant=plo4&position=BTN&bigBlind=2&from=2026-08-01&to=2026-08-30&ignored=x'
    );
    expect(readStatsDrilldown(params)).toEqual({
      variant: 'plo4',
      position: 'BTN',
      bigBlind: 2,
      from: '2026-08-01',
      to: '2026-08-30',
    });
  });

  it.each([
    ['2026-03-09T03:30:00Z', '2026-03-08T08:00:00.000Z', '2026-03-09T07:00:00.000Z'],
    ['2026-11-02T06:30:00Z', '2026-11-01T07:00:00.000Z', '2026-11-02T08:00:00.000Z'],
  ])('carries the displayed local day through the evidence query at %s', (asOf, start, end) => {
    const bounds = statsEvidenceWindow(1, 'America/Los_Angeles', asOf);
    expect(bounds).toEqual({ from: start, to: end });
    const drill = readStatsDrilldown(new URLSearchParams(bounds));
    expect(statsEvidenceQueryFromDrilldown(drill)).toMatchObject({ from: start, to: end });
    expect(
      filterHandsByStatsDrilldown(
        [
          hand({ id: 'previous', played_at: new Date(Date.parse(start) - 1).toISOString() }),
          hand({ id: 'first', played_at: start }),
          hand({ id: 'last', played_at: new Date(Date.parse(end) - 1).toISOString() }),
          hand({ id: 'next', played_at: end }),
        ],
        drill,
        'player-1'
      ).map((row) => row.id)
    ).toEqual(['first', 'last']);
  });

  it('uses the recorded cash opportunity cutoff even when a newer report crossed midnight', () => {
    expect(
      statsEvidenceWindow(
        7,
        'America/Los_Angeles',
        '2026-11-10T20:00:00Z',
        '2026-10-29T07:00:00+00:00'
      )
    ).toEqual({
      from: '2026-10-29T07:00:00+00:00',
      to: '2026-11-05T08:00:00.000Z',
    });
    expect(statsEvidenceWindow(null, 'America/Los_Angeles', '2026-11-10T20:00:00Z')).toEqual({});
  });

  it('filters by game, stake, position, and inclusive date without inventing data', () => {
    const hands = [
      hand(),
      hand({ id: 'wrong-game', game_type: 'PLO4' }),
      hand({ id: 'wrong-stake', stakes: '1 / 2' }),
      hand({ id: 'wrong-position', players: [{ user_id: 'player-1', position: 'CO' }] }),
      hand({ id: 'too-old', played_at: '2026-07-31T23:59:59Z' }),
    ];

    expect(
      filterHandsByStatsDrilldown(
        hands,
        { variant: 'holdem', position: 'BTN', bigBlind: 1, from: '2026-08-01', to: '2026-08-30' },
        'player-1'
      ).map((row) => row.id)
    ).toEqual(['hand-1']);
  });

  it('ignores malformed filters and preserves an unfiltered archive', () => {
    const params = new URLSearchParams(
      'variant=%20&position=%20&bigBlind=not-a-number&from=08-01-2026&to=tomorrow'
    );

    expect(readStatsDrilldown(params)).toEqual({});
    expect(filterHandsByStatsDrilldown([hand()], {}, 'player-1')).toHaveLength(1);
  });

  it('normalizes common game aliases and rejects missing stake or invalid dates', () => {
    const hands = [
      hand({ id: 'omaha', game_type: 'Omaha', stakes: '1 / 2' }),
      hand({ id: 'plo', game_type: 'PLO', stakes: '1 / 2' }),
      hand({ id: 'missing-stake', game_type: 'PLO4', stakes: '' }),
      hand({ id: 'invalid-date', game_type: 'PLO4', stakes: '1 / 2', played_at: 'unknown' }),
    ];

    expect(
      filterHandsByStatsDrilldown(hands, { variant: 'plo4', bigBlind: 2 }, 'player-1').map(
        (row) => row.id
      )
    ).toEqual(['omaha', 'plo', 'invalid-date']);

    expect(
      filterHandsByStatsDrilldown(
        hands,
        { variant: 'plo4', bigBlind: 2, from: '2026-08-01' },
        'player-1'
      ).map((row) => row.id)
    ).toEqual(['omaha', 'plo']);
  });
});
