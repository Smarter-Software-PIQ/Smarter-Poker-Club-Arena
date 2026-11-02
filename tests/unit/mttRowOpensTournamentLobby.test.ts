/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CLICKING A TOURNAMENT ROW OPENS THE TOURNAMENT LOBBY
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan, 2026-11-01 (binding), looking at the GameLobbyPanel card a tournament
 * row opened:
 *
 *   "WHEN YOU CLICK ON A TOURNAMENT THATS 'RUNNING' IT SHOULD TAKE YOU
 *    DIRECTLY TO THE LOBBY. OR REALLY ANY TOURNAMENT, IT SHOULD NOT TAKE YOU
 *    TO THIS PAGE FIRST."
 *
 * This restores his 2026-08-25 ruling ("WHEN YOU CLICK ANY OF THE MTT FIELDS
 * ... IT SHOULD OPEN TO THE TOURNAMENT LOBBY"), which a later game-card pass
 * had reversed by sending every row to the panel first. `openEntry` now
 * routes every MTT row — and every multi-seat SNG, which shares the same
 * registration lobby — straight to `/tournaments/<id>`, at every status, on
 * both the ALL tab and the MTT tab.
 *
 * Three things this must NOT do, and all are pinned below:
 *
 *  - CASH ROWS ARE UNCHANGED. The drawer is where a cash buy-in is chosen; it
 *    is not a tournament detour.
 *  - SPINS AND HEADS-UP SNGS KEEP THE CARD. They are seat-first games with no
 *    lobby of their own (Dan 2026-08-20: "there is 'no lobby' for a spin, you
 *    just start on a table").
 *  - IT STILL SPENDS NOTHING. Selecting a row never joins, registers or buys
 *    in (tests/e2e/club-lobby.spec.ts is the live guard). A tournament lobby
 *    is a read-only screen: TournamentDetails registers only from its sign-up
 *    modal, and its auto-seat effect requires an existing tournament_players
 *    row carrying a table_id, which an unregistered player does not have.
 *
 * These read the source rather than rendering it for the same reason
 * allTabScope.test.ts does: the rule lives in one callback inside a huge page
 * component, and standing up the whole club-loading machinery to reach a few
 * lines buys nothing an assertion that names the rule does not.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const src = readFileSync(path.resolve(__dirname, '../..', 'src/pages/ClubHomePage.tsx'), 'utf8');

/** The body of the row-selection callback. */
const openEntryBody = (() => {
  const start = src.indexOf('const openEntry = useCallback(');
  expect(start, 'openEntry has moved or been renamed').toBeGreaterThan(-1);
  const end = src.indexOf('preloadRoute(`/table/${entry.id}`);', start);
  expect(end, 'openEntry no longer ends by preloading the table route').toBeGreaterThan(start);
  return src.slice(start, end);
})();

describe('a tournament row opens the tournament lobby directly', () => {
  it('routes MTT and multi-seat SNG rows to /tournaments/:id before any panel state', () => {
    const guard = openEntryBody.indexOf(
      "if (entry.kind === 'mtt' || (entry.kind === 'sng' && entry.capacity > 2)) {"
    );
    expect(guard, 'the tournament door guard is gone from openEntry').toBeGreaterThan(-1);
    expect(openEntryBody).toContain('openTournamentLobby(entry.id);');
    // The door returns before the card: the panel must never flash first.
    const panel = openEntryBody.indexOf('setPanelOpen(true);');
    expect(panel).toBeGreaterThan(guard);
    expect(openEntryBody.slice(guard, panel)).toContain('return;');
  });

  it('never reads a status to decide', () => {
    for (const status of ['running', 'late_reg', 'completed', 'registering', 'starting_soon']) {
      expect(
        openEntryBody
          .slice(0, openEntryBody.indexOf('openTournamentLobby(entry.id);'))
          .includes(`entry.status === '${status}'`),
        `openEntry gates the tournament lobby on status '${status}' again`
      ).toBe(false);
    }
  });

  it('still spends nothing on the way to the lobby', () => {
    for (const spender of ['registerMtt(', 'handleRegister(', 'joinCashGame(', 'spinQuickJoin(']) {
      expect(
        openEntryBody.includes(spender),
        `openEntry calls ${spender}...) — selecting a row must never spend`
      ).toBe(false);
    }
  });
});

describe('cash, spin and heads-up rows still open the game lobby panel', () => {
  it('falls through to the panel for everything the guard leaves alone', () => {
    expect(openEntryBody).toContain('setSelectedId(entry.id);');
    expect(openEntryBody).toContain('setPanelOpen(true);');
  });

  it('does not route cash or spin rows away from the panel', () => {
    expect(/kind === 'cash'[^)]*\)\s*{[^}]*openTournamentLobby/s.test(openEntryBody)).toBe(false);
    expect(/kind === 'spin'/.test(openEntryBody)).toBe(false);
  });
});
