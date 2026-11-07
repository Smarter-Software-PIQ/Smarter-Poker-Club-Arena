/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A FREE ROLL SAYS WHICH EVENT IT IS, UNDER ITS TITLE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan, 2026-11-07, verbatim: "THE FREE ROLLS STIL DO NOT SAY WHAT KIND OF FREE
 * ROLL THEY ARE UNDERNEATH THEM. LIKE THIS ONE SHOULD SAY, 'PROGRESSIVE
 * KNOCKOUT' OTHER ONES SHOULD SAY, 'MYSTERY BOUNTY' OR 'ALL IN OR FOLD' ETC.
 * ADD THE SECONDARY TITLE UNDER THE MAIN TITLE FOR THE NAME OF THE TOURNAMENT
 * THE FREE ROLL IS RUNNING." (2026-11-06: every Free Buy card says which Free
 * Buy event it is, for all freerolls every day.)
 *
 * What is pinned here:
 *   1. freeBuyKindLabel names the event from the recorded flags — the same
 *      facts that pick the card's format icon — never from the title text:
 *      PKO, Mystery Bounty, Bounty, Satellite, All In Or Fold.
 *   2. A plain freeroll still gets a line: by the Free Buy law every freeroll
 *      sells 1-chip rebuys and add-ons, so it reads "Rebuy & Add-On" rather
 *      than printing nothing.
 *   3. A paid tournament prints no second title from this rule.
 *   4. The lobby heading row actually renders the line, in both the full
 *      board and the compact board, inside the name face under the title.
 */
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LobbyTable, { freeBuyKindLabel } from '../../src/components/lobby/LobbyTable';
import { tournamentEntry, type LobbyTournamentRow } from '../../src/components/lobby/lobbyEntries';

vi.mock('../../src/services/tableWarmup', () => ({
  warmTable: vi.fn(),
  observeLobbyTableWarmups: () => () => {},
}));
vi.mock('../../src/hooks/useSpinTierAvailability', () => ({ useSpinTierAvailability: () => null }));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const now = Date.parse('2026-11-07T18:00:00Z');

function freeroll(id: string, over: Partial<LobbyTournamentRow> = {}) {
  return tournamentEntry(
    {
      id,
      name: id,
      format_contract: 'mtt-v1',
      game_type: 'NLH',
      status: 'REGISTERING',
      start_time: new Date(now + 120 * 60000).toISOString(),
      buy_in_amount: 0,
      buy_in_fee: 0,
      guaranteed_prize: 100,
      current_players: 187,
      max_players: 1000,
      starting_chips: 10000,
      is_bounty: false,
      is_pko: false,
      is_mystery_bounty: false,
      all_in_or_fold: false,
      ...over,
    } as LobbyTournamentRow,
    'mtt'
  );
}

describe('freeBuyKindLabel', () => {
  it('names the bounty family from the recorded flags, most specific first', () => {
    expect(
      freeBuyKindLabel(freeroll('midday-free-buy', { is_bounty: true, is_pko: true }))
    ).toBe('Progressive Knockout');
    expect(
      freeBuyKindLabel(freeroll('prime-time-free-buy', { is_bounty: true, is_mystery_bounty: true }))
    ).toBe('Mystery Bounty');
    expect(freeBuyKindLabel(freeroll('ko-free-buy', { is_bounty: true }))).toBe('Bounty');
  });

  it('says All In Or Fold from the recorded column, beside any bounty family', () => {
    expect(freeBuyKindLabel(freeroll('aof-free-buy', { all_in_or_fold: true }))).toBe(
      'All In Or Fold'
    );
    expect(
      freeBuyKindLabel(
        freeroll('aof-pko-free-buy', { is_bounty: true, is_pko: true, all_in_or_fold: true })
      )
    ).toBe('Progressive Knockout · All In Or Fold');
  });

  it('gives a plain freeroll the Free Buy deal line rather than nothing', () => {
    expect(freeBuyKindLabel(freeroll('plain-free-buy'))).toBe('Rebuy & Add-On');
  });

  it('prints nothing for a paid tournament', () => {
    expect(
      freeBuyKindLabel(
        freeroll('paid-pko', { buy_in_amount: 40, buy_in_fee: 4, is_bounty: true, is_pko: true })
      )
    ).toBeNull();
  });
});

describe('the lobby heading row renders the second title', () => {
  const ctx = {
    waitlistedIds: new Set<string>(),
    seatedIds: new Set<string>(),
    registeredIds: new Set<string>(),
    favoriteIds: new Set<string>(),
  };

  it('under the freeroll title in both boards, and not on a paid event', () => {
    render(
      <MemoryRouter>
        <LobbyTable
          entries={[
            freeroll('midday-free-buy', {
              name: 'Midday Free Buy (NLH)',
              is_bounty: true,
              is_pko: true,
            }),
            freeroll('paid-nightly', {
              name: 'Nightly 10K (NLH)',
              buy_in_amount: 40,
              buy_in_fee: 4,
            }),
          ]}
          category="MTT"
          selectedId={null}
          onSelect={() => {}}
          onActivate={() => {}}
          ctx={ctx}
        />
      </MemoryRouter>
    );
    for (const selector of ['.lobby-table', '.compact-lobby']) {
      const table = document.querySelector(selector)!;
      const heading = table.querySelector('[data-tournament-heading="midday-free-buy"]')!;
      const line = heading.querySelector('.lt-tournament-heading__format');
      expect(line).not.toBeNull();
      expect(line!.textContent).toBe('Progressive Knockout');
      // The second title sits inside the name face, after the fitted title.
      expect(line!.parentElement!.classList.contains('lt-tournament-heading__name')).toBe(true);
      expect(
        line!.previousElementSibling!.classList.contains('premium-lobby-title-fit')
      ).toBe(true);
      const paid = table.querySelector('[data-tournament-heading="paid-nightly"]')!;
      expect(paid.querySelector('.lt-tournament-heading__format')).toBeNull();
    }
  });
});
