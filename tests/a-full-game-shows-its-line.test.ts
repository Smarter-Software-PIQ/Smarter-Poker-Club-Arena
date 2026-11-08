/**
 * Dan 2026-11-08: "STATUS SHOULD JUST SAY HOW MANY TABLES NOT 'WAITLIST 3'
 * UNDER IT." (Replaces the 2026-11-06/07 labels that printed the list.)
 *
 * A running must-move game's status names its tables only. The status KEY
 * stays 'running' so the card keeps the game's own Join Game door (which
 * queues the player on the game list) instead of the single-table waitlist.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clusterRunningStatus } from '../src/components/lobby/lobbyEntries';
import { premiumStatusBadge } from '../src/components/lobby/game-cards/premiumStatus';

describe('a running game status says how many tables, never the list', () => {
  it('names a second table, else Running, whatever the list holds', () => {
    expect(clusterRunningStatus(1, 3)).toEqual({ key: 'running', label: 'Running' });
    expect(clusterRunningStatus(2, 2)).toEqual({ key: 'running', label: '2 Tables' });
    expect(clusterRunningStatus(13, 4)).toEqual({ key: 'running', label: '13 Tables' });
    expect(clusterRunningStatus(2, 0)).toEqual({ key: 'running', label: '2 Tables' });
    expect(clusterRunningStatus(1, 0)).toEqual({ key: 'running', label: 'Running' });
  });

  it('never prints a waitlist in a running status', () => {
    for (const tables of [1, 2, 9]) {
      for (const waiting of [0, 1, 3, 12]) {
        expect(clusterRunningStatus(tables, waiting).label).not.toMatch(/Waitlist/i);
      }
    }
  });

  it('the card prints the table count rather than a flat Running', () => {
    expect(premiumStatusBadge({ status: 'running', statusLabel: '2 Tables' }).label).toBe(
      '2 Tables'
    );
    expect(
      premiumStatusBadge({ status: 'running', statusLabel: '2 Tables · Waitlist 4' }).label
    ).toBe('Running');
    expect(premiumStatusBadge({ status: 'running', statusLabel: 'Waitlist 3' }).label).toBe(
      'Running'
    );
    expect(premiumStatusBadge({ status: 'running', statusLabel: 'anything' }).label).toBe(
      'Running'
    );
  });
});

describe('the count is live (2026-11-07)', () => {
  const page = readFileSync(resolve(__dirname, '../src/pages/ClubHomePage.tsx'), 'utf8');
  const sql = readFileSync(
    resolve(
      __dirname,
      '../supabase/migrations/20261107140215_the_waiting_list_has_names_and_live_counts.sql'
    ),
    'utf8'
  );
  it('every list change broadcasts its game, and the board re-reads on it', () => {
    expect(sql).toContain("'changed', 'cash-game-waitlist', false");
    expect(sql).toContain(
      'AFTER INSERT OR DELETE OR UPDATE OF status ON public.cash_game_waitlist'
    );
    expect(page).toContain(".channel('cash-game-waitlist')");
    expect(page).toContain("on('broadcast', { event: 'changed' }");
    expect(page).toContain('if (channel) void supabase.removeChannel(channel)');
    expect(page).toContain("typeof supabase.channel === 'function'");
  });
});
