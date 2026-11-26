import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup } from '@testing-library/react';
import { ClubCardPanel } from '@/components/club/ClubCardPanel';
import { resetLobbyFigureCacheForTests } from '@/lib/lobbyFigureCache';

/**
 * Dan, 2026-11-12: "WHY DOES IT SAY 2 CASH - 0 EVENTS ON THE BOTTOM? IT SHOULD
 * BE SAYING MANY HANDS ARE IN THE MIDWAY UNION."
 *
 * A club that joins a union has no floor of its own (HARD RULE: every club
 * cash game and tournament is removed before it joins). Its players sit at the
 * union's tables, so the CASH / EVENTS split on a member club's card counts the
 * union floor and names the union over it.
 */
describe('a union member club card splits the union floor', () => {
  beforeEach(() => {
    resetLobbyFigureCacheForTests();
    cleanup();
  });

  it('names the union and prints the union floor split', () => {
    render(
      <ClubCardPanel
        clubName="HARBOR"
        totalMembers={146}
        clubLevel={19}
        activePlayers={2}
        activeCash={222}
        activeEvents={243}
        clubId={25453}
        splitFloorLabel="MIDWAY UNION"
        floorPlaying={306}
      />
    );
    const floor = document.querySelector('.club-card-stat-split-floor');
    // Dan 2026-11-17: the union figure is named with its union, never as the
    // club's ACTIVE, which stays the club's own measured figure.
    expect(floor?.textContent).toBe('306 PLAYERS ACTIVE ACROSS THE MIDWAY UNION');
    const active = document.querySelector(
      '.club-card-stat--active .club-card-stat-value, .club-card-stat-value.sc-ink--green'
    );
    expect(active?.textContent).toBe('2');
    const parts = Array.from(document.querySelectorAll('.club-card-stat-split-part')).map((el) =>
      el.textContent?.trim()
    );
    expect(parts).toEqual(['222 CASH', '243 EVENTS']);
  });

  it('a standalone club prints no union name', () => {
    render(
      <ClubCardPanel
        clubName="STANDALONE"
        totalMembers={10}
        clubLevel={1}
        activePlayers={3}
        activeCash={3}
        activeEvents={0}
        clubId={99901}
      />
    );
    expect(document.querySelector('.club-card-stat-split-floor')).toBeNull();
  });

  it('the home page feeds member clubs the union floor RPC', () => {
    const src = readFileSync(resolve(__dirname, '../../src/pages/HomePage.tsx'), 'utf8');
    const block = src.slice(src.indexOf('memberClubUnion'));
    expect(src).toMatch(/'id, union_id, settings, member_count/);
    expect(block).toMatch(/fn_batch_union_realtime_active_counts/);
    expect(block).toMatch(/splitFloorLabel/);
  });
});
