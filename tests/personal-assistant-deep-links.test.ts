import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Club Arena Personal Assistant cross-app deep-link contracts', () => {
  it('HandHistoryPage preserves linked hand id and source when returning to Personal Assistant', () => {
    const src = readFileSync(resolve('src/pages/HandHistoryPage.tsx'), 'utf8');
    expect(src).toContain(
      "const cameFromPersonalAssistant = searchParams.get('source') === 'personal-assistant';"
    );
    expect(src).toContain("params.set('hand', linkedHandId);");
    expect(src).toContain("params.set('source', 'club-arena');");
    expect(src).toContain("params.set('leak', returnLeakId);");
    expect(src).toContain('/hub/personal-assistant/leaks?source=club-arena&hand=');
  });

  it('PlayerStatsPage forwards active Cash/Tournament format to Personal Assistant Leak Finder', () => {
    const src = readFileSync(resolve('src/pages/PlayerStatsPage.tsx'), 'utf8');
    expect(src).toContain('/hub/personal-assistant/leaks?source=club-arena-stats${formatQuery}');
    expect(src).toContain(
      "gameMode === 'cash' || gameMode === 'tournament' ? `&format=${gameMode}` : ''"
    );
  });
});
