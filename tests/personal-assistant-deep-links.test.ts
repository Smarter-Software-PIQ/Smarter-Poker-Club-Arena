import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Club Arena Personal Assistant cross-app deep-link contracts', () => {
  it('HandHistoryPage preserves linked hand id, format, variant classification, and source prefixes when exchanging links with Personal Assistant', () => {
    const src = readFileSync(resolve('src/pages/HandHistoryPage.tsx'), 'utf8');
    expect(src).toContain("searchParams.get('source') === 'personal-assistant'");
    expect(src).toContain(".startsWith('personal-assistant-')");
    expect(src).toContain("params.set('hand', linkedHandId);");
    expect(src).toContain("params.set('source', 'club-arena');");
    expect(src).toContain("params.set('leak', returnLeakId);");
    expect(src).toContain(
      '/hub/personal-assistant/leaks?source=club-arena&hand=${encodeURIComponent(hand.id)}&format=${formatParam}'
    );
    expect(src).toContain("const formatParam = hand.tournamentId ? 'tournament' : 'cash';");
    expect(src).toContain('short.?deck|6\\+|plo|omaha|ofc');
    expect(src).toContain("variantText === 'nl'");
  });

  it('PlayerStatsPage forwards active Cash/Tournament format and wires TournamentPlayingStats to Personal Assistant Leak Finder', () => {
    const statsSrc = readFileSync(resolve('src/pages/PlayerStatsPage.tsx'), 'utf8');
    const tourneyStatsSrc = readFileSync(
      resolve('src/pages/stats/TournamentPlayingStats.tsx'),
      'utf8'
    );
    expect(statsSrc).toContain(
      '/hub/personal-assistant/leaks?source=club-arena-stats${formatQuery}'
    );
    expect(statsSrc).toContain(
      "gameMode === 'cash' || gameMode === 'tournament' ? `&format=${gameMode}` : ''"
    );
    expect(statsSrc).toContain('onOpenLeakFinder={isOwnProfile ? openLeakFinder : undefined}');
    expect(tourneyStatsSrc).toContain('Analyze Tournament Leaks');
    expect(tourneyStatsSrc).toContain('onOpenLeakFinder');
  });
});
