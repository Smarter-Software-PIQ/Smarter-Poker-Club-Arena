/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CLICKING A TOURNAMENT ROW OPENS THE TOURNAMENT LOBBY
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan, 2026-11-01 (reinstating and widening his 2026-08-25 ruling):
 *
 *   "WHEN YOU CLICK ON A TOURNAMENT THATS 'RUNNING' IT SHOULD TAKE YOU
 *    DIRECTLY TO THE LOBBY. OR REALLY ANY TOURNAMENT, IT SHOULD NOT TAKE YOU
 *    TO THIS PAGE FIRST."
 *
 * "This page" is the GameLobbyPanel drawer. For a while every row opened it
 * before anything else; Dan retired that for tournaments. `openEntry` now
 * routes by KIND, never by status:
 *
 *  - CASH rows keep the drawer — it is where a cash buy-in is chosen.
 *  - MTTs and multi-seat SNGs go straight to the tournament's own lobby
 *    screen through the one openTournamentLobby helper, at every status.
 *  - Spins and heads-up SNGs open their live TABLE (spinQuickJoin), because
 *    "there is 'no lobby' for a spin, you just start on a table"
 *    (Dan 2026-08-20). spinQuickJoin resolves and navigates; the seat is
 *    bought on the felt by the tap that picks it.
 *  - IT STILL SPENDS NOTHING. Selecting a row never joins, registers or buys
 *    in (tests/e2e/club-lobby.spec.ts is the live guard). A tournament lobby
 *    is a read-only screen: TournamentDetails registers only from its sign-up
 *    modal, and its auto-seat effect requires an existing tournament_players
 *    row carrying a table_id, which an unregistered player does not have.
 *
 * These read the source rather than rendering it for the same reason
 * allTabScope.test.ts does: the rule lives in one callback inside a
 * 3,200-line page component, and standing up the whole club-loading machinery
 * to reach three lines buys nothing an assertion that names the rule does not.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const src = readFileSync(path.resolve(__dirname, '../..', 'src/pages/ClubHomePage.tsx'), 'utf8');

/** The body of the row-selection callback. */
const openEntryBody = (() => {
  const start = src.indexOf('const openEntry = useCallback(');
  expect(start, 'openEntry has moved or been renamed').toBeGreaterThan(-1);
  const end = src.indexOf('[openTournamentLobby, spinQuickJoin]', start);
  expect(end, 'openEntry no longer closes on its routing dependencies').toBeGreaterThan(start);
  return src.slice(start, end);
})();

describe('a tournament row goes straight to its lobby (Dan 2026-11-01)', () => {
  it('routes every non-cash row away from the pre-commit drawer', () => {
    expect(openEntryBody).toContain("if (entry.kind !== 'cash') {");
    expect(openEntryBody).toContain('openTournamentLobby(entry.id);');
  });

  it('a spin or heads-up SNG opens its live table instead, spending nothing', () => {
    // Whitespace-normalised: Prettier wraps the three-arm condition.
    expect(openEntryBody.replace(/\s+/g, ' ')).toContain(
      "entry.kind === 'spin' || (entry.kind === 'sng' && entry.capacity > 0 && entry.capacity <= 2)"
    );
    expect(openEntryBody).toContain('spinQuickJoin(');
  });

  it('never reads a status to decide', () => {
    for (const status of ['running', 'late_reg', 'completed', 'registering', 'starting_soon']) {
      expect(
        openEntryBody.includes(`entry.status === '${status}'`),
        `openEntry gates the tournament lobby on status '${status}' again`
      ).toBe(false);
    }
  });

  it('the ?game= link opens through the same door, not a second hand-rolled panel open', () => {
    const linkBlock = src.slice(
      src.indexOf('// Reopen the game a ?game=<id> URL points at.'),
      src.indexOf('linkedCardWasOpenRef')
    );
    expect(linkBlock).toContain('openEntry(linked);');
    expect(linkBlock).not.toContain('setPanelOpen(true);');
  });
});

describe('a cash row still opens the game lobby panel', () => {
  it('falls through to the panel for cash alone', () => {
    const cashTail = openEntryBody.slice(openEntryBody.indexOf("if (entry.kind !== 'cash') {"));
    expect(cashTail).toContain('setSelectedId(entry.id);');
    expect(cashTail).toContain('setPanelOpen(true);');
    expect(cashTail.indexOf('return;')).toBeLessThan(cashTail.indexOf('setSelectedId(entry.id);'));
  });
});

describe('there is exactly one route to a tournament lobby', () => {
  const helper = (() => {
    const start = src.indexOf('const openTournamentLobby = useCallback(');
    expect(start, 'the openTournamentLobby helper has moved or been renamed').toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('[navigate, clubId]', start));
  })();

  it('the helper is the only place that builds the path', () => {
    const built = src.match(/navigate\(`\/tournaments\/\$\{[^}]+\}`\)/g) || [];
    expect(
      built.length,
      'a second hand-rolled navigate to /tournaments/<id> can drift from the helper'
    ).toBe(0);
    expect(helper).toContain('const target = `/tournaments/${tournamentId}`;');
    expect(helper).toContain('navigate(withClubContext(target, clubId));');
  });

  it('a double click cannot push a duplicate history entry', () => {
    // The row fires onSelect on click AND onActivate on double click; both are
    // openEntry. The helper is a no-op once the path is already current.
    expect(helper).toContain('if (window.location.pathname.endsWith(target)) return;');
    expect(src).toContain('onSelect={openEntry}');
    expect(src).toContain('onActivate={openEntry}');
  });

  it('the Details button and the post-registration hand-off use the same helper', () => {
    /* UPDATED 2026-08-28, same commit as the behaviour change it pins: a
       seat-first row (spin, or a 2-seat heads-up sng) has NO lobby screen —
       Dan 2026-08-20: "there is 'no lobby' for a spin, you just start on a
       table" — so its view action opens the live TABLE via spinQuickJoin.
       Cash still goes to the table route, and everything else (MTTs and
       multi-seat SNGs) still goes through the one openTournamentLobby
       helper. The onViewTable ternary now carries three arms; pin each. */
    const viewBody = (() => {
      const start = src.indexOf('onViewTable: (e) =>');
      expect(start, 'onViewTable has moved or been renamed').toBeGreaterThan(-1);
      return src.slice(start, src.indexOf('}),', start));
    })();
    expect(viewBody).toContain("e.kind === 'cash'");
    expect(viewBody).toContain('handleViewCashTable(e.id)');
    const cashEntry = src.slice(
      src.indexOf('const handleViewCashTable ='),
      src.indexOf('const handleJoinTable =')
    );
    expect(cashEntry).toContain('if (currentUserId) await prepareTableForEntry(tableId)');
    expect(src).toContain('const preparingCashTable = preparingCashScope === gameEntryScope;');
    expect(cashEntry).toContain('setPreparingCashScope(gameEntryScope)');
    expect(cashEntry).toContain('scope === gameEntryScope ? null : scope');
    expect(cashEntry).not.toContain('setActionBusy(');
    expect(cashEntry).toContain('navigate(`/table/${tableId}`)');
    expect(cashEntry.indexOf('await prepareTableForEntry(tableId)')).toBeLessThan(
      cashEntry.indexOf('navigate(`/table/${tableId}`)')
    );
    expect(viewBody).toContain(
      "e.kind === 'spin' || (e.kind === 'sng' && e.capacity > 0 && e.capacity <= 2)"
    );
    expect(viewBody).toContain('spinQuickJoin(');
    expect(viewBody).toContain('openTournamentLobby(e.id)');
    expect(src).toContain('setTimeout(() => openTournamentLobby(t.id), 0);');
  });
});

describe('selecting a row still spends nothing', () => {
  it.each(['registerMtt', 'handleRegister', 'handleJoinTable'])(
    'openEntry does not call %s',
    (forbidden) => {
      expect(
        openEntryBody.includes(forbidden),
        `openEntry calls ${forbidden}, which commits the player`
      ).toBe(false);
    }
  );

  it('the only table reference left in the callback is a module preload', () => {
    expect(src).toContain('preloadRoute(`/table/${entry.id}`);');
    expect(/navigate\(`\/table\/\$\{entry\.id\}`\)/.test(openEntryBody)).toBe(false);
  });
});
