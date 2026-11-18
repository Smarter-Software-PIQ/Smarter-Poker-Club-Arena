import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ClubCardPanel } from '@/components/club/ClubCardPanel';
import { resetLobbyFigureCacheForTests } from '@/lib/lobbyFigureCache';

/**
 * Dan 2026-11-17: "Keep the union count inclusive of legitimate Horse accounts,
 * but label it clearly ... Do not imply 296 humans. Use dynamic values."
 *
 * The union line on a member club's card says "INCLUDES HORSES" only when the
 * count it prints holds at least one Horse, and the club's ACTIVE stays its own.
 */
describe('the union floor line names its Horses', () => {
  beforeEach(() => {
    resetLobbyFigureCacheForTests();
    cleanup();
  });

  const floorText = () => document.querySelector('.club-card-stat-split-floor')?.textContent;

  it('says so when Horses are in the count', () => {
    render(
      <ClubCardPanel
        clubName="KINGS CLUB"
        totalMembers={153}
        clubLevel={19}
        activePlayers={1}
        activeCash={80}
        activeEvents={267}
        clubId={25450}
        splitFloorLabel="MIDWAY UNION"
        floorPlaying={296}
        floorHorses={294}
      />
    );
    expect(floorText()).toBe('296 PLAYERS ACROSS MIDWAY UNION · INCLUDES HORSES');
  });

  it('says nothing about Horses when none are counted, and keeps singular wording', () => {
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
        floorHorses={0}
      />
    );
    expect(floorText()).toBe('1 PLAYER ACROSS NORTH STAR UNION');
  });

  it('prints no union total when it was not read, never a zero', () => {
    render(
      <ClubCardPanel
        clubName="KINGS CLUB"
        totalMembers={153}
        clubLevel={19}
        activePlayers={1}
        activeCash={80}
        activeEvents={267}
        clubId={25450}
        splitFloorLabel="MIDWAY UNION"
        floorPlaying={null}
        floorHorses={null}
      />
    );
    expect(floorText()).toBe('MIDWAY UNION');
  });
});
