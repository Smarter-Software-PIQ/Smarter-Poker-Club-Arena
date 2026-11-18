import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ClubCardPanel } from '@/components/club/ClubCardPanel';
import { resetLobbyFigureCacheForTests } from '@/lib/lobbyFigureCache';

describe('the union floor activity line', () => {
  beforeEach(() => {
    resetLobbyFigureCacheForTests();
    cleanup();
  });

  const floorText = () => document.querySelector('.club-card-stat-split-floor')?.textContent;

  it('prints the live Midway activity with the updated language', () => {
    render(
      <ClubCardPanel
        clubName="HARBOR"
        totalMembers={153}
        clubLevel={19}
        activePlayers={1}
        activeCash={80}
        activeEvents={267}
        clubId={25453}
        splitFloorLabel="MIDWAY UNION"
        floorPlaying={526}
      />
    );
    expect(floorText()).toBe('526 PLAYERS ACTIVE ACROSS THE MIDWAY UNION');
  });

  it('keeps singular wording for a different union', () => {
    render(
      <ClubCardPanel
        clubName="HARBOR"
        totalMembers={9}
        clubLevel={2}
        activePlayers={1}
        activeCash={1}
        activeEvents={0}
        clubId={25453}
        splitFloorLabel="NORTH STAR UNION"
        floorPlaying={1}
      />
    );
    expect(floorText()).toBe('1 PLAYER ACTIVE ACROSS NORTH STAR UNION');
  });

  it('prints no union total when it was not read, never a zero', () => {
    render(
      <ClubCardPanel
        clubName="HARBOR"
        totalMembers={153}
        clubLevel={19}
        activePlayers={1}
        activeCash={80}
        activeEvents={267}
        clubId={25453}
        splitFloorLabel="MIDWAY UNION"
        floorPlaying={null}
      />
    );
    expect(floorText()).toBe('MIDWAY UNION');
  });
});
