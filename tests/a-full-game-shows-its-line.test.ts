/**
 * Dan 2026-11-06: "IT LOOKS FAKE WHEN THERE ARE THE EXACT MAX AMOUNT OF PLAYERS
 * ON EVERY GAME, AND ZERO PLAYERS ON THE WAITING LIST."
 *
 * A running must-move game names its list, then a second table. The status
 * KEY stays 'running' so the card keeps the game's own Join Game door (which
 * queues the player on the game list) instead of the single-table waitlist.
 */
import { describe, it, expect } from 'vitest';
import { clusterRunningStatus } from '../src/components/lobby/lobbyEntries';
import { premiumStatusBadge } from '../src/components/lobby/game-cards/premiumStatus';

describe('a running game shows its waiting list and its tables', () => {
  it('names the list first, then a second table, else Running', () => {
    expect(clusterRunningStatus(1, 3)).toEqual({ key: 'running', label: 'Waitlist 3' });
    expect(clusterRunningStatus(2, 2)).toEqual({ key: 'running', label: 'Waitlist 2' });
    expect(clusterRunningStatus(2, 0)).toEqual({ key: 'running', label: '2 Tables' });
    expect(clusterRunningStatus(1, 0)).toEqual({ key: 'running', label: 'Running' });
  });

  it('the card prints those labels rather than a flat Running', () => {
    expect(premiumStatusBadge({ status: 'running', statusLabel: 'Waitlist 3' }).label).toBe(
      'Waitlist 3'
    );
    expect(premiumStatusBadge({ status: 'running', statusLabel: '2 Tables' }).label).toBe(
      '2 Tables'
    );
    expect(premiumStatusBadge({ status: 'running', statusLabel: 'anything' }).label).toBe(
      'Running'
    );
  });
});
