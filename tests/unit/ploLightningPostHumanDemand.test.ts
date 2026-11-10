import { describe, expect, it } from 'vitest';
import {
  GAME,
  requirePostHumanDemand,
  requirePostHumanGameplay,
} from '../../scripts/ci/verify-plo-lightning-lifecycle.mjs';
const chosen = {
  game_id: GAME,
  event_id: '00000000-0000-4000-8000-000000000001',
  continues: true,
  wind_down: false,
};
describe('the finite live proof binds the original post-human choice', () => {
  it('accepts either branch and keeps it stable', () => {
    expect(requirePostHumanDemand(chosen, chosen, chosen.event_id)).toEqual(chosen);
    expect(() =>
      requirePostHumanDemand(chosen, undefined, '00000000-0000-4000-8000-000000000002')
    ).toThrow('owned original occupancy');
    const down = { ...chosen, continues: false, wind_down: true };
    expect(requirePostHumanDemand(down, down)).toEqual(down);
  });
  it('refuses missing, contradictory or rerolled evidence', () => {
    for (const value of [
      null,
      { ...chosen, event_id: null },
      { ...chosen, wind_down: true },
      { ...chosen, continues: false },
    ])
      expect(() => requirePostHumanDemand(value)).toThrow();
    expect(() =>
      requirePostHumanDemand({ ...chosen, continues: false, wind_down: true }, chosen)
    ).toThrow('rerolled');
    expect(() =>
      requirePostHumanDemand(
        { ...chosen, event_id: '00000000-0000-4000-8000-000000000002' },
        chosen
      )
    ).toThrow('rerolled');
  });
});

describe('the live proof preserves valid feeder play and gradual wind-down', () => {
  const exitAt = '2026-11-10T03:00:00Z';
  const continued = Array.from({ length: 3 }, (_, i) => ({
    host_table_id: 'front',
    hand_number: i + 1,
  }));
  const late = {
    tableId: 'feeder',
    handNumber: 4,
    startedAt: '2026-11-10T03:06:10Z',
    endedAt: '2026-11-10T03:06:50Z',
    playerCount: 2,
    includesTestPlayer: false,
  };
  const samples = [
    { at: '2026-11-10T03:00:01Z', participants: 9 },
    { at: '2026-11-10T03:04:00Z', participants: 5 },
    { at: '2026-11-10T03:08:00Z', participants: 1 },
  ];
  it('accepts a later conserved physical hand after a safe return to feeder play', () => {
    expect(
      requirePostHumanGameplay({
        decision: { ...chosen, continues: false, wind_down: true },
        continued,
        hands: [late],
        exitAt,
        samples: [samples[0], { ...samples[2], participants: 3 }],
      })
    ).toEqual(late);
  });
  it('accepts verified empty demand only for the original wind-down decision', () => {
    const down = { ...chosen, continues: false, wind_down: true },
      ended = { ...down, wind_down: false };
    expect(requirePostHumanDemand(ended, down, down.event_id, true)).toEqual(ended);
    expect(() => requirePostHumanDemand(ended, down, down.event_id)).toThrow();
    expect(() => requirePostHumanDemand(ended, chosen, chosen.event_id, true)).toThrow();
  });
  it('accepts a gradual terminal decline, and rejects immediate collapse or a silent continuing game', () => {
    const down = { ...chosen, continues: false, wind_down: true };
    expect(
      requirePostHumanGameplay({ decision: down, continued, hands: [], exitAt, samples })
    ).toEqual({ tableId: 'front', handNumber: 3 });
    expect(() =>
      requirePostHumanGameplay({
        decision: down,
        continued,
        hands: [],
        exitAt,
        samples: [samples[0], samples[2]],
      })
    ).toThrow('gradual');
    expect(() =>
      requirePostHumanGameplay({ decision: chosen, continued, hands: [], exitAt, samples })
    ).toThrow('gameplay');
    const early = [
      samples[0],
      { at: '2026-11-10T03:00:05Z', participants: 8 },
      { at: '2026-11-10T03:00:10Z', participants: 0 },
      { at: '2026-11-10T03:08:00Z', participants: 0 },
    ];
    expect(() =>
      requirePostHumanGameplay({ decision: down, continued, hands: [], exitAt, samples: early })
    ).toThrow('burst');
    expect(() =>
      requirePostHumanGameplay({ decision: down, continued: [], hands: [late], exitAt, samples })
    ).toThrow('Lightning');
    expect(() =>
      requirePostHumanGameplay({
        decision: down,
        continued,
        hands: [{ ...late, includesTestPlayer: true }],
        exitAt,
        samples,
      })
    ).toThrow('Stopped');
  });
});
