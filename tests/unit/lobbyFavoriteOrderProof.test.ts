import { describe, expect, it } from 'vitest';
import { sameUnchangedLobbyOrder } from '../e2e/support/lobbyFavoriteOrderProof';

const row = (id: string, players: number) => ({
  id,
  sortKey: JSON.stringify([id, '40', players, '2026-11-08T00:00:00Z', false]),
});

describe('favorite order causality on a live catalog', () => {
  const before = [row('bounty', 2), row('freezeout', 0), row('chosen', 0)];
  const live = [row('freezeout', 4), row('bounty', 2), row('chosen', 0)];

  it('accepts the captured equal-price player tiebreak change, which stale ID order rejects', () => {
    expect(live.map((r) => r.id)).not.toEqual(before.map((r) => r.id));
    expect(sameUnchangedLobbyOrder(live, before, 'chosen')).toBe(true);
  });

  it('still refuses favorite promotion even alongside that live update', () => {
    expect(sameUnchangedLobbyOrder([live[2], live[0], live[1]], before, 'chosen')).toBe(false);
  });

  it('refuses missing, changed or unopposed selected rows instead of claiming order proof', () => {
    expect(sameUnchangedLobbyOrder(live.slice(0, 2), before, 'chosen')).toBe(false);
    expect(sameUnchangedLobbyOrder([row('chosen', 1), live[1]], before, 'chosen')).toBe(false);
    expect(sameUnchangedLobbyOrder([live[2]], before, 'chosen')).toBe(false);
  });

  it('permits disappeared occurrences while retaining the selected row and a stable peer', () => {
    expect(sameUnchangedLobbyOrder([live[1], live[2]], before, 'chosen')).toBe(true);
  });
});
